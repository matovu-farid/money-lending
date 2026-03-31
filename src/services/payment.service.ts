import { Effect } from "effect"
import { db } from "@/lib/db"
import { payments } from "@/lib/db/schema/payments"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { transactions } from "@/lib/db/schema/transactions"
import { eq, asc, and, isNull, gte, lte, ilike, desc, count, sql } from "drizzle-orm"
import { DatabaseError, LoanNotFound, PaymentNotFound } from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import { allocatePayment } from "@/lib/interest/engine"
import { autoPostInterestEarned } from "./transaction.service"
import BigNumber from "bignumber.js"
import type {
  RecordPaymentInput,
  EditPaymentInput,
  DeletePaymentInput,
  Payment,
  ListPaymentsInput,
  PaymentWithCustomer,
  ActiveLoanSearchResult,
  RecentlyCollectedLoan,
} from "@/types"

function escapeLikePattern(input: string): string {
  return input.replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}

async function recalculateFromPayment(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  loanId: string,
  fromIndex: number,
  orderedPayments: Payment[]
): Promise<void> {
  if (orderedPayments.length === 0 || fromIndex >= orderedPayments.length) return

  const [loan] = await tx.select().from(loans).where(eq(loans.id, loanId))
  if (!loan) return

  const monthlyRateDecimal = loan.interestRateOverride ?? loan.interestRate
  const minInterestDays = loan.minPeriodOverride ?? loan.minInterestDays

  for (let i = fromIndex; i < orderedPayments.length; i++) {
    const current = orderedPayments[i]

    const principalBalanceBefore = i === 0
      ? loan.principalAmount
      : orderedPayments[i - 1].principalBalanceAfter

    const prevDate = i === 0
      ? new Date(loan.startDate)
      : new Date(orderedPayments[i - 1].paymentDate)
    const daysElapsed = daysBetween(prevDate, new Date(current.paymentDate))

    const allocation = allocatePayment({
      paymentAmount: current.amount,
      principalBalanceBefore,
      monthlyRateDecimal,
      daysElapsed,
      minInterestDays,
    })

    await tx
      .update(payments)
      .set({
        interestPortion: allocation.interestPortion,
        principalPortion: allocation.principalPortion,
        principalBalanceBefore: allocation.principalBalanceBefore,
        principalBalanceAfter: allocation.principalBalanceAfter,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, current.id))

    orderedPayments[i] = {
      ...current,
      interestPortion: allocation.interestPortion,
      principalPortion: allocation.principalPortion,
      principalBalanceBefore: allocation.principalBalanceBefore,
      principalBalanceAfter: allocation.principalBalanceAfter,
    }
  }
}

export const recordPayment = (
  input: RecordPaymentInput,
  actorId: string
): Effect.Effect<Payment, LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [loan] = await db.select().from(loans).where(eq(loans.id, input.loanId))
      if (!loan) throw { _tag: "LoanNotFound", id: input.loanId }

      const monthlyRateDecimal = loan.interestRateOverride ?? loan.interestRate
      const minInterestDays = loan.minPeriodOverride ?? loan.minInterestDays

      return await db.transaction(async (tx) => {
        const activePayments = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, input.loanId), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

        const principalBalanceBefore =
          activePayments.length === 0
            ? loan.principalAmount
            : activePayments[activePayments.length - 1].principalBalanceAfter

        const prevDate =
          activePayments.length === 0
            ? new Date(loan.startDate)
            : new Date(activePayments[activePayments.length - 1].paymentDate)
        const daysElapsed = daysBetween(prevDate, new Date(input.paymentDate))

        const allocation = allocatePayment({
          paymentAmount: input.amount,
          principalBalanceBefore,
          monthlyRateDecimal,
          daysElapsed,
          minInterestDays,
        })

        const [newPayment] = await tx
          .insert(payments)
          .values({
            loanId: input.loanId,
            paymentDate: new Date(input.paymentDate),
            amount: input.amount,
            interestPortion: allocation.interestPortion,
            principalPortion: allocation.principalPortion,
            principalBalanceBefore: allocation.principalBalanceBefore,
            principalBalanceAfter: allocation.principalBalanceAfter,
            recordedBy: actorId,
          })
          .returning()

        if (allocation.loanFullyPaid) {
          await tx
            .update(loans)
            .set({ status: "fully_paid", updatedAt: new Date() })
            .where(eq(loans.id, input.loanId))
        }

        await writeAuditLog(tx, {
          actorId,
          action: "payment.create",
          entityType: "payment",
          entityId: newPayment.id,
          beforeValue: null,
          afterValue: newPayment,
        })

        if (new BigNumber(allocation.interestPortion).isGreaterThan(0)) {
          await autoPostInterestEarned(tx, {
            amount: allocation.interestPortion,
            loanId: input.loanId,
            paymentId: newPayment.id,
            paymentDate: input.paymentDate,
            actorId,
          })
        }

        return newPayment
      })
    },
    catch: (e: any) => {
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

export const editPayment = (
  input: EditPaymentInput,
  actorId: string
): Effect.Effect<Payment, PaymentNotFound | LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [payment] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, input.paymentId))
      if (!payment || payment.deletedAt !== null)
        throw { _tag: "PaymentNotFound", id: input.paymentId }

      const [loan] = await db.select().from(loans).where(eq(loans.id, payment.loanId))
      if (!loan) throw { _tag: "LoanNotFound", id: payment.loanId }

      const beforeValue = { ...payment }

      return await db.transaction(async (tx) => {
        const updates: {
          updatedAt: Date
          editReason: string
          amount?: string
          paymentDate?: Date
        } = {
          updatedAt: new Date(),
          editReason: input.reason,
        }
        if (input.amount !== undefined) updates.amount = input.amount
        if (input.paymentDate !== undefined)
          updates.paymentDate = new Date(input.paymentDate)

        await tx.update(payments).set(updates).where(eq(payments.id, input.paymentId))

        const allActive = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, payment.loanId), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

        const paymentIndex = allActive.findIndex((p) => p.id === input.paymentId)

        if (paymentIndex !== -1) {
          await recalculateFromPayment(tx, payment.loanId, paymentIndex, allActive)
        }

        const refreshed = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, payment.loanId), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

        if (refreshed.length > 0) {
          const lastBalance = refreshed[refreshed.length - 1].principalBalanceAfter
          if (new BigNumber(lastBalance).isZero()) {
            await tx
              .update(loans)
              .set({ status: "fully_paid", updatedAt: new Date() })
              .where(eq(loans.id, payment.loanId))
          } else if (loan.status === "fully_paid") {
            await tx
              .update(loans)
              .set({ status: "active", updatedAt: new Date() })
              .where(eq(loans.id, payment.loanId))
          }
        }

        const [updatedPayment] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, input.paymentId))

        await writeAuditLog(tx, {
          actorId,
          action: "payment.update",
          entityType: "payment",
          entityId: input.paymentId,
          beforeValue,
          afterValue: { ...updatedPayment, reason: input.reason },
        })

        await tx
          .delete(transactions)
          .where(
            and(
              eq(transactions.referenceType, "payment"),
              eq(transactions.referenceId, input.paymentId)
            )
          )

        const newInterestPortion = updatedPayment.interestPortion
        if (new BigNumber(newInterestPortion).isGreaterThan(0)) {
          await autoPostInterestEarned(tx, {
            amount: newInterestPortion,
            loanId: payment.loanId,
            paymentId: input.paymentId,
            paymentDate: updatedPayment.paymentDate.toISOString(),
            actorId,
          })
        }

        return updatedPayment
      })
    },
    catch: (e: any) => {
      if (e?._tag === "PaymentNotFound") return new PaymentNotFound({ id: e.id })
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

export const deletePayment = (
  input: DeletePaymentInput,
  actorId: string
): Effect.Effect<Payment, PaymentNotFound | LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [payment] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, input.paymentId))
      if (!payment || payment.deletedAt !== null)
        throw { _tag: "PaymentNotFound", id: input.paymentId }

      const [loan] = await db.select().from(loans).where(eq(loans.id, payment.loanId))
      if (!loan) throw { _tag: "LoanNotFound", id: payment.loanId }

      const now = new Date()
      const softDeletedPayment = {
        ...payment,
        deletedAt: now,
        deletedBy: actorId,
        deleteReason: input.reason,
      }

      return await db.transaction(async (tx) => {
        await tx
          .update(payments)
          .set({
            deletedAt: now,
            deletedBy: actorId,
            deleteReason: input.reason,
            updatedAt: now,
          })
          .where(eq(payments.id, input.paymentId))

        const remainingActive = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, payment.loanId), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

        const deletedDate = new Date(payment.paymentDate).getTime()
        const fromIndex = remainingActive.findIndex(
          (p) => new Date(p.paymentDate).getTime() >= deletedDate
        )

        if (fromIndex !== -1 && remainingActive.length > 0) {
          await recalculateFromPayment(tx, payment.loanId, fromIndex, remainingActive)
        }

        const refreshed = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, payment.loanId), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

        if (refreshed.length === 0) {
          await tx
            .update(loans)
            .set({ status: "active", updatedAt: now })
            .where(eq(loans.id, payment.loanId))
        } else {
          const lastBalance = refreshed[refreshed.length - 1].principalBalanceAfter
          if (new BigNumber(lastBalance).isZero()) {
            await tx
              .update(loans)
              .set({ status: "fully_paid", updatedAt: now })
              .where(eq(loans.id, payment.loanId))
          } else if (loan.status === "fully_paid") {
            await tx
              .update(loans)
              .set({ status: "active", updatedAt: now })
              .where(eq(loans.id, payment.loanId))
          }
        }

        await writeAuditLog(tx, {
          actorId,
          action: "payment.delete",
          entityType: "payment",
          entityId: input.paymentId,
          beforeValue: payment,
          afterValue: softDeletedPayment,
        })

        await tx
          .delete(transactions)
          .where(
            and(
              eq(transactions.referenceType, "payment"),
              eq(transactions.referenceId, input.paymentId)
            )
          )

        const [deletedRow] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, input.paymentId))
        return deletedRow
      })
    },
    catch: (e: any) => {
      if (e?._tag === "PaymentNotFound") return new PaymentNotFound({ id: e.id })
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

export const listPayments = (
  input: ListPaymentsInput
): Effect.Effect<{ rows: PaymentWithCustomer[]; total: number }, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const page = input.page ?? 1
      const pageSize = input.pageSize ?? 25
      const offset = (page - 1) * pageSize

      const conditions = [isNull(payments.deletedAt)]
      if (input.dateFrom) conditions.push(gte(payments.paymentDate, new Date(input.dateFrom)))
      if (input.dateTo) conditions.push(lte(payments.paymentDate, new Date(input.dateTo + "T23:59:59.999Z")))
      if (input.amountMin) conditions.push(gte(payments.amount, input.amountMin))
      if (input.amountMax) conditions.push(lte(payments.amount, input.amountMax))
      if (input.customerName) conditions.push(ilike(customers.fullName, `%${escapeLikePattern(input.customerName)}%`))

      const where = and(...conditions)

      const [rows, [{ value: total }]] = await Promise.all([
        db
          .select({
            id: payments.id,
            loanId: payments.loanId,
            customerId: loans.customerId,
            customerName: customers.fullName,
            paymentDate: payments.paymentDate,
            amount: payments.amount,
            interestPortion: payments.interestPortion,
            principalPortion: payments.principalPortion,
            principalBalanceAfter: payments.principalBalanceAfter,
            recordedBy: payments.recordedBy,
            createdAt: payments.createdAt,
          })
          .from(payments)
          .innerJoin(loans, eq(payments.loanId, loans.id))
          .innerJoin(customers, eq(loans.customerId, customers.id))
          .where(where)
          .orderBy(desc(payments.paymentDate), desc(payments.createdAt))
          .limit(pageSize)
          .offset(offset),
        db
          .select({ value: count() })
          .from(payments)
          .innerJoin(loans, eq(payments.loanId, loans.id))
          .innerJoin(customers, eq(loans.customerId, customers.id))
          .where(where),
      ])

      return { rows: rows as PaymentWithCustomer[], total: Number(total) }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const getPaymentsForLoan = (
  loanId: string
): Effect.Effect<Payment[], LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [loan] = await db.select().from(loans).where(eq(loans.id, loanId))
      if (!loan) throw { _tag: "LoanNotFound", id: loanId }

      return await db
        .select()
        .from(payments)
        .where(eq(payments.loanId, loanId))
        .orderBy(asc(payments.paymentDate), asc(payments.createdAt))
    },
    catch: (e: any) => {
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

export const searchActiveLoans = (
  query: string
): Effect.Effect<ActiveLoanSearchResult[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      if (!query || query.trim().length < 2) return []
      const rows = await db
        .select({
          loanId: loans.id,
          customerId: customers.id,
          customerName: customers.fullName,
          principalAmount: loans.principalAmount,
        })
        .from(loans)
        .innerJoin(customers, eq(loans.customerId, customers.id))
        .where(
          and(
            eq(loans.status, "active"),
            isNull(loans.deletedAt),
            ilike(customers.fullName, `%${escapeLikePattern(query.trim())}%`)
          )
        )
        .limit(10)
      return rows
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const getRecentlyCollectedLoans = (
  userId: string,
  limit: number = 5
): Effect.Effect<RecentlyCollectedLoan[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db.execute(sql`
        SELECT * FROM (
          SELECT DISTINCT ON (p.loan_id)
            p.loan_id,
            c.full_name AS customer_name,
            p.payment_date
          FROM payments p
          INNER JOIN loans l ON l.id = p.loan_id
          INNER JOIN customers c ON c.id = l.customer_id
          WHERE p.recorded_by = ${userId}
            AND p.deleted_at IS NULL
          ORDER BY p.loan_id, p.payment_date DESC
        ) sub
        ORDER BY sub.payment_date DESC
        LIMIT ${limit}
      `)
      return Array.from(rows).map((row: any) => ({
        loanId: row.loan_id as string,
        customerName: row.customer_name as string,
        paymentDate: new Date(row.payment_date as string),
      }))
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
