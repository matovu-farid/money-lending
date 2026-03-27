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
  // Auth: verify cron secret via Authorization Bearer header
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // 1. Fetch all active loans
    const activeLoans = await db
      .select()
      .from(loans)
      .where(eq(loans.status, "active"))

    const now = new Date()
    const results: { loanId: string; daysOverdue: string }[] = []
    const alertResults: { loanId: string; daysUntilDue: number }[] = []

    // ALRT-01: Get all users with staff roles for notification targeting
    // Better Auth stores role in the "user" table's "role" column
    const targetUsersResult = await db.execute(
      sql`SELECT id FROM "user" WHERE role IN ('admin', 'loanOfficer', 'superAdmin')`
    )
    const targetUserIds = (targetUsersResult as unknown as Array<{ id: string }>).map(
      (r) => r.id
    )

    // 2. For each active loan, calculate days overdue and check upcoming due dates
    for (const loan of activeLoans) {
      // Fetch active (non-deleted) payments for this loan, ordered by date
      const loanPayments = await db
        .select()
        .from(payments)
        .where(and(eq(payments.loanId, loan.id), isNull(payments.deletedAt)))
        .orderBy(asc(payments.paymentDate))

      // Calculate total interest paid from payment records
      const totalInterestPaid = loanPayments.reduce(
        (sum, p) => sum.plus(new BigNumber(p.interestPortion)),
        new BigNumber(0)
      )

      // Calculate total days elapsed since loan start
      const totalDaysElapsed = Math.floor(
        (now.getTime() - new Date(loan.startDate).getTime()) / (1000 * 60 * 60 * 24)
      )

      // Determine effective rate and min period (supports per-loan overrides, LOAN-11)
      const effectiveRate = loan.interestRateOverride ?? loan.interestRate
      const effectiveMinDays = loan.minPeriodOverride ?? loan.minInterestDays
      const dailyRate = calculateDailyRate(effectiveRate)

      // Calculate total interest accrued using the same engine as the rest of the system
      // (RISK-04 pattern: single implementation, not a separate cron-only formula)
      const totalInterestAccrued = calculateInterest(
        loan.principalAmount,
        effectiveRate,
        totalDaysElapsed,
        effectiveMinDays
      )

      const daysOverdue = calculateDaysOverdue(
        totalInterestAccrued.toFixed(2),
        totalInterestPaid.toFixed(2),
        dailyRate.toFixed(10)
      )

      // Flag loans with days_overdue >= 30
      if (daysOverdue.isGreaterThanOrEqualTo(30)) {
        results.push({
          loanId: loan.id,
          daysOverdue: daysOverdue.toFixed(0),
        })
      }

      // ALRT-01: Generate in-app alerts for loans due within 5 days
      // "Due date" = last payment date + 30 days, or loan start + 30 if no payments
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
        // Fetch customer name for message
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
