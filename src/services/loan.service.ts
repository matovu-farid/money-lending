import { Effect } from "effect"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { collateral } from "@/lib/db/schema/collateral"
import { customers } from "@/lib/db/schema/customers"
import { eq } from "drizzle-orm"
import {
  DatabaseError,
  CustomerNotFound,
  LoanNotFound,
  IncompleteLoanRequirements,
} from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import type { CreateLoanInput, Loan } from "@/types"

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
            status: "pending",
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
