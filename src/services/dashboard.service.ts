import { Effect } from "effect"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { auditLog } from "@/lib/db/schema/audit"
import { customers } from "@/lib/db/schema/customers"
import { eq, isNull, desc, and, inArray, asc, sql } from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import { computeLoanOverdueInfo } from "@/lib/interest/overdue"
import { getLoanBalancesFromLedger } from "@/services/transaction.service"
import BigNumber from "bignumber.js"
import type { DashboardKPIs, ActivityFeedItem, LoanType } from "@/types"

export const getDashboardKPIs = (): Effect.Effect<DashboardKPIs, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      // Derive aggregate KPIs from the ledger (single source of truth)
      const ledgerRows = await db
        .select({
          categoryName: transactionCategories.name,
          txType: transactions.type,
          referenceType: transactions.referenceType,
          total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
        })
        .from(transactions)
        .innerJoin(
          transactionCategories,
          eq(transactions.categoryId, transactionCategories.id)
        )
        .where(
          inArray(transactionCategories.name, [
            "Loans Receivable",
            "Interest Earned",
            "Cash",
            "Creditor Investment",
          ])
        )
        .groupBy(
          transactionCategories.name,
          transactions.type,
          transactions.referenceType
        )

      let loansReceivableDr = new BigNumber(0)
      let loansReceivableCr = new BigNumber(0)
      let interestEarnedCr = new BigNumber(0)
      let interestEarnedDr = new BigNumber(0)
      let cashDrFromPayments = new BigNumber(0)
      let cashCrFromPayments = new BigNumber(0)
      let creditorInvestmentDr = new BigNumber(0)
      let creditorInvestmentCr = new BigNumber(0)

      for (const row of ledgerRows) {
        const amount = new BigNumber(row.total)
        const isDebit = row.txType === "debit"

        if (row.categoryName === "Loans Receivable") {
          if (isDebit) loansReceivableDr = loansReceivableDr.plus(amount)
          else loansReceivableCr = loansReceivableCr.plus(amount)
        } else if (row.categoryName === "Interest Earned") {
          if (isDebit) interestEarnedDr = interestEarnedDr.plus(amount)
          else interestEarnedCr = interestEarnedCr.plus(amount)
        } else if (row.categoryName === "Cash") {
          // Only count cash movements from payment activity
          if (row.referenceType === "payment" || row.referenceType === "payment_reversal") {
            if (isDebit) cashDrFromPayments = cashDrFromPayments.plus(amount)
            else cashCrFromPayments = cashCrFromPayments.plus(amount)
          }
        } else if (row.categoryName === "Creditor Investment") {
          if (isDebit) creditorInvestmentDr = creditorInvestmentDr.plus(amount)
          else creditorInvestmentCr = creditorInvestmentCr.plus(amount)
        }
      }

      // Asset: DR adds, CR subtracts
      const loansOutstanding = loansReceivableDr.minus(loansReceivableCr)
      // Revenue: CR adds, DR subtracts
      const interestEarned = interestEarnedCr.minus(interestEarnedDr)
      // Net cash received from borrower payments (debits minus reversal credits)
      const repaymentsCollected = cashDrFromPayments.minus(cashCrFromPayments)
      // Liability: CR adds, DR subtracts
      const capitalInSystem = creditorInvestmentCr.minus(creditorInvestmentDr)

      // Overdue count — needs per-loan payment data for interest accrual math
      const activeLoans = await db
        .select()
        .from(loans)
        .where(and(eq(loans.status, "active"), isNull(loans.deletedAt)))

      const loanIds = activeLoans.map((l) => l.id)
      const allPayments =
        loanIds.length > 0
          ? await db
              .select()
              .from(payments)
              .where(and(inArray(payments.loanId, loanIds), isNull(payments.deletedAt)))
              .orderBy(asc(payments.paymentDate))
          : []

      const paymentsByLoanId = new Map<string, (typeof allPayments)[number][]>()
      for (const p of allPayments) {
        const existing = paymentsByLoanId.get(p.loanId) ?? []
        existing.push(p)
        paymentsByLoanId.set(p.loanId, existing)
      }

      // Batch-fetch per-loan outstanding balances from ledger
      const ledgerBalances = await getLoanBalancesFromLedger(loanIds)

      let overdueCount = 0

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
        if (info.daysOverdue >= 30) {
          overdueCount++
        }
      }

      const activeBorrowers = new Set(activeLoans.map((l) => l.customerId)).size

      return {
        loansOutstanding: loansOutstanding.toFixed(2),
        repaymentsCollected: repaymentsCollected.toFixed(2),
        interestEarned: interestEarned.toFixed(2),
        activeBorrowers,
        overdueCount,
        capitalInSystem: capitalInSystem.toFixed(2),
      }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

const formatAmount = (amount: string | number | undefined): string => {
  if (amount === undefined || amount === null) return "?"
  const n = typeof amount === "string" ? parseFloat(amount) : amount
  return n.toLocaleString("en-US")
}

export const getRecentActivity = (): Effect.Effect<ActivityFeedItem[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const recentEntries = await db
        .select()
        .from(auditLog)
        .where(inArray(auditLog.entityType, ["loan", "payment"]))
        .orderBy(desc(auditLog.occurredAt))
        .limit(10)

      const items: ActivityFeedItem[] = []

      for (const entry of recentEntries) {
        let type: ActivityFeedItem["type"] = "payment_received"
        let description = ""
        let loanId: string | undefined
        let customerId: string | undefined
        let detail: ActivityFeedItem["detail"]

        if (entry.entityType === "loan" && entry.action === "loan.create") {
          type = "loan_issued"
          const afterVal = entry.afterValue ? JSON.parse(entry.afterValue) : {}
          const amount = formatAmount(afterVal.principalAmount)
          customerId = afterVal.customerId as string | undefined
          loanId = entry.entityId

          let customerName: string | undefined
          if (customerId) {
            const [customer] = await db
              .select({ fullName: customers.fullName })
              .from(customers)
              .where(eq(customers.id, customerId))
              .limit(1)
            customerName = customer?.fullName
          }

          description = customerName
            ? `Loan issued to ${customerName} — UGX ${amount}`
            : `Loan issued — UGX ${amount}`

          detail = {
            amount: afterVal.principalAmount,
            collateral: afterVal.collateral?.nature,
          }
        } else if (entry.entityType === "payment" && entry.action === "payment.create") {
          type = "payment_received"
          const afterVal = entry.afterValue ? JSON.parse(entry.afterValue) : {}
          const amount = formatAmount(afterVal.amount)
          loanId = afterVal.loanId as string | undefined
          description = `Payment received — UGX ${amount}`
          detail = {
            interestPortion: afterVal.interestPortion,
            principalPortion: afterVal.principalPortion,
          }
        } else if (entry.entityType === "payment" && entry.action === "payment.delete") {
          type = "payment_received"
          description = "Payment deleted"
        } else if (entry.entityType === "payment" && entry.action === "payment.update") {
          type = "payment_received"
          description = "Payment updated"
        } else {
          description = `${entry.entityType} ${entry.action}`
        }

        items.push({
          id: entry.id,
          type,
          description,
          timestamp: entry.occurredAt,
          loanId,
          customerId,
          detail,
        })
      }

      return items
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
