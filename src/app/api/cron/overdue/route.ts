import { type NextRequest } from "next/server"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { eq, and, isNull } from "drizzle-orm"
import { calculateDaysOverdue, calculateDailyRate, calculateInterest } from "@/lib/interest"
import BigNumber from "bignumber.js"

export async function GET(request: NextRequest) {
  // Auth: verify cron secret
  const cronSecret = request.headers.get("x-cron-secret")
  if (cronSecret !== process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // 1. Fetch all active loans
    const activeLoans = await db
      .select()
      .from(loans)
      .where(eq(loans.status, "active"))

    const results: { loanId: string; daysOverdue: string }[] = []

    // 2. For each active loan, calculate days overdue
    for (const loan of activeLoans) {
      // Fetch active (non-deleted) payments for this loan
      const loanPayments = await db
        .select()
        .from(payments)
        .where(and(eq(payments.loanId, loan.id), isNull(payments.deletedAt)))

      // Calculate total interest paid from payment records
      const totalInterestPaid = loanPayments.reduce(
        (sum, p) => sum.plus(new BigNumber(p.interestPortion)),
        new BigNumber(0)
      )

      // Calculate total days elapsed since loan start
      const now = new Date()
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
    }

    return Response.json({
      processed: activeLoans.length,
      flagged: results.length,
      flaggedLoans: results,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("[Cron] Overdue detection failed:", error)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
