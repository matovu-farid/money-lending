import { Effect } from "effect"
import { db } from "@/lib/db"
import { customers } from "@/lib/db/schema/customers"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { getBaseRate } from "@/lib/interest/effective-rate"
import { eq, ilike, inArray, and, count, isNull, desc } from "drizzle-orm"
import { DatabaseError, CustomerNotFound } from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import { getLoanBalancesFromLedger, getInterestEarnedFromLedger } from "@/services/ledger-queries.service"
import { formatAmount } from "@/lib/interest/engine"
import BigNumber from "bignumber.js"
import { computeLoanOverdueInfo } from "@/lib/interest/overdue"
import { escapeLikePattern } from "@/lib/db/utils"
import { toLoanType, type Customer, type CreateCustomerInput, type UpdateCustomerInput, type CustomerSearchParams, type CustomerStatus } from "@/types"

export const createCustomer = (
  input: CreateCustomerInput
): Effect.Effect<Customer, DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db
        .insert(customers)
        .values({
          fullName: input.fullName,
          nin: input.nin,
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
      const page = params.page ?? 1

      if (params.daysRemainingFilter && params.daysRemainingFilter !== "any") {
        const allRows = await db
          .select()
          .from(customers)
          .where(whereClause)
          .orderBy(customers.fullName)

        // Batch-fetch all active loans for all customers at once
        const customerIds = allRows.map((c) => c.id)
        const allActiveLoans = customerIds.length > 0
          ? await db
              .select()
              .from(loans)
              .where(and(inArray(loans.customerId, customerIds), eq(loans.status, "active")))
          : []

        // Group loans by customer
        const loansByCustomer = new Map<string, typeof allActiveLoans>()
        for (const loan of allActiveLoans) {
          const existing = loansByCustomer.get(loan.customerId) ?? []
          existing.push(loan)
          loansByCustomer.set(loan.customerId, existing)
        }

        // Batch-fetch ledger data for ALL active loans at once
        const allLoanIds = allActiveLoans.map((l) => l.id)
        const [allLedgerBalances, allInterestEarned] = await Promise.all([
          allLoanIds.length > 0 ? getLoanBalancesFromLedger(allLoanIds) : Promise.resolve(new Map<string, BigNumber>()),
          allLoanIds.length > 0 ? getInterestEarnedFromLedger(allLoanIds) : Promise.resolve(new Map<string, BigNumber>()),
        ])

        // Batch-fetch all payments for all active loans at once
        const allLoanPayments = allLoanIds.length > 0
          ? await db
              .select()
              .from(payments)
              .where(and(inArray(payments.loanId, allLoanIds), isNull(payments.deletedAt)))
          : []

        // Group payments by loanId
        const paymentsByLoan = new Map<string, number>()
        for (const p of allLoanPayments) {
          paymentsByLoan.set(p.loanId, (paymentsByLoan.get(p.loanId) ?? 0) + 1)
        }

        const filteredRows: Customer[] = []

        for (const customer of allRows) {
          const activeLoans = loansByCustomer.get(customer.id)
          if (!activeLoans || activeLoans.length === 0) continue

          let maxDaysOverdue = 0

          for (const loan of activeLoans) {
            const baseRate = getBaseRate(loan)
            const ledgerBalance = allLedgerBalances.get(loan.id)
            if (ledgerBalance === undefined) {
              console.warn(`[searchCustomers] No ledger entries for loan ${loan.id}, using principalAmount as fallback`)
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
              totalInterestPaid: formatAmount(allInterestEarned.get(loan.id) ?? new BigNumber(0)),
              paymentCount: paymentsByLoan.get(loan.id) ?? 0,
              outstandingBalance,
              penaltyWaived: loan.penaltyWaived,
              loan,
            })
            if (info.daysOverdue > maxDaysOverdue) {
              maxDaysOverdue = info.daysOverdue
            }
          }

          const days = maxDaysOverdue
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

      const orderCol = params.sortByRecent ? desc(customers.createdAt) : customers.fullName

      const rows = await db
        .select()
        .from(customers)
        .where(whereClause)
        .limit(pageSize)
        .offset(page * pageSize)
        .orderBy(orderCol)

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
