import { type NextRequest } from "next/server"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { customers } from "@/lib/db/schema/customers"
import { getBaseRate } from "@/lib/interest/effective-rate"
import { eq, and, isNull, asc, sql, inArray } from "drizzle-orm"
import { computeLoanOverdueInfo } from "@/lib/interest/overdue"
import { getLoanBalancesFromLedger, getInterestEarnedFromLedger } from "@/services/ledger-queries.service"
import { formatAmount } from "@/lib/interest/engine"
import { createNotificationsForLoan } from "@/services/notification.service"
import BigNumber from "bignumber.js"
import { toLoanType } from "@/types"

export async function POST(request: NextRequest) {
  // Fail-closed: reject if CRON_SECRET is not configured
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  }

  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const activeLoans = await db
      .select()
      .from(loans)
      .where(and(eq(loans.status, "active"), isNull(loans.deletedAt)))

    const now = new Date()
    const results: { loanId: string; daysOverdue: string }[] = []
    const alertResults: { loanId: string; daysUntilDue: number }[] = []

    const targetUsersResult = await db.execute(
      sql`SELECT id FROM "user" WHERE role IN ('admin', 'loanOfficer', 'supervisor', 'superAdmin')`
    )
    const targetUserIds = (targetUsersResult as unknown as Array<{ id: string }>).map(
      (r) => r.id
    )

    const loanIds = activeLoans.map((l) => l.id)

    // Batch-fetch customer names for all active loans
    const customerIds = [...new Set(activeLoans.map((l) => l.customerId))]
    const customerRows = customerIds.length > 0
      ? await db.select({ id: customers.id, fullName: customers.fullName }).from(customers).where(inArray(customers.id, customerIds))
      : []
    const customerNameMap = new Map(customerRows.map((c) => [c.id, c.fullName]))

    const ledgerBalances = await getLoanBalancesFromLedger(loanIds)
    const interestEarnedMap = await getInterestEarnedFromLedger(loanIds)

    const allPayments =
      loanIds.length > 0
        ? await db
            .select()
            .from(payments)
            .where(and(inArray(payments.loanId, loanIds), isNull(payments.deletedAt)))
            .orderBy(asc(payments.paymentDate))
        : []

    const paymentsByLoan = new Map<string, (typeof allPayments)[number][]>()
    for (const p of allPayments) {
      const list = paymentsByLoan.get(p.loanId) ?? []
      list.push(p)
      paymentsByLoan.set(p.loanId, list)
    }

    for (const loan of activeLoans) {
      try {
        const loanPayments = paymentsByLoan.get(loan.id) ?? []
        const baseRate = getBaseRate(loan)
        const ledgerBalance = ledgerBalances.get(loan.id)
        if (ledgerBalance === undefined) {
          console.warn(`[overdue-cron] No ledger entries for loan ${loan.id}, using principalAmount as fallback`)
        }
        const outstandingBalance =
          ledgerBalance !== undefined
            ? ledgerBalance.toFixed(0)
            : loan.principalAmount

        const info = computeLoanOverdueInfo({
          principalAmount: loan.principalAmount,
          baseRate,
          startDate: new Date(loan.startDate),
          loanType: toLoanType(loan.loanType),
          termMonths: loan.termMonths,
          totalInterestPaid: formatAmount(interestEarnedMap.get(loan.id) ?? new BigNumber(0)),
          paymentCount: loanPayments.length,
          outstandingBalance,
          penaltyWaived: loan.penaltyWaived,
          loan,
        })

        if (info.daysOverdue >= 30) {
          results.push({
            loanId: loan.id,
            daysOverdue: String(info.daysOverdue),
          })
        }

        // Reset waiver when borrower returns to good standing (< 60 days overdue)
        // This ensures future overdue episodes will trigger penalty again
        if (info.daysOverdue < 60 && loan.penaltyWaived) {
          await db.update(loans).set({
            penaltyWaived: false,
            penaltyWaivedBy: null,
            penaltyWaivedAt: null,
          }).where(eq(loans.id, loan.id))
          console.log(`[overdue-cron] Penalty waiver reset for loan ${loan.id} (back to good standing)`)
        }

        const lastPayment = loanPayments.at(-1)
        const referenceDate = lastPayment
          ? new Date(lastPayment.paymentDate)
          : new Date(loan.startDate)

        const nextDueDate = new Date(referenceDate)
        nextDueDate.setDate(nextDueDate.getDate() + 30)

        const daysUntilDue = Math.floor(
          (nextDueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        )

        if (daysUntilDue >= 0 && daysUntilDue <= 5) {
          const customerName = customerNameMap.get(loan.customerId) ?? "Unknown"

          const message = `Loan for ${customerName} — due in ${daysUntilDue} days`

          await createNotificationsForLoan(
            loan.id,
            message,
            nextDueDate,
            targetUserIds
          )

          alertResults.push({ loanId: loan.id, daysUntilDue })
        }
      } catch (err) {
        console.error(`[Cron] Failed to process loan ${loan.id}:`, err)
      }
    }

    return Response.json({
      processed: activeLoans.length,
      flagged: results.length,
      flaggedLoans: results,
      alerts: alertResults.length,
      alertedLoans: alertResults,
      timestamp: now.toISOString(),
    })
  } catch (error) {
    console.error("[Cron] Overdue detection failed:", error)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
