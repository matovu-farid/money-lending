import { Effect } from "effect"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { transactions } from "@/lib/db/schema/transactions"
import { getBaseRate } from "@/lib/interest/effective-rate"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { auditLog } from "@/lib/db/schema/audit"
import { customers } from "@/lib/db/schema/customers"
import { user } from "@/lib/db/schema/auth"
import { eq, isNull, desc, and, inArray, asc, sql } from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import { computeLoanOverdueInfo } from "@/lib/interest/overdue"
import { getLoanBalancesFromLedger, getInterestEarnedFromLedger } from "@/services/ledger-queries.service"
import { formatAmount as formatBigNumber } from "@/lib/interest/engine"
import BigNumber from "bignumber.js"
import { toLoanType, type DashboardKPIs, type ActivityFeedItem } from "@/types"

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
      let cashDrTotal = new BigNumber(0)
      let cashCrTotal = new BigNumber(0)

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
          if (isDebit) cashDrTotal = cashDrTotal.plus(amount)
          else cashCrTotal = cashCrTotal.plus(amount)
          // Also track payment-specific cash for repayments KPI
          if (row.referenceType === "payment" || row.referenceType === "payment_reversal") {
            if (isDebit) cashDrFromPayments = cashDrFromPayments.plus(amount)
            else cashCrFromPayments = cashCrFromPayments.plus(amount)
          }
        }
      }

      // Asset: DR adds, CR subtracts
      const loansOutstanding = loansReceivableDr.minus(loansReceivableCr)
      // Revenue: CR adds, DR subtracts
      const interestEarned = interestEarnedCr.minus(interestEarnedDr)
      // Net cash received from borrower payments (debits minus reversal credits)
      const repaymentsCollected = cashDrFromPayments.minus(cashCrFromPayments)
      // Asset: DR adds, CR subtracts — total cash across all locations
      const capitalInSystem = cashDrTotal.minus(cashCrTotal)

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
              .where(and(inArray(payments.loanId, loanIds), isNull(payments.deletedAt), eq(payments.markedWrong, false)))
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
      const interestEarnedMap = await getInterestEarnedFromLedger(loanIds)

      let overdueCount = 0

      for (const loan of activeLoans) {
        const loanPayments = paymentsByLoanId.get(loan.id) ?? []
        const baseRate = getBaseRate(loan)
        const ledgerBalance = ledgerBalances.get(loan.id)
        if (ledgerBalance === undefined) {
          console.warn(`[getDashboardKPIs] No ledger entries for loan ${loan.id}, using principalAmount as fallback`)
        }
        const outstandingBalance = ledgerBalance !== undefined
          ? ledgerBalance.toFixed(0)
          : loan.principalAmount
        const info = computeLoanOverdueInfo({
          principalAmount: loan.principalAmount,
          baseRate,
          startDate: new Date(loan.startDate),
          loanType: toLoanType(loan.loanType),
          termMonths: loan.termMonths,
          totalInterestPaid: formatBigNumber(interestEarnedMap.get(loan.id) ?? new BigNumber(0)),
          paymentCount: loanPayments.length,
          outstandingBalance,
          penaltyWaived: loan.penaltyWaived,
          loan,
        })
        if (info.daysOverdue >= 30) {
          overdueCount++
        }
      }

      const activeBorrowers = new Set(activeLoans.map((l) => l.customerId)).size

      return {
        loansOutstanding: loansOutstanding.toFixed(0),
        repaymentsCollected: repaymentsCollected.toFixed(0),
        interestEarned: interestEarned.toFixed(0),
        activeBorrowers,
        overdueCount,
        capitalInSystem: capitalInSystem.toFixed(0),
      }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

const formatAmount = (amount: string | number | undefined): string => {
  if (amount === undefined || amount === null) return "?"
  const str = String(typeof amount === "number" ? amount : parseFloat(amount))
  const [int, dec] = str.split(".")
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return dec ? `${withCommas}.${dec}` : withCommas
}

export const getRecentActivity = (
  page = 1,
  pageSize = 10,
): Effect.Effect<{ items: ActivityFeedItem[]; total: number }, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(auditLog)
        .where(inArray(auditLog.entityType, ["loan", "payment"]))
      const total = Number(countResult?.count ?? 0)

      const recentEntries = await db
        .select({
          id: auditLog.id,
          actorId: auditLog.actorId,
          action: auditLog.action,
          entityType: auditLog.entityType,
          entityId: auditLog.entityId,
          beforeValue: auditLog.beforeValue,
          afterValue: auditLog.afterValue,
          occurredAt: auditLog.occurredAt,
          actorName: user.name,
        })
        .from(auditLog)
        .leftJoin(user, eq(auditLog.actorId, user.id))
        .where(inArray(auditLog.entityType, ["loan", "payment"]))
        .orderBy(desc(auditLog.occurredAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize)

      // Pre-fetch customer names for all loan.create entries to avoid N+1
      const customerIdsToFetch = new Set<string>()
      for (const entry of recentEntries) {
        if (entry.entityType === "loan" && entry.action === "loan.create") {
          const afterVal = entry.afterValue ? JSON.parse(entry.afterValue) : {}
          if (afterVal.customerId) customerIdsToFetch.add(afterVal.customerId)
        } else if (entry.entityType === "loan" && entry.action === "loan.rollover") {
          const beforeVal = entry.beforeValue ? JSON.parse(entry.beforeValue) : {}
          if (beforeVal.customerId) customerIdsToFetch.add(beforeVal.customerId)
        }
      }
      const customerNameMap = new Map<string, string>()
      if (customerIdsToFetch.size > 0) {
        const customerRows = await db
          .select({ id: customers.id, fullName: customers.fullName })
          .from(customers)
          .where(inArray(customers.id, [...customerIdsToFetch]))
        for (const row of customerRows) {
          customerNameMap.set(row.id, row.fullName)
        }
      }

      const items: ActivityFeedItem[] = []

      for (const entry of recentEntries) {
        let type: ActivityFeedItem["type"] = "payment_received"
        let description = ""
        let loanId: string | undefined
        let customerId: string | undefined
        let paymentId: string | undefined
        let detail: ActivityFeedItem["detail"]

        if (entry.entityType === "loan" && entry.action === "loan.create") {
          type = "loan_issued"
          const afterVal = entry.afterValue ? JSON.parse(entry.afterValue) : {}
          const amount = formatAmount(afterVal.principalAmount)
          customerId = afterVal.customerId as string | undefined
          loanId = entry.entityId

          const customerName = customerId ? customerNameMap.get(customerId) : undefined

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
          paymentId = entry.entityId
          description = `Payment received — UGX ${amount}`
          detail = {
            interestPortion: afterVal.interestPortion,
            principalPortion: afterVal.principalPortion,
          }
        } else if (entry.entityType === "loan" && entry.action === "loan.rollover") {
          type = "loan_issued"
          const beforeVal = entry.beforeValue ? JSON.parse(entry.beforeValue) : {}
          const afterVal = entry.afterValue ? JSON.parse(entry.afterValue) : {}
          customerId = beforeVal.customerId as string | undefined
          loanId = entry.entityId
          const customerName = customerId ? customerNameMap.get(customerId) : undefined
          const carriedTotal = new BigNumber(afterVal.carriedPrincipal ?? "0").plus(new BigNumber(afterVal.carriedInterest ?? "0"))
          const amount = formatAmount(carriedTotal.toFixed(0))
          description = customerName
            ? `Loan rolled over for ${customerName} — UGX ${amount}`
            : `Loan rolled over — UGX ${amount}`
          detail = { amount: carriedTotal.toFixed(0) }
        } else if (entry.entityType === "loan" && entry.action === "loan.update") {
          type = "loan_issued"
          loanId = entry.entityId
          description = "Loan details updated"
        } else if (entry.entityType === "loan" && entry.action === "loan.delete") {
          type = "loan_issued"
          loanId = entry.entityId
          description = "Loan deleted"
        } else if (entry.entityType === "loan" && entry.action === "loan.rate_change.immediate") {
          type = "loan_issued"
          loanId = entry.entityId
          description = "Loan rate changed"
        } else if (entry.entityType === "loan" && entry.action === "loan.rate_change.approved") {
          type = "loan_issued"
          loanId = entry.entityId
          description = "Loan rate change approved"
        } else if (entry.entityType === "loan" && entry.action === "loan.rate_change.rejected") {
          type = "loan_issued"
          loanId = entry.entityId
          description = "Loan rate change rejected"
        } else if (entry.entityType === "loan" && entry.action === "loan.settle_with_collateral") {
          type = "loan_issued"
          loanId = entry.entityId
          description = "Loan settled with collateral"
        } else if (entry.entityType === "payment" && entry.action === "payment.delete") {
          type = "payment_received"
          paymentId = entry.entityId
          const beforeVal = entry.beforeValue ? JSON.parse(entry.beforeValue) : {}
          loanId = beforeVal.loanId as string | undefined
          description = "Payment deleted"
        } else if (entry.entityType === "payment" && entry.action === "payment.update") {
          type = "payment_received"
          paymentId = entry.entityId
          const afterVal = entry.afterValue ? JSON.parse(entry.afterValue) : {}
          loanId = afterVal.loanId as string | undefined
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
          paymentId,
          actorName: entry.actorName ?? undefined,
          detail,
        })
      }

      return { items, total }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
