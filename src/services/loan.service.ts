import { Effect } from "effect"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { collateral } from "@/lib/db/schema/collateral"
import { payments } from "@/lib/db/schema/payments"
import { customers } from "@/lib/db/schema/customers"
import { eq } from "drizzle-orm"
import {
  DatabaseError,
  CustomerNotFound,
  LoanNotFound,
  IncompleteLoanRequirements,
  ValidationError,
} from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import type { CreateLoanInput, UpdateLoanInput, DeleteLoanInput, Loan } from "@/types"

/**
 * Validates that a customer has all required fields for loan issuance (CUST-04).
 * Returns an array of missing field names. Empty array = all good.
 */
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

/**
 * Creates a loan with collateral and audit log in a single atomic transaction.
 * CUST-04: Blocks if customer details are incomplete.
 * INFR-01: Audit log written in same transaction.
 * LOAN-02: Loan is perpetual -- NO dueDate computation, NO termDays.
 * Collateral is inserted into separate `collateral` table (not inline columns on loans).
 */
export const createLoan = (
  input: CreateLoanInput,
  actorId: string
): Effect.Effect<
  Loan & { collateral: { id: string; nature: string; description: string | null } },
  CustomerNotFound | IncompleteLoanRequirements | DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      // 1. Fetch and validate customer
      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, input.customerId))

      if (!customer) throw { _tag: "CustomerNotFound", id: input.customerId }

      // Blacklist safeguard (CUST-06): Blacklisted customers cannot receive new loans
      if (customer.status === "blacklisted") {
        throw new ValidationError({ message: "This customer is blacklisted and cannot receive new loans.", field: "customerId" })
      }

      const missingFields = checkCustomerCompleteness(customer)
      if (missingFields.length > 0) {
        throw { _tag: "IncompleteLoanRequirements", missing: missingFields }
      }

      const startDate = new Date(input.startDate)

      // NOTE: No dueDate computation. Loans are perpetual (LOAN-02).
      // The loan rolls forward indefinitely until fully repaid.

      // 2. Atomic transaction: loan + collateral (separate table) + audit log
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

        // Collateral goes into separate `collateral` table (not inline columns on loans)
        const [coll] = await tx
          .insert(collateral)
          .values({
            loanId: loan.id,
            nature: input.collateral.nature,
            description: input.collateral.description ?? null,
          })
          .returning()

        // INFR-01: Audit log in same transaction
        // CRITICAL: Use direct await -- NOT Effect.runPromise (see Pitfall 7)
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
    try: () => db.select().from(loans).where(eq(loans.id, id)),
    catch: (e) => new DatabaseError({ cause: e }),
  }).pipe(
    Effect.flatMap((rows) =>
      rows[0] ? Effect.succeed(rows[0]) : Effect.fail(new LoanNotFound({ id }))
    )
  )

export const listLoans = (): Effect.Effect<Loan[], DatabaseError> =>
  Effect.tryPromise({
    try: () => db.select().from(loans),
    catch: (e) => new DatabaseError({ cause: e }),
  })

/**
 * Updates a loan's principal amount, interest rate, and/or start date with audit log.
 * INFR-01: Audit log written in same transaction.
 */
export const updateLoan = (
  input: UpdateLoanInput,
  actorId: string
): Effect.Effect<Loan, LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      // Fetch existing loan
      const [existingLoan] = await db
        .select()
        .from(loans)
        .where(eq(loans.id, input.loanId))

      if (!existingLoan) throw { _tag: "LoanNotFound", id: input.loanId }

      // Build the set object from only provided fields
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

/**
 * Hard-deletes a loan and its related payments and collateral with audit log.
 * Deletes in order: payments -> collateral -> loan (FK dependency order).
 * INFR-01: Audit log written in same transaction.
 */
export const deleteLoan = (
  input: DeleteLoanInput,
  actorId: string
): Effect.Effect<Loan, LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      // Fetch existing loan
      const [existingLoan] = await db
        .select()
        .from(loans)
        .where(eq(loans.id, input.loanId))

      if (!existingLoan) throw { _tag: "LoanNotFound", id: input.loanId }

      return await db.transaction(async (tx) => {
        // Write audit log BEFORE deletion so we have the entity data
        await writeAuditLog(tx, {
          actorId,
          action: "loan.delete",
          entityType: "loan",
          entityId: input.loanId,
          beforeValue: existingLoan,
          afterValue: { reason: input.reason },
        })

        // Delete in FK dependency order: payments -> collateral -> loan
        await tx.delete(payments).where(eq(payments.loanId, input.loanId))
        await tx.delete(collateral).where(eq(collateral.loanId, input.loanId))
        await tx.delete(loans).where(eq(loans.id, input.loanId))

        return existingLoan
      })
    },
    catch: (e: any) => {
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })
