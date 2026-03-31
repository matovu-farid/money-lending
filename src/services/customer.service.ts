import { Effect } from "effect"
import { db } from "@/lib/db"
import { customers } from "@/lib/db/schema/customers"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { eq, ilike, inArray, and, count, isNull } from "drizzle-orm"
import { DatabaseError, CustomerNotFound } from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import { calculateDaysOverdue, calculateDailyRate, calculateInterest } from "@/lib/interest"
import BigNumber from "bignumber.js"
import type { CreateCustomerInput, UpdateCustomerInput, CustomerSearchParams, CustomerStatus } from "@/types"
import type { Customer } from "@/types"

function escapeLikePattern(input: string): string {
  return input.replace(/%/g, '\\%').replace(/_/g, '\\_')
}

export const createCustomer = (
  input: CreateCustomerInput
): Effect.Effect<Customer, DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db
        .insert(customers)
        .values({
          fullName: input.fullName,
          contact: input.contact,
          address: input.address,
        })
        .returning()
        .then((rows) => rows[0]),
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const getCustomer = (
  id: string
): Effect.Effect<Customer, CustomerNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db.select().from(customers).where(eq(customers.id, id)),
    catch: (e) => new DatabaseError({ cause: e }),
  }).pipe(
    Effect.flatMap((rows) =>
      rows[0]
        ? Effect.succeed(rows[0])
        : Effect.fail(new CustomerNotFound({ id }))
    )
  )

export const updateCustomer = (
  id: string,
  input: UpdateCustomerInput
): Effect.Effect<Customer, CustomerNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db
        .update(customers)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(customers.id, id))
        .returning()
        .then((rows) => rows[0]),
    catch: (e) => new DatabaseError({ cause: e }),
  }).pipe(
    Effect.flatMap((row) =>
      row
        ? Effect.succeed(row)
        : Effect.fail(new CustomerNotFound({ id }))
    )
  )

export const listCustomers = (): Effect.Effect<Customer[], DatabaseError> =>
  Effect.tryPromise({
    try: () => db.select().from(customers),
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const searchCustomers = (
  params: CustomerSearchParams
): Effect.Effect<{ rows: Customer[]; total: number }, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const conditions = []
      if (params.name) conditions.push(ilike(customers.fullName, `%${escapeLikePattern(params.name)}%`))
      if (params.status?.length) conditions.push(inArray(customers.status, params.status))

      const whereClause = conditions.length ? and(...conditions) : undefined

      const pageSize = params.pageSize ?? 20
      const page = params.page ?? 0

      if (params.daysRemainingFilter && params.daysRemainingFilter !== "any") {
        const allRows = await db
          .select()
          .from(customers)
          .where(whereClause)
          .orderBy(customers.fullName)

        const now = new Date()
        const filteredRows: Customer[] = []

        for (const customer of allRows) {
          const activeLoans = await db
            .select()
            .from(loans)
            .where(and(eq(loans.customerId, customer.id), eq(loans.status, "active")))

          if (activeLoans.length === 0) continue

          let maxDaysOverdue = new BigNumber(0)

          for (const loan of activeLoans) {
            const loanPayments = await db
              .select()
              .from(payments)
              .where(and(eq(payments.loanId, loan.id), isNull(payments.deletedAt)))

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
            if (daysOverdue.isGreaterThan(maxDaysOverdue)) {
              maxDaysOverdue = daysOverdue
            }
          }

          const days = maxDaysOverdue.toNumber()
          if (params.daysRemainingFilter === "due_within_30" && days > 0 && days < 30) {
            filteredRows.push(customer)
          } else if (params.daysRemainingFilter === "overdue_30_plus" && days >= 30) {
            filteredRows.push(customer)
          }
        }

        const total = filteredRows.length
        const paginatedRows = filteredRows.slice(page * pageSize, (page + 1) * pageSize)

        return { rows: paginatedRows, total }
      }

      const [{ total }] = await db
        .select({ total: count() })
        .from(customers)
        .where(whereClause)

      const rows = await db
        .select()
        .from(customers)
        .where(whereClause)
        .limit(pageSize)
        .offset(page * pageSize)
        .orderBy(customers.fullName)

      return { rows, total }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const changeCustomerStatus = (
  id: string,
  newStatus: CustomerStatus,
  reason: string,
  actorId: string
): Effect.Effect<Customer, CustomerNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [current] = await tx.select().from(customers).where(eq(customers.id, id))
        if (!current) throw new CustomerNotFound({ id })

        const [updated] = await tx
          .update(customers)
          .set({ status: newStatus, updatedAt: new Date() })
          .where(eq(customers.id, id))
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "status_change",
          entityType: "customer",
          entityId: id,
          beforeValue: JSON.stringify({ status: current.status }),
          afterValue: JSON.stringify({ status: newStatus, reason }),
        })

        return updated
      })
    },
    catch: (e) => {
      if (e instanceof CustomerNotFound) return e
      return new DatabaseError({ cause: e })
    },
  })
