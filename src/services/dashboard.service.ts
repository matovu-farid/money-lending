import { Effect } from "effect"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { auditLog } from "@/lib/db/schema/audit"
import { customers } from "@/lib/db/schema/customers"
import { eq, isNull, sum, desc, and, inArray } from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import { calculateDaysOverdue, calculateDailyRate, calculateInterest } from "@/lib/interest"
import { getSystemCapital } from "@/services/creditor.service"
import BigNumber from "bignumber.js"
import type { DashboardKPIs, ActivityFeedItem } from "@/types"

export const getDashboardKPIs = (): Effect.Effect<DashboardKPIs, DatabaseError> =>
  Effect.flatMap(
    getSystemCapital(),
    (systemCapital) =>
      Effect.tryPromise({
        try: async () => {
          const activeLoans = await db
            .select()
            .from(loans)
            .where(and(eq(loans.status, "active"), isNull(loans.deletedAt)))

          let totalOutstanding = new BigNumber(0)
          let overdueCount = 0
          const now = new Date()

          for (const loan of activeLoans) {
            const loanPayments = await db
              .select()
              .from(payments)
              .where(and(eq(payments.loanId, loan.id), isNull(payments.deletedAt)))
              .orderBy(desc(payments.paymentDate), desc(payments.createdAt))

            const lastPayment = loanPayments[0]
            const outstanding = lastPayment
              ? new BigNumber(lastPayment.principalBalanceAfter)
              : new BigNumber(loan.principalAmount)
            totalOutstanding = totalOutstanding.plus(outstanding)

            const totalDaysElapsed = Math.floor(
              (now.getTime() - new Date(loan.startDate).getTime()) / (1000 * 60 * 60 * 24)
            )
            const effectiveRate = loan.interestRateOverride ?? loan.interestRate
            const dailyRate = calculateDailyRate(effectiveRate)
            // Use actual days for accrual — min period only applies to payment allocation
            const totalInterestAccrued = calculateInterest(
              loan.principalAmount, effectiveRate, totalDaysElapsed, 0
            )
            const totalInterestPaid = loanPayments.reduce(
              (s, p) => s.plus(new BigNumber(p.interestPortion)), new BigNumber(0)
            )
            const dailyInterestAmount = new BigNumber(loan.principalAmount).multipliedBy(dailyRate)
            const daysOverdue = calculateDaysOverdue(
              totalInterestAccrued, totalInterestPaid, dailyInterestAmount
            )
            if (daysOverdue.isGreaterThanOrEqualTo(30)) {
              overdueCount++
            }
          }

          const [paymentStats] = await db
            .select({
              totalCollected: sum(payments.amount),
              totalInterestEarned: sum(payments.interestPortion),
            })
            .from(payments)
            .where(isNull(payments.deletedAt))

          const activeBorrowers = new Set(activeLoans.map(l => l.customerId)).size

          return {
            loansOutstanding: totalOutstanding.toFixed(2),
            repaymentsCollected: new BigNumber(paymentStats?.totalCollected ?? "0").toFixed(2),
            interestEarned: new BigNumber(paymentStats?.totalInterestEarned ?? "0").toFixed(2),
            activeBorrowers,
            overdueCount,
            capitalInSystem: systemCapital.totalOutstanding,
          }
        },
        catch: (e) => new DatabaseError({ cause: e }),
      })
  )

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
