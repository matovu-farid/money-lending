import { Effect } from "effect";
import { db } from "@/lib/db";
import { customers } from "@/lib/db/schema/customers";
import { loans } from "@/lib/db/schema/loans";
import { payments } from "@/lib/db/schema/payments";
import { eq, ilike, inArray, and, or, count, isNull, desc, sql, exists } from "drizzle-orm";
import { DatabaseError, CustomerNotFound } from "@/lib/errors";
import { isUniqueConstraintError } from "@/lib/db-errors";
import { writeAuditLog } from "./audit.service";
import {
  getLoanBalancesFromLedger,
} from "@/services/ledger-queries.service";
import BigNumber from "bignumber.js";
import { escapeLikePattern } from "@/lib/db/utils";
import {
  type Customer,
  type CreateCustomerInput,
  type UpdateCustomerInput,
  type CustomerSearchParams,
  type CustomerStatus,
} from "@/types";
import {
  computeSingleLoanBalanceData,
} from "@/lib/interest/loanBalanceData";
import { normalizeUgandanPhone } from "@/lib/validators";

function normalizeCustomerContact(contact: string): string {
  return normalizeUgandanPhone(contact) ?? contact.trim();
}

export const createCustomer = (
  input: CreateCustomerInput,
): Effect.Effect<Customer, DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db
        .insert(customers)
        .values({
          ...(input.id ? { id: input.id } : {}),
          fullName: input.fullName,
          nin: input.nin,
          contact: normalizeCustomerContact(input.contact),
          address: input.address,
        })
        .returning()
        .then((rows) => rows[0]),
    catch: (e) => new DatabaseError({ cause: e }),
  }).pipe(
    Effect.catchIf(
      (e) => !!input.id && isUniqueConstraintError(e.cause),
      () => createCustomer({ ...input, id: undefined }),
    ),
  );

/**
 * Like createCustomer but also returns the Postgres transaction ID.
 * Required for Electric collections so the client can wait for the
 * specific transaction to appear in the shape stream before clearing
 * optimistic state.
 */
export const createCustomerWithTxid = (
  input: CreateCustomerInput,
): Effect.Effect<{ customer: Customer; txid: number }, DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db.transaction(async (tx) => {
        const [customer] = await tx
          .insert(customers)
          .values({
            ...(input.id ? { id: input.id } : {}),
            fullName: input.fullName,
            nin: input.nin,
            contact: normalizeCustomerContact(input.contact),
            address: input.address,
          })
          .returning();
        const txidRows = await tx.execute<{ txid: string }>(
          sql`SELECT pg_current_xact_id()::text as txid`,
        );
        const txid = Number(
          (txidRows as unknown as Array<{ txid: string }>)[0].txid,
        );
        return { customer, txid };
      }),
    catch: (e) => new DatabaseError({ cause: e }),
  }).pipe(
    Effect.catchIf(
      (e) => !!input.id && isUniqueConstraintError(e.cause),
      () => createCustomerWithTxid({ ...input, id: undefined }),
    ),
  );

export const getCustomer = (
  id: string,
): Effect.Effect<Customer, CustomerNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: () => db.select().from(customers).where(eq(customers.id, id)),
    catch: (e) => new DatabaseError({ cause: e }),
  }).pipe(
    Effect.flatMap((rows) =>
      rows[0]
        ? Effect.succeed(rows[0])
        : Effect.fail(new CustomerNotFound({ id })),
    ),
  );

export const updateCustomer = (
  id: string,
  input: UpdateCustomerInput,
  actorId: string,
): Effect.Effect<Customer, CustomerNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(customers)
          .where(eq(customers.id, id));
        if (!current) throw new CustomerNotFound({ id });

        const [updated] = await tx
          .update(customers)
          .set({
            ...input,
            ...(input.contact !== undefined
              ? { contact: normalizeCustomerContact(input.contact) }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(customers.id, id))
          .returning();
        if (!updated) throw new CustomerNotFound({ id });

        await writeAuditLog(tx, {
          actorId,
          action: "customer.update",
          entityType: "customer",
          entityId: id,
          beforeValue: {
            fullName: current.fullName,
            nin: current.nin,
            contact: current.contact,
            address: current.address,
          },
          afterValue: {
            fullName: updated.fullName,
            nin: updated.nin,
            contact: updated.contact,
            address: updated.address,
          },
        });

        return updated;
      }),
    catch: (e) => {
      if (e instanceof CustomerNotFound) return e;
      return new DatabaseError({ cause: e });
    },
  });

/**
 * Like updateCustomer but also returns the Postgres transaction ID.
 * Required for Electric collections so the client can wait for the
 * specific transaction to appear in the shape stream before clearing
 * optimistic state.
 */
export const updateCustomerWithTxid = (
  id: string,
  input: UpdateCustomerInput,
  actorId: string,
): Effect.Effect<
  { customer: Customer; txid: number },
  CustomerNotFound | DatabaseError
> =>
  Effect.tryPromise({
    try: () =>
      db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(customers)
          .where(eq(customers.id, id));
        if (!current) throw new CustomerNotFound({ id });

        const [customer] = await tx
          .update(customers)
          .set({
            ...input,
            ...(input.contact !== undefined
              ? { contact: normalizeCustomerContact(input.contact) }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(customers.id, id))
          .returning();
        if (!customer) throw new CustomerNotFound({ id });

        await writeAuditLog(tx, {
          actorId,
          action: "customer.update",
          entityType: "customer",
          entityId: id,
          beforeValue: {
            fullName: current.fullName,
            nin: current.nin,
            contact: current.contact,
            address: current.address,
          },
          afterValue: {
            fullName: customer.fullName,
            nin: customer.nin,
            contact: customer.contact,
            address: customer.address,
          },
        });

        const txidRows = await tx.execute<{ txid: string }>(
          sql`SELECT pg_current_xact_id()::text as txid`,
        );
        const txid = Number(
          (txidRows as unknown as Array<{ txid: string }>)[0].txid,
        );
        return { customer, txid };
      }),
    catch: (e) => {
      if (e instanceof CustomerNotFound) return e;
      return new DatabaseError({ cause: e });
    },
  });

export const listCustomers = (): Effect.Effect<Customer[], DatabaseError> =>
  Effect.tryPromise({
    try: () => db.select().from(customers).limit(500),
    catch: (e) => new DatabaseError({ cause: e }),
  });

export const searchCustomers = (
  params: CustomerSearchParams,
): Effect.Effect<{ rows: Customer[]; total: number }, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const conditions = [];
      if (params.name) {
        const term = params.name.trim();
        const escapedTerm = `%${escapeLikePattern(term)}%`;
        const normalizedPhone = normalizeUgandanPhone(term);
        const upperTerm = term.toUpperCase();
        const searchConditions = [
          ilike(customers.fullName, escapedTerm),
          ilike(customers.nin, `%${escapeLikePattern(upperTerm)}%`),
          ilike(customers.contact, escapedTerm),
        ];
        if (normalizedPhone) searchConditions.push(eq(customers.contact, normalizedPhone));
        conditions.push(or(...searchConditions));
      }
      if (params.status?.length)
        conditions.push(inArray(customers.status, params.status));

      if (params.loanStatus?.length) {
        conditions.push(
          exists(
            db
              .select({ id: loans.id })
              .from(loans)
              .where(
                and(
                  eq(loans.customerId, customers.id),
                  inArray(loans.status, params.loanStatus),
                  isNull(loans.deletedAt),
                ),
              ),
          ),
        );
      }

      const whereClause = conditions.length ? and(...conditions) : undefined;

      const pageSize = params.pageSize ?? 20;
      const page = params.page ?? 0;

      if (params.daysRemainingFilter && params.daysRemainingFilter !== "any") {
        const allRows = await db
          .select()
          .from(customers)
          .where(whereClause)
          .orderBy(customers.fullName);

        // Batch-fetch all active loans for all customers at once
        const customerIds = allRows.map((c) => c.id);
        const allActiveLoans =
          customerIds.length > 0
            ? await db
                .select()
                .from(loans)
                .where(
                  and(
                    inArray(loans.customerId, customerIds),
                    eq(loans.status, "active"),
                    isNull(loans.deletedAt),
                  ),
                )
            : [];

        // Group loans by customer
        const loansByCustomer = new Map<string, typeof allActiveLoans>();
        for (const loan of allActiveLoans) {
          const existing = loansByCustomer.get(loan.customerId) ?? [];
          existing.push(loan);
          loansByCustomer.set(loan.customerId, existing);
        }

        // Batch-fetch ledger data for ALL active loans at once
        const allLoanIds = allActiveLoans.map((l) => l.id);
        const [allLedgerBalances] = await Promise.all([
          allLoanIds.length > 0
            ? getLoanBalancesFromLedger(allLoanIds)
            : Promise.resolve(new Map<string, BigNumber>()),
        ]);

        // Batch-fetch all payments for all active loans at once
        const allLoanPayments =
          allLoanIds.length > 0
            ? await db
                .select()
                .from(payments)
                .where(
                  and(
                    inArray(payments.loanId, allLoanIds),
                    isNull(payments.deletedAt),
                    eq(payments.markedWrong, false),
                  ),
                )
            : [];

        // Group payments by loanId
        const paymentsByLoan = new Map<string, number>();
        for (const p of allLoanPayments) {
          paymentsByLoan.set(p.loanId, (paymentsByLoan.get(p.loanId) ?? 0) + 1);
        }

        const filteredRows: Customer[] = [];

        for (const customer of allRows) {
          const activeLoans = loansByCustomer.get(customer.id);
          if (!activeLoans || activeLoans.length === 0) continue;

          let maxDaysOverdue = 0;

          for (const loan of activeLoans) {
            const ledgerBalance = allLedgerBalances.get(loan.id);
            if (ledgerBalance === undefined) {
              console.warn(
                `[searchCustomers] No ledger entries for loan ${loan.id}, using principalAmount as fallback`,
              );
            }

            const info = await computeSingleLoanBalanceData(
              loan.id,
              new Date(),
            );

            if (info.daysOverdue > maxDaysOverdue) {
              maxDaysOverdue = info.daysOverdue;
            }
          }

          const days = maxDaysOverdue;
          if (
            params.daysRemainingFilter === "due_within_30" &&
            days > 0 &&
            days < 30
          ) {
            filteredRows.push(customer);
          } else if (
            params.daysRemainingFilter === "overdue_30_plus" &&
            days >= 30
          ) {
            filteredRows.push(customer);
          }
        }

        const total = filteredRows.length;
        const paginatedRows = filteredRows.slice(
          page * pageSize,
          (page + 1) * pageSize,
        );

        return { rows: paginatedRows, total };
      }

      const [{ total }] = await db
        .select({ total: count() })
        .from(customers)
        .where(whereClause);

      const orderCol = params.sortByRecent
        ? desc(customers.createdAt)
        : customers.fullName;

      const rows = await db
        .select()
        .from(customers)
        .where(whereClause)
        .limit(pageSize)
        .offset(page * pageSize)
        .orderBy(orderCol);

      return { rows, total };
    },
    catch: (e) => new DatabaseError({ cause: e }),
  });

export const changeCustomerStatus = (
  id: string,
  newStatus: CustomerStatus,
  reason: string,
  actorId: string,
): Effect.Effect<Customer, CustomerNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(customers)
          .where(eq(customers.id, id));
        if (!current) throw new CustomerNotFound({ id });

        const [updated] = await tx
          .update(customers)
          .set({ status: newStatus, updatedAt: new Date() })
          .where(eq(customers.id, id))
          .returning();

        await writeAuditLog(tx, {
          actorId,
          action: "status_change",
          entityType: "customer",
          entityId: id,
          beforeValue: JSON.stringify({ status: current.status }),
          afterValue: JSON.stringify({ status: newStatus, reason }),
        });

        return updated;
      });
    },
    catch: (e) => {
      if (e instanceof CustomerNotFound) return e;
      return new DatabaseError({ cause: e });
    },
  });

/**
 * Like changeCustomerStatus but also returns the Postgres transaction ID.
 * Required for Electric collections so the client can wait for the
 * specific transaction to appear in the shape stream before clearing
 * optimistic state.
 */
export const changeCustomerStatusWithTxid = (
  id: string,
  newStatus: CustomerStatus,
  reason: string,
  actorId: string,
): Effect.Effect<
  { customer: Customer; txid: number },
  CustomerNotFound | DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(customers)
          .where(eq(customers.id, id));
        if (!current) throw new CustomerNotFound({ id });

        const [updated] = await tx
          .update(customers)
          .set({ status: newStatus, updatedAt: new Date() })
          .where(eq(customers.id, id))
          .returning();

        await writeAuditLog(tx, {
          actorId,
          action: "status_change",
          entityType: "customer",
          entityId: id,
          beforeValue: JSON.stringify({ status: current.status }),
          afterValue: JSON.stringify({ status: newStatus, reason }),
        });

        const txidRows = await tx.execute<{ txid: string }>(
          sql`SELECT pg_current_xact_id()::text as txid`,
        );
        const txid = Number(
          (txidRows as unknown as Array<{ txid: string }>)[0].txid,
        );
        return { customer: updated, txid };
      });
    },
    catch: (e) => {
      if (e instanceof CustomerNotFound) return e;
      return new DatabaseError({ cause: e });
    },
  });
