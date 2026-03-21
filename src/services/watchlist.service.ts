import { Effect } from "effect"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { customers } from "@/lib/db/schema/customers"
import { eq, and, isNull, asc } from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import { calculateDaysOverdue, calculateDailyRate, calculateInterest } from "@/lib/interest"
import BigNumber from "bignumber.js"
import type { WatchlistEntry } from "@/types"

export const getWatchlistData = (): Effect.Effect<WatchlistEntry[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const activeLoans = await db
        .select()
        .from(loans)
        .where(eq(loans.status, "active"))

      const now = new Date()
      const results: WatchlistEntry[] = []

      for (const loan of activeLoans) {
        const loanPayments = await db
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, loan.id), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate))

        const totalDaysElapsed = Math.floor(
          (now.getTime() - new Date(loan.startDate).getTime()) / (1000 * 60 * 60 * 24)
        )

        const effectiveRate = loan.interestRateOverride ?? loan.interestRate
        const effectiveMinDays = loan.minPeriodOverride ?? loan.minInterestDays
        const dailyRate = calculateDailyRate(effectiveRate)

        const totalInterestAccrued = calculateInterest(
          loan.principalAmount, effectiveRate, totalDaysElapsed, effectiveMinDays
        )

        const totalInterestPaid = loanPayments.reduce(
          (sum, p) => sum.plus(new BigNumber(p.interestPortion)),
          new BigNumber(0)
        )

        const daysOverdue = calculateDaysOverdue(
          totalInterestAccrued.toFixed(2),
          totalInterestPaid.toFixed(2),
          dailyRate.toFixed(10)
        )

        // Only include loans with days_overdue >= 30 (RISK-02)
        if (daysOverdue.isGreaterThanOrEqualTo(30)) {
          const [customer] = await db
            .select()
            .from(customers)
            .where(eq(customers.id, loan.customerId))

          // Get outstanding balance from last payment or principal
          const lastPayment = loanPayments.at(-1)
          const outstandingBalance = lastPayment
            ? lastPayment.principalBalanceAfter
            : loan.principalAmount

          const lastPaymentDate = loanPayments.length > 0
            ? loanPayments.at(-1)!.paymentDate
            : null

          results.push({
            customerId: loan.customerId,
            customerName: customer?.fullName ?? "Unknown",
            loanId: loan.id,
            loanAmount: loan.principalAmount,
            outstandingBalance,
            daysOverdue: daysOverdue.toFixed(0),
            dailyRate: dailyRate.toFixed(2),
            lastPaymentDate,
          })
        }
      }

      // Sort by days overdue descending (most overdue first)
      results.sort((a, b) => parseInt(b.daysOverdue) - parseInt(a.daysOverdue))

      return results
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
