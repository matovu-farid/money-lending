import { Effect } from "effect"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { collateral } from "@/lib/db/schema/collateral"
import { payments } from "@/lib/db/schema/payments"
import { notifications } from "@/lib/db/schema/notifications"
import { customers } from "@/lib/db/schema/customers"
import { eq, desc, and, isNull } from "drizzle-orm"
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
            interestRate: input.interestRate,
            minInterestDays: input.minInterestDays,
            startDate,
            status: "active",
            interestRateOverride: input.interestRateOverride ?? null,
            minPeriodOverride: input.minPeriodOverride ?? null,
            issuedBy: actorId,
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
          interestRate: loans.interestRate,
          minInterestDays: loans.minInterestDays,
          startDate: loans.startDate,
          status: loans.status,
          interestRateOverride: loans.interestRateOverride,
          minPeriodOverride: loans.minPeriodOverride,
          issuedBy: loans.issuedBy,
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
