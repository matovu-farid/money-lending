import { Effect } from "effect"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { collateral } from "@/lib/db/schema/collateral"
import { payments } from "@/lib/db/schema/payments"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { customers } from "@/lib/db/schema/customers"
import { eq, and, isNull, asc } from "drizzle-orm"
import BigNumber from "bignumber.js"
import { DatabaseError, LoanNotFound, ValidationError } from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import { calculateInterest, formatAmount } from "@/lib/interest/engine"
import { daysBetween } from "@/lib/db/utils"
import type { SettleWithCollateralInput, Loan } from "@/types"

/**
 * Helper to get or auto-create a transaction category by name and type.
 */
async function getOrCreateCategory(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  name: string,
  type: "income" | "expense" | "balance_sheet"
): Promise<{ id: string; name: string; type: string }> {
  let [category] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, name),
        eq(transactionCategories.type, type)
      )
    )

  if (!category) {
    ;[category] = await tx
      .insert(transactionCategories)
      .values({ name, type, isDefault: true })
      .returning()
  }

  return category
}

/**
 * Computes accrued interest for a loan given its active payments.
 *
 * For perpetual loans: total interest accrued from start date minus total interest paid.
 * For fixed_rate: monthly interest on original principal × elapsed months.
 * For reducing_balance: monthly interest on outstanding principal.
 */
export function computeAccruedInterest(
  loan: Loan,
  activePayments: { interestPortion: string; paymentDate: Date; principalBalanceAfter: string }[]
): BigNumber {
  const loanType = loan.loanType ?? "perpetual"
  const monthlyRateDecimal = loan.interestRateOverride ?? loan.interestRate
  const minInterestDays = loan.minPeriodOverride ?? loan.minInterestDays

  const outstandingPrincipal =
    activePayments.length === 0
      ? new BigNumber(loan.principalAmount)
      : new BigNumber(activePayments[activePayments.length - 1].principalBalanceAfter)

  const now = new Date()

  if (loanType === "perpetual") {
    // Total interest accrued from start date to now
    const prevDate =
      activePayments.length === 0
        ? new Date(loan.startDate)
        : new Date(activePayments[activePayments.length - 1].paymentDate)
    const daysElapsed = daysBetween(prevDate, now)
    const totalAccrued = calculateInterest(
      outstandingPrincipal.toFixed(2),
      monthlyRateDecimal,
      daysElapsed,
      minInterestDays
    )
    return totalAccrued
  }

  if (loanType === "fixed_rate") {
    // Monthly interest on original principal
    const monthlyInterest = new BigNumber(loan.principalAmount).multipliedBy(
      new BigNumber(monthlyRateDecimal)
    )
    return monthlyInterest
  }

  if (loanType === "reducing_balance") {
    // Monthly interest on outstanding principal
    const monthlyInterest = outstandingPrincipal.multipliedBy(
      new BigNumber(monthlyRateDecimal)
    )
    return monthlyInterest
  }

  // Fallback: perpetual
  const prevDate =
    activePayments.length === 0
      ? new Date(loan.startDate)
      : new Date(activePayments[activePayments.length - 1].paymentDate)
  const daysElapsed = daysBetween(prevDate, now)
  return calculateInterest(
    outstandingPrincipal.toFixed(2),
    monthlyRateDecimal,
    daysElapsed,
    minInterestDays
  )
}

/**
 * Settles a loan by seizing collateral.
 *
 * - Validates loan exists, is active, not deleted
 * - In a transaction:
 *   - Computes outstanding principal and accrued interest
 *   - Posts accrued interest as "Interest Earned" credit transaction
 *   - Posts outstanding principal as "Collateral Recovery" credit transaction
 *   - Marks collateral as seized
 *   - Updates loan status to "settled_with_collateral"
 *   - Writes audit log
 */
export const settleWithCollateral = (
  input: SettleWithCollateralInput,
  actorId: string
): Effect.Effect<Loan, LoanNotFound | ValidationError | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [loan] = await db
        .select()
        .from(loans)
        .where(and(eq(loans.id, input.loanId), isNull(loans.deletedAt)))

      if (!loan) throw { _tag: "LoanNotFound", id: input.loanId }

      if (loan.status !== "active") {
        throw {
          _tag: "ValidationError",
          message: `Loan must be active to settle with collateral. Current status: ${loan.status}`,
          field: "loanId",
        }
      }

      return await db.transaction(async (tx) => {
        const activePayments = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, input.loanId), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

        // Outstanding principal
        const outstandingPrincipal =
          activePayments.length === 0
            ? new BigNumber(loan.principalAmount)
            : new BigNumber(activePayments[activePayments.length - 1].principalBalanceAfter)

        // Accrued interest
        const accruedInterest = computeAccruedInterest(loan as Loan, activePayments)

        const now = new Date()

        // Post accrued interest as "Interest Earned" credit transaction
        if (accruedInterest.isGreaterThan(0)) {
          const interestCategory = await getOrCreateCategory(tx, "Interest Earned", "income")
          await tx.insert(transactions).values({
            type: "credit",
            amount: formatAmount(accruedInterest),
            categoryId: interestCategory.id,
            referenceType: "collateral_settlement",
            referenceId: input.loanId,
            description: `Accrued interest on collateral settlement for loan ${input.loanId.slice(0, 8).toUpperCase()}`,
            transactionDate: now,
            recordedBy: actorId,
          })
        }

        // Post outstanding principal as "Collateral Recovery" credit transaction
        if (outstandingPrincipal.isGreaterThan(0)) {
          const recoveryCategory = await getOrCreateCategory(tx, "Principal Recovery", "balance_sheet")
          await tx.insert(transactions).values({
            type: "credit",
            amount: formatAmount(outstandingPrincipal),
            categoryId: recoveryCategory.id,
            referenceType: "collateral_settlement",
            referenceId: input.loanId,
            description: `Principal recovered via collateral seizure for loan ${input.loanId.slice(0, 8).toUpperCase()}`,
            transactionDate: now,
            recordedBy: actorId,
          })
        }

        // Mark collateral as seized
        await tx
          .update(collateral)
          .set({ seizedAt: now, seizedBy: actorId })
          .where(eq(collateral.loanId, input.loanId))

        // Update loan status to settled_with_collateral
        const [updatedLoan] = await tx
          .update(loans)
          .set({ status: "settled_with_collateral", updatedAt: now })
          .where(eq(loans.id, input.loanId))
          .returning()

        // Audit log
        await writeAuditLog(tx, {
          actorId,
          action: "loan.settle_with_collateral",
          entityType: "loan",
          entityId: input.loanId,
          beforeValue: loan,
          afterValue: {
            ...updatedLoan,
            reason: input.reason,
            outstandingPrincipal: formatAmount(outstandingPrincipal),
            accruedInterest: formatAmount(accruedInterest),
          },
        })

        return updatedLoan as Loan
      })
    },
    catch: (e: any) => {
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      if (e instanceof ValidationError) return e
      if (e?._tag === "ValidationError")
        return new ValidationError({ message: e.message, field: e.field })
      return new DatabaseError({ cause: e })
    },
  })

/**
 * Returns the active (non-deleted) loan for a customer along with summary figures,
 * or null if the customer has no active loan.
 */
export async function getCustomerActiveLoan(customerId: string): Promise<{
  loan: Loan
  customerName: string
  outstandingPrincipal: string
  accruedInterest: string
} | null> {
  const [row] = await db
    .select({
      loan: loans,
      customerName: customers.fullName,
    })
    .from(loans)
    .innerJoin(customers, eq(loans.customerId, customers.id))
    .where(
      and(
        eq(loans.customerId, customerId),
        eq(loans.status, "active"),
        isNull(loans.deletedAt)
      )
    )
    .limit(1)

  if (!row) return null

  const { loan, customerName } = row

  const activePayments = await db
    .select()
    .from(payments)
    .where(and(eq(payments.loanId, loan.id), isNull(payments.deletedAt)))
    .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

  const outstandingPrincipal =
    activePayments.length === 0
      ? new BigNumber(loan.principalAmount)
      : new BigNumber(activePayments[activePayments.length - 1].principalBalanceAfter)

  const accruedInterest = computeAccruedInterest(loan, activePayments)

  return {
    loan,
    customerName: customerName ?? "",
    outstandingPrincipal: formatAmount(outstandingPrincipal),
    accruedInterest: formatAmount(accruedInterest),
  }
}
