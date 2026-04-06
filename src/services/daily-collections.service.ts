import { Effect } from "effect"
import { db } from "@/lib/db"
import { payments } from "@/lib/db/schema/payments"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { sql, eq, and, isNull, asc, inArray } from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import BigNumber from "bignumber.js"
import { computeLoanOverdueInfo } from "@/lib/interest/overdue"
import type { DailyCollectionsSummary, LoanDueToday, LoanType } from "@/types"

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
          depositLocation: payments.depositLocation,
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

export const getLoansDueToday = (): Effect.Effect<LoanDueToday[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const activeLoans = await db
        .select({
          id: loans.id,
          customerId: loans.customerId,
          principalAmount: loans.principalAmount,
          startDate: loans.startDate,
          interestRate: loans.interestRate,
          interestRateOverride: loans.interestRateOverride,
          loanType: loans.loanType,
          termMonths: loans.termMonths,
          customerName: customers.fullName,
        })
        .from(loans)
        .innerJoin(customers, eq(loans.customerId, customers.id))
        .where(and(eq(loans.status, "active"), isNull(loans.deletedAt)))

      if (activeLoans.length === 0) return []

      const loanIds = activeLoans.map((l) => l.id)

      // Batch-fetch payments and ledger balances
      const allPayments = await db
        .select()
        .from(payments)
        .where(and(inArray(payments.loanId, loanIds), isNull(payments.deletedAt)))
        .orderBy(asc(payments.paymentDate))

      const { getLoanBalancesFromLedger } = await import("@/services/transaction.service")
      const ledgerBalances = await getLoanBalancesFromLedger(loanIds)

      const paymentsByLoanId = new Map<string, (typeof allPayments)[number][]>()
      for (const p of allPayments) {
        const existing = paymentsByLoanId.get(p.loanId) ?? []
        existing.push(p)
        paymentsByLoanId.set(p.loanId, existing)
      }

      const now = new Date()
      const results: LoanDueToday[] = []

      for (const loan of activeLoans) {
        const loanPayments = paymentsByLoanId.get(loan.id) ?? []
        const effectiveRate = loan.interestRateOverride ?? loan.interestRate
        const ledgerBalance = ledgerBalances.get(loan.id)
        const outstandingBalance = ledgerBalance
          ? ledgerBalance.toFixed(2)
          : loan.principalAmount
        const info = computeLoanOverdueInfo({
          principalAmount: loan.principalAmount,
          effectiveRate,
          startDate: new Date(loan.startDate),
          loanType: (loan.loanType ?? "perpetual") as LoanType,
          termMonths: loan.termMonths,
          payments: loanPayments.map((p) => ({ interestPortion: p.interestPortion, paymentDate: p.paymentDate })),
          outstandingBalance,
        })
        const daysOverdue = info.daysOverdue

        if (daysOverdue >= 30) {

          const lastPayment = loanPayments.at(-1)

          results.push({
            loanId: loan.id,
            customerId: loan.customerId,
            customerName: loan.customerName,
            loanAmount: loan.principalAmount,
            outstandingBalance,
            daysOverdue,
            lastPaymentDate: lastPayment ? new Date(lastPayment.paymentDate) : null,
          })
        }
      }

      results.sort((a, b) => b.daysOverdue - a.daysOverdue)
      return results
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
