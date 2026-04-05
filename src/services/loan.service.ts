import { Effect } from "effect"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { collateral } from "@/lib/db/schema/collateral"
import { payments } from "@/lib/db/schema/payments"
import { customers } from "@/lib/db/schema/customers"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { eq, desc, and, isNull } from "drizzle-orm"
import BigNumber from "bignumber.js"
import {
  DatabaseError,
  CustomerNotFound,
  LoanNotFound,
  IncompleteLoanRequirements,
  ValidationError,
} from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import type { CreateLoanInput, UpdateLoanInput, DeleteLoanInput, Loan, LoanWithCustomer } from "@/types"

const checkCustomerCompleteness = (customer: {
  fullName: string | null
  contact: string | null
  address: string | null
}): string[] => {
  const missing: string[] = []
  if (!customer.fullName?.trim()) missing.push("fullName")
  if (!customer.contact?.trim()) missing.push("contact")
  if (!customer.address?.trim()) missing.push("address")
  return missing
}

export const createLoan = (
  input: CreateLoanInput,
  actorId: string
): Effect.Effect<
  Loan & { collateral: { id: string; nature: string; description: string | null } },
  CustomerNotFound | IncompleteLoanRequirements | DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, input.customerId))

      if (!customer) throw { _tag: "CustomerNotFound", id: input.customerId }

      if (customer.status === "blacklisted") {
        throw new ValidationError({ message: "This customer is blacklisted and cannot receive new loans.", field: "customerId" })
      }

      const missingFields = checkCustomerCompleteness(customer)
      if (missingFields.length > 0) {
        throw { _tag: "IncompleteLoanRequirements", missing: missingFields }
      }

      const startDate = new Date(input.startDate)

      return await db.transaction(async (tx) => {
        const [loan] = await tx
          .insert(loans)
          .values({
            customerId: input.customerId,
            principalAmount: input.principalAmount,
            issuanceFee: input.issuanceFee,
            description: input.description,
            interestRate: input.interestRate,
            minInterestDays: input.minInterestDays,
            startDate,
            status: "active",
            interestRateOverride: input.interestRateOverride ?? null,
            minPeriodOverride: input.minPeriodOverride ?? null,
            issuedBy: actorId,
            disbursementSource: input.disbursementSource,
            loanType: input.loanType ?? "perpetual",
            termMonths: (input.loanType && input.loanType !== "perpetual") ? input.termMonths! : null,
          })
          .returning()

        const [coll] = await tx
          .insert(collateral)
          .values({
            loanId: loan.id,
            nature: input.collateral.nature,
            description: input.collateral.description ?? null,
          })
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "loan.create",
          entityType: "loan",
          entityId: loan.id,
          beforeValue: null,
          afterValue: { ...loan, collateral: coll },
        })

        // Auto-post issuance fee as income transaction
        let [feeCategory] = await tx
          .select()
          .from(transactionCategories)
          .where(
            and(
              eq(transactionCategories.name, "Issuance Fees"),
              eq(transactionCategories.type, "income")
            )
          )

        if (!feeCategory) {
          ;[feeCategory] = await tx
            .insert(transactionCategories)
            .values({ name: "Issuance Fees", type: "income", isDefault: true })
            .returning()
        }

        await tx.insert(transactions).values({
          type: "credit",
          amount: input.issuanceFee,
          categoryId: feeCategory.id,
          referenceType: "loan",
          referenceId: loan.id,
          description: `Issuance fee for loan ${loan.id.slice(0, 8).toUpperCase()}`,
          transactionDate: startDate,
          recordedBy: actorId,
        })

        return { ...loan, collateral: coll }
      })
    },
    catch: (e: any) => {
      if (e?._tag === "CustomerNotFound") return new CustomerNotFound({ id: e.id })
      if (e?._tag === "IncompleteLoanRequirements")
        return new IncompleteLoanRequirements({ missing: e.missing })
      return new DatabaseError({ cause: e })
    },
  })

export const getLoan = (
  id: string
): Effect.Effect<Loan, LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: () => db.select().from(loans).where(and(eq(loans.id, id), isNull(loans.deletedAt))),
    catch: (e) => new DatabaseError({ cause: e }),
  }).pipe(
    Effect.flatMap((rows) =>
      rows[0] ? Effect.succeed(rows[0]) : Effect.fail(new LoanNotFound({ id }))
    )
  )

export const listLoans = (): Effect.Effect<LoanWithCustomer[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db
        .select({
          id: loans.id,
          customerId: loans.customerId,
          principalAmount: loans.principalAmount,
          issuanceFee: loans.issuanceFee,
          description: loans.description,
          interestRate: loans.interestRate,
          minInterestDays: loans.minInterestDays,
          startDate: loans.startDate,
          status: loans.status,
          interestRateOverride: loans.interestRateOverride,
          minPeriodOverride: loans.minPeriodOverride,
          issuedBy: loans.issuedBy,
          disbursementSource: loans.disbursementSource,
          loanType: loans.loanType,
          termMonths: loans.termMonths,
          createdAt: loans.createdAt,
          updatedAt: loans.updatedAt,
          deletedAt: loans.deletedAt,
          customerName: customers.fullName,
        })
        .from(loans)
        .innerJoin(customers, eq(loans.customerId, customers.id))
        .where(isNull(loans.deletedAt))
        .orderBy(desc(loans.createdAt))
      return rows
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const updateLoan = (
  input: UpdateLoanInput,
  actorId: string
): Effect.Effect<Loan, LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [existingLoan] = await db
        .select()
        .from(loans)
        .where(and(eq(loans.id, input.loanId), isNull(loans.deletedAt)))

      if (!existingLoan) throw { _tag: "LoanNotFound", id: input.loanId }

      const setObj: Partial<typeof loans.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      }
      if (input.principalAmount !== undefined) {
        setObj.principalAmount = input.principalAmount
      }
      if (input.interestRate !== undefined) {
        setObj.interestRate = input.interestRate
      }
      if (input.startDate !== undefined) {
        setObj.startDate = new Date(input.startDate)
      }
      if (input.issuanceFee !== undefined) {
        setObj.issuanceFee = input.issuanceFee
      }
      if (input.description !== undefined) {
        setObj.description = input.description
      }

      return await db.transaction(async (tx) => {
        const [updatedLoan] = await tx
          .update(loans)
          .set(setObj)
          .where(eq(loans.id, input.loanId))
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "loan.update",
          entityType: "loan",
          entityId: input.loanId,
          beforeValue: existingLoan,
          afterValue: { ...setObj, reason: input.reason },
        })

        if (input.issuanceFee !== undefined) {
          await tx
            .update(transactions)
            .set({
              amount: input.issuanceFee,
              description: `Issuance fee for loan ${input.loanId.slice(0, 8).toUpperCase()}`,
            })
            .where(
              and(
                eq(transactions.referenceType, "loan"),
                eq(transactions.referenceId, input.loanId)
              )
            )
        }

        return updatedLoan
      })
    },
    catch: (e: any) => {
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

export const deleteLoan = (
  input: DeleteLoanInput,
  actorId: string
): Effect.Effect<Loan, LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [existingLoan] = await db
        .select()
        .from(loans)
        .where(and(eq(loans.id, input.loanId), isNull(loans.deletedAt)))

      if (!existingLoan) throw { _tag: "LoanNotFound", id: input.loanId }

      const now = new Date()

      return await db.transaction(async (tx) => {
        await writeAuditLog(tx, {
          actorId,
          action: "loan.delete",
          entityType: "loan",
          entityId: input.loanId,
          beforeValue: existingLoan,
          afterValue: { reason: input.reason },
        })

        await tx
          .update(payments)
          .set({ deletedAt: now, deletedBy: actorId, deleteReason: input.reason, updatedAt: now })
          .where(and(eq(payments.loanId, input.loanId), isNull(payments.deletedAt)))

        // Reverse issuance fee transaction
        const [feeTx] = await tx
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.referenceType, "loan"),
              eq(transactions.referenceId, input.loanId)
            )
          )

        if (feeTx) {
          await tx.insert(transactions).values({
            type: "debit",
            amount: feeTx.amount,
            categoryId: feeTx.categoryId,
            referenceType: "loan_reversal",
            referenceId: input.loanId,
            description: `Reversal - loan ${input.loanId.slice(0, 8).toUpperCase()} deleted: ${input.reason}`,
            transactionDate: new Date(),
            recordedBy: actorId,
          })
        }

        // Reverse all payment interest transactions for this loan's payments
        const loanPayments = await tx
          .select()
          .from(payments)
          .where(eq(payments.loanId, input.loanId))

        for (const p of loanPayments) {
          if (new BigNumber(p.interestPortion).isGreaterThan(0)) {
            // Look up category
            let [category] = await tx.select().from(transactionCategories)
              .where(and(
                eq(transactionCategories.name, "Interest Earned"),
                eq(transactionCategories.type, "income")
              ))
            if (!category) {
              ;[category] = await tx.insert(transactionCategories)
                .values({ name: "Interest Earned", type: "income", isDefault: true })
                .returning()
            }

            await tx.insert(transactions).values({
              type: "debit",
              amount: p.interestPortion,
              categoryId: category.id,
              referenceType: "payment_reversal",
              referenceId: p.id,
              description: `Reversal - loan ${input.loanId.slice(0, 8).toUpperCase()} deleted: ${input.reason}`,
              transactionDate: new Date(),
              recordedBy: actorId,
            })
          }
        }

        await tx
          .update(loans)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(loans.id, input.loanId))

        return existingLoan
      })
    },
    catch: (e: any) => {
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })
