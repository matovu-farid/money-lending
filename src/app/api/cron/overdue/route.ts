import { type NextRequest } from "next/server"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { customers } from "@/lib/db/schema/customers"
import { eq, and, isNull, asc, sql } from "drizzle-orm"
import { calculateDaysOverdue, calculateDailyRate, calculateInterest } from "@/lib/interest"
import { createNotificationsForLoan } from "@/services/notification.service"
import BigNumber from "bignumber.js"

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
      sql`SELECT id FROM "user" WHERE role IN ('admin', 'loanOfficer', 'superAdmin')`
    )
    const targetUserIds = (targetUsersResult as unknown as Array<{ id: string }>).map(
      (r) => r.id
    )

    for (const loan of activeLoans) {
      try {
      const loanPayments = await db
        .select()
        .from(payments)
        .where(and(eq(payments.loanId, loan.id), isNull(payments.deletedAt)))
        .orderBy(asc(payments.paymentDate))

      const totalInterestPaid = loanPayments.reduce(
        (sum, p) => sum.plus(new BigNumber(p.interestPortion)),
        new BigNumber(0)
      )

      const totalDaysElapsed = Math.floor(
        (now.getTime() - new Date(loan.startDate).getTime()) / (1000 * 60 * 60 * 24)
      )

      const effectiveRate = loan.interestRateOverride ?? loan.interestRate
      const dailyRate = calculateDailyRate(effectiveRate)

      // Use actual days for accrual — min period only applies to payment allocation
      const totalInterestAccrued = calculateInterest(
        loan.principalAmount,
        effectiveRate,
        totalDaysElapsed,
        0
      )

      const dailyInterestAmount = new BigNumber(loan.principalAmount).multipliedBy(dailyRate)
      const daysOverdue = calculateDaysOverdue(
        totalInterestAccrued,
        totalInterestPaid,
        dailyInterestAmount
      )

      if (daysOverdue.isGreaterThanOrEqualTo(30)) {
        results.push({
          loanId: loan.id,
          daysOverdue: daysOverdue.toFixed(0),
        })
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
        const [customer] = await db
          .select()
          .from(customers)
          .where(eq(customers.id, loan.customerId))

        const message = `Loan for ${customer?.fullName ?? "Unknown"} — due in ${daysUntilDue} days`

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
