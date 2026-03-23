import { Effect } from "effect"
import { db } from "@/lib/db"
import { payments } from "@/lib/db/schema/payments"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { sql, eq, and, isNull, asc } from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import BigNumber from "bignumber.js"
import type { DailyCollectionsSummary, LoanDueToday } from "@/types"

/**
 * Returns an aggregated summary of all payments collected on a given date
 * (in Africa/Kampala timezone), including per-payment breakdown rows.
 *
 * COLL-01, COLL-02: Daily collections aggregation with timezone-aware date filter.
 */
export const getDailyCollections = (
  date: string
): Effect.Effect<DailyCollectionsSummary, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db
        .select({
          paymentId: payments.id,
          loanId: payments.loanId,
          customerName: customers.fullName,
          amount: payments.amount,
          interestPortion: payments.interestPortion,
          principalPortion: payments.principalPortion,
          paymentDate: payments.paymentDate,
        })
        .from(payments)
        .innerJoin(loans, eq(payments.loanId, loans.id))
        .innerJoin(customers, eq(loans.customerId, customers.id))
        .where(
          and(
            isNull(payments.deletedAt),
            sql`DATE(${payments.paymentDate} AT TIME ZONE 'Africa/Kampala') = ${date}::date`
          )
        )
        .orderBy(asc(payments.paymentDate))

      const totalCollected = rows
        .reduce((sum, r) => sum.plus(new BigNumber(r.amount)), new BigNumber(0))
        .toFixed(2)

      return {
        date,
        totalCollected,
        paymentCount: rows.length,
        rows,
      }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

/**
 * Returns all active loans where the last payment (or loan start date if no
 * payments) was 30 or more days ago, sorted by daysSinceLastPayment descending.
 *
 * COLL-03, COLL-04: Due-today list based on 30-day payment cycle threshold.
 */
export const getLoansDueToday = (): Effect.Effect<LoanDueToday[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const activeLoans = await db
        .select()
        .from(loans)
        .where(and(eq(loans.status, "active"), isNull(loans.deletedAt)))

      const now = new Date()
      const results: LoanDueToday[] = []

      for (const loan of activeLoans) {
        const loanPayments = await db
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, loan.id), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate))

        // Anchor: use last payment date, or loan start date if no payments
        const lastPayment = loanPayments.at(-1)
        const anchorDate = lastPayment
          ? new Date(lastPayment.paymentDate)
          : new Date(loan.startDate)

        const daysSinceLastPayment = Math.floor(
          (now.getTime() - anchorDate.getTime()) / (1000 * 60 * 60 * 24)
        )

        if (daysSinceLastPayment >= 30) {
          const [customer] = await db
            .select()
            .from(customers)
            .where(eq(customers.id, loan.customerId))

          const outstandingBalance = lastPayment
            ? lastPayment.principalBalanceAfter
            : loan.principalAmount

          results.push({
            loanId: loan.id,
            customerId: loan.customerId,
            customerName: customer?.fullName ?? "Unknown",
            loanAmount: loan.principalAmount,
            outstandingBalance,
            daysSinceLastPayment,
            lastPaymentDate: lastPayment ? new Date(lastPayment.paymentDate) : null,
          })
        }
      }

      // Sort by daysSinceLastPayment descending (most overdue first)
      results.sort((a, b) => b.daysSinceLastPayment - a.daysSinceLastPayment)

      return results
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
