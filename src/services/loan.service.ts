import { Effect } from "effect";
import { db } from "@/lib/db";
import { loans } from "@/lib/db/schema/loans";
import { collateral } from "@/lib/db/schema/collateral";
import { payments } from "@/lib/db/schema/payments";
import { getBaseRate } from "@/lib/interest/effective-rate";
import { customers } from "@/lib/db/schema/customers";
import { user } from "@/lib/db/schema/auth";
import { transactions } from "@/lib/db/schema/transactions";
import { transactionCategories } from "@/lib/db/schema/transaction-categories";
import { eq, desc, asc, and, isNull, inArray, sql } from "drizzle-orm";
import { shortId, localDateString } from "@/lib/utils";
import BigNumber from "bignumber.js";
import {
  DatabaseError,
  CustomerNotFound,
  LoanNotFound,
  IncompleteLoanRequirements,
  ValidationError,
} from "@/lib/errors";
import { isUniqueConstraintError } from "@/lib/db-errors";
import { writeAuditLog } from "./audit.service";
import { auditLog } from "@/lib/db/schema/audit";
import { postJournalEntry } from "./transaction.service";
import {
  autoPostPrincipalDisbursement,
  autoPostRolloverPrincipalTransfer,
  autoPostInterestEarned,
  autoPostPrincipalRepayment,
} from "./auto-post.service";
import {
  getPaymentPortionsFromLedger,
  getLoanBalancesFromLedger,
  getInterestEarnedFromLedger,
} from "./ledger-queries.service";
import {
  allocateLoanPayment,
  allocatePayment,
  formatAmount,
} from "@/lib/interest/engine";
import { computeLoanOverdueInfo } from "@/lib/interest/overdue";
import { daysBetween } from "@/lib/db/utils";
import {
  toLoanType,
  type CreateLoanInput,
  type UpdateLoanInput,
  type DeleteLoanInput,
  type Loan,
  type LoanWithCustomer,
  type LoanListEntry,
  type LoanStatus,
} from "@/types";
import {
  computeAllLoansBalanceData,
  computeLoanBalanceData,
  computeLoanBalanceDataArray,
  computeSingleLoanBalanceData,
} from "@/lib/interest/loanBalanceData";
import { assertLoanOperational } from "@/lib/loan-visibility";
import { cancelPendingRateChangeRequestsForLoan } from "./rate-change-request.service";

const checkCustomerCompleteness = (customer: {
  fullName: string | null;
  contact: string | null;
  address: string | null;
}): string[] => {
  const missing: string[] = [];
  if (!customer.fullName?.trim()) missing.push("fullName");
  if (!customer.contact?.trim()) missing.push("contact");
  if (!customer.address?.trim()) missing.push("address");
  return missing;
};

/** Shared select shape for LoanWithCustomer list queries (listLoans / listOperationalLoans). */
const loanWithCustomerSelect = {
  id: loans.id,
  customerId: loans.customerId,
  principalAmount: loans.principalAmount,
  issuanceFee: loans.issuanceFee,
  interestRate: loans.interestRate,
  minInterestDays: loans.minInterestDays,
  startDate: loans.startDate,
  status: loans.status,
  interestRateOverride: loans.interestRateOverride,
  minPeriodOverride: loans.minPeriodOverride,
  issuedBy: loans.issuedBy,
  disbursementSource: loans.disbursementSource,
  subLocationId: loans.subLocationId,
  loanType: loans.loanType,
  termMonths: loans.termMonths,
  penaltyMultiplier: loans.penaltyMultiplier,
  penaltyWaived: loans.penaltyWaived,
  penaltyWaivedBy: loans.penaltyWaivedBy,
  penaltyWaivedAt: loans.penaltyWaivedAt,
  rolledOverFrom: loans.rolledOverFrom,
  rolloverAmount: loans.rolloverAmount,
  backdatedFrom: loans.backdatedFrom,
  backdatedBy: loans.backdatedBy,
  backdatedAt: loans.backdatedAt,
  backdateNote: loans.backdateNote,
  createdAt: loans.createdAt,
  updatedAt: loans.updatedAt,
  deletedAt: loans.deletedAt,
  customerName: customers.fullName,
  customerContact: customers.contact,
} as const;

export const createLoan = (
  input: CreateLoanInput,
  actorId: string,
): Effect.Effect<
  Loan & {
    collateral: { id: string; nature: string; description: string | null };
  },
  | CustomerNotFound
  | IncompleteLoanRequirements
  | ValidationError
  | DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, input.customerId));

      if (!customer) throw { _tag: "CustomerNotFound", id: input.customerId };

      if (customer.status === "blacklisted") {
        throw new ValidationError({
          message: "This customer is blacklisted and cannot receive new loans.",
          field: "customerId",
        });
      }

      const missingFields = checkCustomerCompleteness(customer);
      if (missingFields.length > 0) {
        throw { _tag: "IncompleteLoanRequirements", missing: missingFields };
      }

      const startDate = new Date(input.startDate);

      return await db.transaction(async (tx) => {
        // Single active loan constraint — checked inside the transaction with
        // FOR UPDATE to serialize concurrent loan creation for the same customer
        const [existingActiveLoan] = await tx
          .select()
          .from(loans)
          .where(
            and(
              eq(loans.customerId, input.customerId),
              eq(loans.status, "active"),
              isNull(loans.deletedAt),
            ),
          )
          .for("update");

        if (existingActiveLoan && !input.rollover) {
          throw new ValidationError({
            message:
              "Customer already has an active loan. Use rollover to create a new loan.",
            field: "customerId",
          });
        }

        if (input.rollover && !existingActiveLoan) {
          throw new ValidationError({
            message: "Rollover specified but customer has no active loan.",
            field: "customerId",
          });
        }

        if (
          input.rollover &&
          existingActiveLoan &&
          input.rollover.fromLoanId !== existingActiveLoan.id
        ) {
          throw new ValidationError({
            message: "Rollover loan ID does not match customer's active loan.",
            field: "customerId",
          });
        }

        const loanValues = {
          ...(input.id ? { id: input.id } : {}),
          customerId: input.customerId,
          principalAmount: input.rollover
            ? new BigNumber(input.principalAmount)
                .plus(new BigNumber(input.rollover.carriedPrincipal))
                .plus(new BigNumber(input.rollover.carriedInterest))
                .toFixed(0)
            : input.principalAmount,
          issuanceFee: input.issuanceFee,
          interestRate: input.interestRate,
          minInterestDays: input.minInterestDays,
          startDate,
          status: "active" as const,
          interestRateOverride: input.interestRateOverride ?? null,
          minPeriodOverride: input.minPeriodOverride ?? null,
          issuedBy: actorId,
          disbursementSource: input.disbursementSource,
          subLocationId: input.subLocationId ?? null,
          loanType: input.loanType ?? "perpetual",
          termMonths: input.termMonths ?? null,
          rolledOverFrom: input.rollover?.fromLoanId ?? null,
          rolloverAmount: input.rollover
            ? new BigNumber(input.rollover.carriedPrincipal)
                .plus(new BigNumber(input.rollover.carriedInterest))
                .toFixed(0)
            : null,
          ...(input.backdateNote
            ? {
                backdatedFrom: new Date(),
                backdatedBy: actorId,
                backdatedAt: new Date(),
                backdateNote: input.backdateNote,
              }
            : {}),
        };

        const [loan] = await tx.insert(loans).values(loanValues).returning();

        const [coll] = await tx
          .insert(collateral)
          .values({
            loanId: loan.id,
            nature: input.collateral.nature,
            description: input.collateral.description,
          })
          .returning();

        // Handle rollover: close old loan
        if (input.rollover && existingActiveLoan) {
          // Post old loan's accrued interest as earned
          if (new BigNumber(input.rollover.carriedInterest).isGreaterThan(0)) {
            await postJournalEntry(tx, {
              debitCategory: { name: "Loans Receivable", type: "asset" },
              creditCategory: { name: "Interest Earned", type: "revenue" },
              amount: input.rollover.carriedInterest,
              referenceType: "rollover",
              referenceId: existingActiveLoan.id,
              description: `Interest earned - loan ${shortId(existingActiveLoan.id).toUpperCase()} rolled over into ${shortId(loan.id).toUpperCase()}`,
              transactionDate: startDate,
              recordedBy: actorId,
              loanId: loan.id,
            });
          }

          // Transfer carried principal from old loan to new loan on the ledger
          if (new BigNumber(input.rollover.carriedPrincipal).isGreaterThan(0)) {
            await autoPostRolloverPrincipalTransfer(tx, {
              amount: input.rollover.carriedPrincipal,
              newLoanId: loan.id,
              oldLoanId: existingActiveLoan.id,
              transactionDate: startDate,
              actorId,
            });
          }

          // Close old loan
          await tx
            .update(loans)
            .set({ status: "rolled_over", updatedAt: new Date() })
            .where(eq(loans.id, existingActiveLoan.id));

          await cancelPendingRateChangeRequestsForLoan(
            tx,
            existingActiveLoan.id,
            "rolled_over",
            actorId,
          );

          // Audit log for old loan
          await writeAuditLog(tx, {
            actorId,
            action: "loan.rollover",
            entityType: "loan",
            entityId: existingActiveLoan.id,
            beforeValue: existingActiveLoan,
            afterValue: {
              status: "rolled_over",
              rolledIntoLoanId: loan.id,
              carriedPrincipal: input.rollover.carriedPrincipal,
              carriedInterest: input.rollover.carriedInterest,
            },
          });
        }

        await writeAuditLog(tx, {
          actorId,
          action: "loan.create",
          entityType: "loan",
          entityId: loan.id,
          beforeValue: null,
          afterValue: {
            ...loan,
            collateral: coll,
            ...(input.rollover && {
              rolloverFrom: input.rollover.fromLoanId,
              freshAmount: input.principalAmount,
              rolloverAmount: new BigNumber(input.rollover.carriedPrincipal)
                .plus(new BigNumber(input.rollover.carriedInterest))
                .toFixed(0),
            }),
          },
        });

        // Auto-post issuance fee as income transaction (skip if zero)
        if (new BigNumber(input.issuanceFee).isGreaterThan(0)) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Cash", type: "asset" },
            creditCategory: { name: "Issuance Fees", type: "revenue" },
            amount: input.issuanceFee,
            referenceType: "loan",
            referenceId: loan.id,
            description: `Issuance fee for loan ${shortId(loan.id).toUpperCase()}`,
            transactionDate: startDate,
            recordedBy: actorId,
            debitDepositLocation: input.disbursementSource,
            debitSubLocationId: input.subLocationId,
            loanId: loan.id,
          });
        }

        // Auto-post principal disbursement as balance_sheet debit
        // Only disburse the fresh cash amount — carried amounts are book transfers, not cash movements
        const freshDisbursementAmount = input.rollover
          ? input.principalAmount // fresh cash only (excludes carriedPrincipal + carriedInterest)
          : loan.principalAmount;

        // Validate funds are available at the chosen source / sub-location before
        // posting the disbursement. For "bank" with a sub-location, scope the
        // check to that specific bank account; otherwise check the whole source.
        if (new BigNumber(freshDisbursementAmount).isGreaterThan(0)) {
          const balanceConds = [
            eq(transactionCategories.name, "Cash"),
            eq(transactions.depositLocation, input.disbursementSource),
          ];
          if (input.disbursementSource === "bank" && input.subLocationId) {
            balanceConds.push(
              eq(transactions.subLocationId, input.subLocationId),
            );
          }
          const [balanceRow] = await tx
            .select({
              total: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'debit' THEN ${transactions.amount} ELSE -${transactions.amount} END), '0')`,
            })
            .from(transactions)
            .innerJoin(
              transactionCategories,
              eq(transactions.categoryId, transactionCategories.id),
            )
            .where(and(...balanceConds));

          // The just-posted issuance fee debit already increased this source's
          // balance, so subtract it back out to compare against pre-fee funds.
          const issuanceFeeAtSource = new BigNumber(input.issuanceFee);
          const available = new BigNumber(balanceRow?.total ?? "0").minus(
            issuanceFeeAtSource,
          );

          if (available.isLessThan(freshDisbursementAmount)) {
            const where =
              input.disbursementSource === "bank" && input.subLocationId
                ? "this bank account"
                : `the ${input.disbursementSource.replace("_", " ")} source`;
            throw new ValidationError({
              message: `Insufficient funds at ${where} to disburse this loan.`,
              field:
                input.disbursementSource === "bank" && input.subLocationId
                  ? "subLocationId"
                  : "disbursementSource",
            });
          }
        }

        await autoPostPrincipalDisbursement(tx, {
          amount: freshDisbursementAmount,
          loanId: loan.id,
          transactionDate: startDate.toISOString(),
          actorId,
          depositLocation: input.disbursementSource,
          subLocationId: input.subLocationId,
        });

        return { ...loan, collateral: coll };
      });
    },
    catch: (e: unknown) => {
      if (e instanceof ValidationError) return e;
      const err = e as {
        _tag?: string;
        message?: string;
        field?: string;
        id?: string;
        missing?: string[];
      };
      if (err?._tag === "ValidationError")
        return new ValidationError({
          message: err.message as string,
          field: err.field,
        });
      if (err?._tag === "CustomerNotFound")
        return new CustomerNotFound({ id: err.id as string });
      if (err?._tag === "IncompleteLoanRequirements")
        return new IncompleteLoanRequirements({
          missing: err.missing as string[],
        });
      return new DatabaseError({ cause: e });
    },
  }).pipe(
    Effect.catchIf(
      (e) =>
        e._tag === "DatabaseError" &&
        !!input.id &&
        isUniqueConstraintError(e.cause),
      () => createLoan({ ...input, id: undefined }, actorId),
    ),
  );

export const getLoan = (
  id: string,
): Effect.Effect<Loan, LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(loans)
        .where(and(eq(loans.id, id), isNull(loans.deletedAt))),
    catch: (e) => new DatabaseError({ cause: e }),
  }).pipe(
    Effect.flatMap((rows) =>
      rows[0]
        ? Effect.succeed(rows[0] as Loan)
        : Effect.fail(new LoanNotFound({ id })),
    ),
  );

export const listLoans = (): Effect.Effect<LoanWithCustomer[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db
        .select(loanWithCustomerSelect)
        .from(loans)
        .innerJoin(customers, eq(loans.customerId, customers.id))
        .where(isNull(loans.deletedAt))
        .orderBy(desc(loans.createdAt))
        .limit(500);
      return rows;
    },
    catch: (e) => new DatabaseError({ cause: e }),
  });

/**
 * Uncapped active loans for operational surfaces (watchlist, export, reports).
 * Same LoanWithCustomer shape + newest-first order as listLoans — no 500 cap.
 */
export const listOperationalLoans = (): Effect.Effect<
  LoanWithCustomer[],
  DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db
        .select(loanWithCustomerSelect)
        .from(loans)
        .innerJoin(customers, eq(loans.customerId, customers.id))
        .where(and(eq(loans.status, "active"), isNull(loans.deletedAt)))
        .orderBy(desc(loans.createdAt));
      return rows;
    },
    catch: (e) => new DatabaseError({ cause: e }),
  });

/**
 * Direct loan row read. Use `includeDeleted: true` for rollover chain walking
 * (getLoan filters soft-deleted and must not be used for audit chains).
 */
export async function getLoanRowById(
  id: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<Loan | null> {
  const [row] = await db
    .select()
    .from(loans)
    .where(
      opts.includeDeleted
        ? eq(loans.id, id)
        : and(eq(loans.id, id), isNull(loans.deletedAt)),
    );
  return (row as Loan | undefined) ?? null;
}

/** Walk rolledOverFrom backwards (oldest first). Includes soft-deleted rows. */
export async function getLoanPredecessorChain(loanId: string): Promise<Loan[]> {
  const chain: Loan[] = [];
  const visited = new Set<string>();
  let current = await getLoanRowById(loanId, { includeDeleted: true });
  if (!current) return chain;

  let predecessorId = current.rolledOverFrom;
  while (predecessorId && !visited.has(predecessorId)) {
    visited.add(predecessorId);
    const pred = await getLoanRowById(predecessorId, { includeDeleted: true });
    if (!pred) break;
    chain.unshift(pred);
    predecessorId = pred.rolledOverFrom;
  }
  return chain;
}

/** Non-deleted successor where rolledOverFrom = loanId, or null. */
export async function getLoanSuccessor(loanId: string): Promise<Loan | null> {
  const [row] = await db
    .select()
    .from(loans)
    .where(
      and(eq(loans.rolledOverFrom, loanId), isNull(loans.deletedAt)),
    )
    .orderBy(desc(loans.createdAt))
    .limit(1);
  return (row as Loan | undefined) ?? null;
}

/** Single-loan list entry (uncapped) for deep links outside listLoans sync. */
export async function getLoanListEntryById(
  loanId: string,
): Promise<LoanListEntry | null> {
  const [row] = await db
    .select(loanWithCustomerSelect)
    .from(loans)
    .innerJoin(customers, eq(loans.customerId, customers.id))
    .where(and(eq(loans.id, loanId), isNull(loans.deletedAt)));
  if (!row) return null;
  const [entry] = await computeOverdue([row]);
  return entry ?? null;
}

/** Batch uncapped list entries for payment-list fallback outside the 500-cap sync. */
export async function getLoanListEntriesByIds(
  loanIds: string[],
): Promise<LoanListEntry[]> {
  const unique = [...new Set(loanIds.filter(Boolean))];
  if (unique.length === 0) return [];
  const rows = await db
    .select(loanWithCustomerSelect)
    .from(loans)
    .innerJoin(customers, eq(loans.customerId, customers.id))
    .where(and(inArray(loans.id, unique), isNull(loans.deletedAt)));
  return computeOverdue(rows);
}

/** Rollover audit rows for history UI (entityId = predecessor loan). */
export async function getRolloverAuditEntries(
  loanIds: string[],
): Promise<
  Array<{
    id: string;
    entityId: string;
    occurredAt: Date;
    afterValue: {
      rolledIntoLoanId?: string;
      carriedPrincipal?: string;
      carriedInterest?: string;
    } | null;
  }>
> {
  const unique = [...new Set(loanIds.filter(Boolean))];
  if (unique.length === 0) return [];
  const rows = await db
    .select({
      id: auditLog.id,
      entityId: auditLog.entityId,
      occurredAt: auditLog.occurredAt,
      afterValue: auditLog.afterValue,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityType, "loan"),
        eq(auditLog.action, "loan.rollover"),
        inArray(auditLog.entityId, unique),
      ),
    )
    .orderBy(desc(auditLog.occurredAt));

  return rows.map((row) => {
    let afterValue: {
      rolledIntoLoanId?: string;
      carriedPrincipal?: string;
      carriedInterest?: string;
    } | null = null;
    if (row.afterValue) {
      try {
        afterValue = JSON.parse(row.afterValue) as typeof afterValue;
      } catch {
        afterValue = null;
      }
    }
    return {
      id: row.id,
      entityId: row.entityId,
      occurredAt: row.occurredAt,
      afterValue,
    };
  });
}

export const updateLoan = (
  input: UpdateLoanInput,
  actorId: string,
): Effect.Effect<Loan, LoanNotFound | ValidationError | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [existingLoan] = await db
        .select()
        .from(loans)
        .where(and(eq(loans.id, input.loanId), isNull(loans.deletedAt)));

      if (!existingLoan) throw { _tag: "LoanNotFound", id: input.loanId };
      assertLoanOperational(existingLoan);

      const setObj: Partial<typeof loans.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.principalAmount !== undefined) {
        setObj.principalAmount = input.principalAmount;
      }
      if (input.interestRate !== undefined) {
        setObj.interestRate = input.interestRate;
      }
      if (input.startDate !== undefined) {
        setObj.startDate = new Date(input.startDate);
      }
      if (input.issuanceFee !== undefined) {
        setObj.issuanceFee = input.issuanceFee;
      }
      return await db.transaction(async (tx) => {
        const [updatedLoan] = await tx
          .update(loans)
          .set(setObj)
          .where(eq(loans.id, input.loanId))
          .returning();

        await writeAuditLog(tx, {
          actorId,
          action: "loan.update",
          entityType: "loan",
          entityId: input.loanId,
          beforeValue: existingLoan,
          afterValue: { ...setObj, reason: input.reason },
        });

        if (
          input.issuanceFee !== undefined &&
          input.issuanceFee !== existingLoan.issuanceFee
        ) {
          // Find the old fee credit to get the journalGroupId and amount
          const [oldFeeTx] = await tx
            .select({
              id: transactions.id,
              amount: transactions.amount,
              transactionDate: transactions.transactionDate,
              depositLocation: transactions.depositLocation,
              subLocationId: transactions.subLocationId,
              journalGroupId: transactions.journalGroupId,
            })
            .from(transactions)
            .innerJoin(
              transactionCategories,
              eq(transactions.categoryId, transactionCategories.id),
            )
            .where(
              and(
                eq(transactions.referenceType, "loan"),
                eq(transactions.referenceId, input.loanId),
                eq(transactions.type, "credit"),
                eq(transactionCategories.name, "Issuance Fees"),
              ),
            );

          if (oldFeeTx) {
            // Reverse old fee pair
            await postJournalEntry(tx, {
              debitCategory: { name: "Issuance Fees", type: "revenue" },
              creditCategory: { name: "Cash", type: "asset" },
              amount: oldFeeTx.amount,
              referenceType: "loan_reversal",
              referenceId: input.loanId,
              description: `Reversal - issuance fee updated for loan ${shortId(input.loanId).toUpperCase()}`,
              transactionDate: oldFeeTx.transactionDate,
              recordedBy: actorId,
              creditDepositLocation: oldFeeTx.depositLocation ?? undefined,
              creditSubLocationId: oldFeeTx.subLocationId ?? undefined,
              loanId: input.loanId,
            });
          }

          // Post new fee pair (if non-zero)
          if (new BigNumber(input.issuanceFee).isGreaterThan(0)) {
            await postJournalEntry(tx, {
              debitCategory: { name: "Cash", type: "asset" },
              creditCategory: { name: "Issuance Fees", type: "revenue" },
              amount: input.issuanceFee,
              referenceType: "loan",
              referenceId: input.loanId,
              description: `Issuance fee for loan ${shortId(input.loanId).toUpperCase()}`,
              transactionDate: oldFeeTx?.transactionDate ?? new Date(),
              recordedBy: actorId,
              debitDepositLocation: existingLoan.disbursementSource,
              debitSubLocationId: existingLoan.subLocationId ?? undefined,
              loanId: input.loanId,
            });
          }
        }

        // If principal changed, reverse old disbursement and post new one
        if (
          input.principalAmount !== undefined &&
          input.principalAmount !== existingLoan.principalAmount
        ) {
          const [oldDisbursement] = await tx
            .select()
            .from(transactions)
            .where(
              and(
                sql`${transactions.referenceType} IN ('loan', 'loan_repost')`,
                eq(transactions.referenceId, input.loanId),
                eq(transactions.type, "debit"),
              ),
            )
            .orderBy(desc(transactions.createdAt))
            .limit(1);

          if (oldDisbursement) {
            await postJournalEntry(tx, {
              debitCategory: { name: "Cash", type: "asset" },
              creditCategory: { name: "Loans Receivable", type: "asset" },
              amount: oldDisbursement.amount,
              referenceType: "loan_reversal",
              referenceId: input.loanId,
              description: `Reversal - principal updated for loan ${shortId(input.loanId).toUpperCase()}`,
              transactionDate: oldDisbursement.transactionDate,
              recordedBy: actorId,
              debitDepositLocation:
                oldDisbursement.depositLocation ??
                existingLoan.disbursementSource,
              debitSubLocationId:
                oldDisbursement.subLocationId ??
                existingLoan.subLocationId ??
                undefined,
              loanId: input.loanId,
            });

            await postJournalEntry(tx, {
              debitCategory: { name: "Loans Receivable", type: "asset" },
              creditCategory: { name: "Cash", type: "asset" },
              amount: input.principalAmount,
              referenceType: "loan_repost",
              referenceId: input.loanId,
              description: `Principal disbursed - loan ${shortId(input.loanId).toUpperCase()} (updated)`,
              transactionDate: oldDisbursement.transactionDate,
              recordedBy: actorId,
              creditDepositLocation:
                oldDisbursement.depositLocation ??
                existingLoan.disbursementSource,
              creditSubLocationId:
                oldDisbursement.subLocationId ??
                existingLoan.subLocationId ??
                undefined,
              loanId: input.loanId,
            });
          }

          // Recalculate all existing payments: reverse old journals, repost with new allocation
          const activePayments = await tx
            .select()
            .from(payments)
            .where(
              and(
                eq(payments.loanId, input.loanId),
                isNull(payments.deletedAt),
                eq(payments.markedWrong, false),
              ),
            )
            .orderBy(asc(payments.paymentDate), asc(payments.createdAt));

          if (activePayments.length > 0) {
            // Fetch all payment portions from ledger
            const paymentIds = activePayments.map((p) => p.id);
            const oldPortions = await getPaymentPortionsFromLedger(
              paymentIds,
              tx,
            );

            // Reverse all payment journals
            for (const p of activePayments) {
              const portion = oldPortions.get(p.id);
              if (!portion) continue;

              if (new BigNumber(portion.interestPortion).isGreaterThan(0)) {
                await postJournalEntry(tx, {
                  debitCategory: { name: "Interest Earned", type: "revenue" },
                  creditCategory: { name: "Cash", type: "asset" },
                  amount: portion.interestPortion,
                  referenceType: "payment_reversal",
                  referenceId: p.id,
                  description: `Reversal - principal updated for loan ${shortId(input.loanId).toUpperCase()}`,
                  transactionDate: new Date(p.paymentDate),
                  recordedBy: actorId,
                  creditDepositLocation: p.depositLocation ?? undefined,
                  creditSubLocationId: p.subLocationId ?? undefined,
                  loanId: input.loanId,
                });
              }

              if (new BigNumber(portion.principalPortion).isGreaterThan(0)) {
                await postJournalEntry(tx, {
                  debitCategory: { name: "Loans Receivable", type: "asset" },
                  creditCategory: { name: "Cash", type: "asset" },
                  amount: portion.principalPortion,
                  referenceType: "payment_reversal",
                  referenceId: p.id,
                  description: `Reversal - principal repayment updated for loan ${shortId(input.loanId).toUpperCase()}`,
                  transactionDate: new Date(p.paymentDate),
                  recordedBy: actorId,
                  creditDepositLocation: p.depositLocation ?? undefined,
                  creditSubLocationId: p.subLocationId ?? undefined,
                  loanId: input.loanId,
                });
              }
            }

            // Repost with new allocations based on updated principal
            const loanType = updatedLoan.loanType ?? "perpetual";
            const monthlyRateDecimal = getBaseRate(updatedLoan);
            const minInterestDays =
              updatedLoan.minPeriodOverride ?? updatedLoan.minInterestDays;
            let runningBalance = new BigNumber(input.principalAmount);

            for (let i = 0; i < activePayments.length; i++) {
              const p = activePayments[i];
              const prevDate =
                i === 0
                  ? new Date(updatedLoan.startDate)
                  : new Date(activePayments[i - 1].paymentDate);
              const daysElapsed = daysBetween(
                prevDate,
                new Date(p.paymentDate),
              );

              const allocation = await allocateLoanPayment({
                paymentAmount: p.amount,
                loanId: input.loanId,
                asOf: p.paymentDate,
              });

              if (new BigNumber(allocation.interestPortion).isGreaterThan(0)) {
                await autoPostInterestEarned(tx, {
                  amount: allocation.interestPortion,
                  loanId: input.loanId,
                  paymentId: p.id,
                  paymentDate: p.paymentDate.toISOString(),
                  actorId,
                  depositLocation: p.depositLocation ?? undefined,
                });
              }

              if (new BigNumber(allocation.principalPortion).isGreaterThan(0)) {
                await autoPostPrincipalRepayment(tx, {
                  amount: allocation.principalPortion,
                  loanId: input.loanId,
                  paymentId: p.id,
                  paymentDate: p.paymentDate.toISOString(),
                  actorId,
                  depositLocation: p.depositLocation ?? undefined,
                });
              }

              runningBalance = runningBalance.minus(
                new BigNumber(allocation.principalPortion),
              );
            }
          }
        }

        return updatedLoan as Loan;
      });
    },
    catch: (e: unknown) => {
      const err = e as { _tag?: string; id?: string; message?: string; field?: string };
      if (err?._tag === "LoanNotFound")
        return new LoanNotFound({ id: err.id as string });
      if (err?._tag === "ValidationError")
        return new ValidationError({
          message: err.message ?? "Validation failed",
          field: err.field,
        });
      return new DatabaseError({ cause: e });
    },
  });

export const deleteLoan = (
  input: DeleteLoanInput,
  actorId: string,
): Effect.Effect<Loan, LoanNotFound | ValidationError | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [existingLoan] = await db
        .select()
        .from(loans)
        .where(and(eq(loans.id, input.loanId), isNull(loans.deletedAt)));

      if (!existingLoan) throw { _tag: "LoanNotFound", id: input.loanId };

      // D1: block delete of rollover successors and predecessors with a live successor
      if (existingLoan.rolledOverFrom) {
        throw {
          _tag: "ValidationError",
          message:
            "Cannot delete a loan that was created from a rollover. Historical chain must be preserved.",
          field: "loanId",
        };
      }
      if (existingLoan.status === "rolled_over") {
        const [successor] = await db
          .select({ id: loans.id })
          .from(loans)
          .where(
            and(
              eq(loans.rolledOverFrom, existingLoan.id),
              isNull(loans.deletedAt),
            ),
          )
          .limit(1);
        if (successor) {
          throw {
            _tag: "ValidationError",
            message:
              "Cannot delete a rolled-over loan while its successor still exists.",
            field: "loanId",
          };
        }
      }

      const now = new Date();

      return await db.transaction(async (tx) => {
        await writeAuditLog(tx, {
          actorId,
          action: "loan.delete",
          entityType: "loan",
          entityId: input.loanId,
          beforeValue: existingLoan,
          afterValue: { reason: input.reason },
        });

        // Collect active payments BEFORE soft-deleting them
        const activePaymentIds = await tx
          .select()
          .from(payments)
          .where(
            and(eq(payments.loanId, input.loanId), isNull(payments.deletedAt)),
          );

        await tx
          .update(payments)
          .set({
            deletedAt: now,
            deletedBy: actorId,
            deleteReason: input.reason,
            updatedAt: now,
          })
          .where(
            and(eq(payments.loanId, input.loanId), isNull(payments.deletedAt)),
          );

        // Reverse issuance fee transaction (credit type distinguishes it from disbursement debit)
        const [feeTx] = await tx
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.referenceType, "loan"),
              eq(transactions.referenceId, input.loanId),
              eq(transactions.type, "credit"),
            ),
          );

        if (feeTx) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Issuance Fees", type: "revenue" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: feeTx.amount,
            referenceType: "loan_reversal",
            referenceId: input.loanId,
            description: `Reversal - loan ${shortId(input.loanId).toUpperCase()} deleted: ${input.reason}`,
            transactionDate: feeTx.transactionDate,
            recordedBy: actorId,
            creditDepositLocation: feeTx.depositLocation ?? undefined,
            creditSubLocationId: feeTx.subLocationId ?? undefined,
            loanId: input.loanId,
          });
        }

        // Reverse principal disbursement.
        // Filter by category — issuance fee and disbursement share reference_type='loan'
        // and the same createdAt, so without the category filter the query can return
        // the fee row and reverse the wrong amount.
        const [disbursementTx] = await tx
          .select({
            amount: transactions.amount,
            transactionDate: transactions.transactionDate,
            depositLocation: transactions.depositLocation,
            subLocationId: transactions.subLocationId,
          })
          .from(transactions)
          .innerJoin(
            transactionCategories,
            eq(transactions.categoryId, transactionCategories.id),
          )
          .where(
            and(
              sql`${transactions.referenceType} IN ('loan', 'loan_repost')`,
              eq(transactions.referenceId, input.loanId),
              eq(transactions.type, "debit"),
              eq(transactionCategories.name, "Loans Receivable"),
            ),
          )
          .orderBy(desc(transactions.createdAt))
          .limit(1);

        if (disbursementTx) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Cash", type: "asset" },
            creditCategory: { name: "Loans Receivable", type: "asset" },
            amount: disbursementTx.amount,
            referenceType: "loan_reversal",
            referenceId: input.loanId,
            description: `Reversal - principal disbursement for loan ${shortId(input.loanId).toUpperCase()} deleted: ${input.reason}`,
            transactionDate: disbursementTx.transactionDate,
            recordedBy: actorId,
            debitDepositLocation: disbursementTx.depositLocation ?? undefined,
            debitSubLocationId: disbursementTx.subLocationId ?? undefined,
            loanId: input.loanId,
          });
        }

        // Reverse interest/principal transactions for payments that were active at deletion time
        // (already-deleted payments had their journals reversed when they were individually deleted)
        const loanPayments = activePaymentIds;
        const paymentPortions =
          loanPayments.length > 0
            ? await getPaymentPortionsFromLedger(
                loanPayments.map((p) => p.id),
                tx,
              )
            : new Map();

        for (const p of loanPayments) {
          const portion = paymentPortions.get(p.id);
          if (!portion) continue;

          if (new BigNumber(portion.interestPortion).isGreaterThan(0)) {
            await postJournalEntry(tx, {
              debitCategory: { name: "Interest Earned", type: "revenue" },
              creditCategory: { name: "Cash", type: "asset" },
              amount: portion.interestPortion,
              referenceType: "payment_reversal",
              referenceId: p.id,
              description: `Reversal - loan ${shortId(input.loanId).toUpperCase()} deleted: ${input.reason}`,
              transactionDate: new Date(p.paymentDate),
              recordedBy: actorId,
              creditDepositLocation: p.depositLocation ?? undefined,
              creditSubLocationId: p.subLocationId ?? undefined,
              loanId: input.loanId,
            });
          }

          if (new BigNumber(portion.principalPortion).isGreaterThan(0)) {
            await postJournalEntry(tx, {
              debitCategory: { name: "Loans Receivable", type: "asset" },
              creditCategory: { name: "Cash", type: "asset" },
              amount: portion.principalPortion,
              referenceType: "payment_reversal",
              referenceId: p.id,
              description: `Reversal - principal repayment for loan ${shortId(input.loanId).toUpperCase()} deleted: ${input.reason}`,
              transactionDate: new Date(p.paymentDate),
              recordedBy: actorId,
              creditDepositLocation: p.depositLocation ?? undefined,
              creditSubLocationId: p.subLocationId ?? undefined,
              loanId: input.loanId,
            });
          }
        }

        // Reverse rollover ledger entries (carried principal + carried interest debits on Loans Receivable)
        if (existingLoan.rolledOverFrom) {
          const rolloverDebits = await tx
            .select({
              amount: transactions.amount,
              transactionDate: transactions.transactionDate,
            })
            .from(transactions)
            .innerJoin(
              transactionCategories,
              eq(transactions.categoryId, transactionCategories.id),
            )
            .where(
              and(
                eq(transactions.referenceType, "rollover"),
                eq(transactions.loanId, input.loanId),
                eq(transactions.type, "debit"),
                eq(transactionCategories.name, "Loans Receivable"),
              ),
            );

          for (const entry of rolloverDebits) {
            await postJournalEntry(tx, {
              debitCategory: { name: "Cash", type: "asset" },
              creditCategory: { name: "Loans Receivable", type: "asset" },
              amount: entry.amount,
              referenceType: "loan_reversal",
              referenceId: input.loanId,
              description: `Reversal - rollover entry for deleted loan ${shortId(input.loanId).toUpperCase()}: ${input.reason}`,
              transactionDate: entry.transactionDate,
              recordedBy: actorId,
              loanId: input.loanId,
            });
          }

          // Also reverse the Interest Earned credit posted for carried interest
          const rolloverInterestCredits = await tx
            .select({
              amount: transactions.amount,
              transactionDate: transactions.transactionDate,
            })
            .from(transactions)
            .innerJoin(
              transactionCategories,
              eq(transactions.categoryId, transactionCategories.id),
            )
            .where(
              and(
                eq(transactions.referenceType, "rollover"),
                eq(transactions.loanId, input.loanId),
                eq(transactions.type, "credit"),
                eq(transactionCategories.name, "Interest Earned"),
              ),
            );

          for (const entry of rolloverInterestCredits) {
            await postJournalEntry(tx, {
              debitCategory: { name: "Interest Earned", type: "revenue" },
              creditCategory: { name: "Cash", type: "asset" },
              amount: entry.amount,
              referenceType: "loan_reversal",
              referenceId: input.loanId,
              description: `Reversal - rollover interest for deleted loan ${shortId(input.loanId).toUpperCase()}: ${input.reason}`,
              transactionDate: entry.transactionDate,
              recordedBy: actorId,
              loanId: input.loanId,
            });
          }
        }

        await tx
          .update(loans)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(loans.id, input.loanId));

        return existingLoan as Loan;
      });
    },
    catch: (e: unknown) => {
      const err = e as {
        _tag?: string;
        id?: string;
        message?: string;
        field?: string;
      };
      if (err?._tag === "LoanNotFound")
        return new LoanNotFound({ id: err.id as string });
      if (err?._tag === "ValidationError")
        return new ValidationError({
          message: err.message ?? "Cannot delete loan",
          field: err.field,
        });
      return new DatabaseError({ cause: e });
    },
  });

/**
 * List all loan_balances projection rows. Used by the query-backed
 * loanBalanceCollection after migrating from Electric.
 */
export const listLoanBalances = () =>
  Effect.tryPromise({
    try: async () => {
      return await computeAllLoansBalanceData();
    },
    catch: (e) => new DatabaseError({ cause: e }),
  });

// ---------------------------------------------------------------------------
// Read helpers extracted from loan.actions.ts (data access only — no auth).
// Each mirrors the inline query previously living in the action so the action
// can be reduced to permission-check + delegate.
// ---------------------------------------------------------------------------

/** Distinct collateral nature values, alphabetical. */
export async function getCollateralNatures(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ nature: collateral.nature })
    .from(collateral)
    .orderBy(collateral.nature);
  return rows.map((r) => r.nature);
}

export interface LoanPaymentContext {
  loanId: string;
  customerId: string;
  customerName: string;
  loanReference: string;
  startDate: string;
  status: LoanStatus;
}

/** Loan + customer context for the payment-recording screen. null when not found. */
export async function getLoanPaymentContext(
  loanId: string,
): Promise<LoanPaymentContext | null> {
  const [row] = await db
    .select({
      id: loans.id,
      customerId: loans.customerId,
      customerName: customers.fullName,
      startDate: loans.startDate,
      status: loans.status,
    })
    .from(loans)
    .innerJoin(customers, eq(loans.customerId, customers.id))
    .where(and(eq(loans.id, loanId), isNull(loans.deletedAt)));

  if (!row) return null;

  return {
    loanId: row.id,
    customerId: row.customerId,
    customerName: row.customerName,
    loanReference: `LOAN-${shortId(row.id).toUpperCase()}`,
    startDate: localDateString(row.startDate),
    status: row.status as LoanStatus,
  };
}

/** Collateral record for a loan, or null. */
export async function getLoanCollateral(
  loanId: string,
): Promise<{ nature: string; description: string | null } | null> {
  const [record] = await db
    .select({ nature: collateral.nature, description: collateral.description })
    .from(collateral)
    .where(eq(collateral.loanId, loanId));
  return record ?? null;
}

/** Assembled receipt payload for a disbursed loan. */
export interface LoanReceiptData {
  receiptNumber: string;
  date: string;
  customerName: string;
  customerNin?: string;
  customerPhone?: string;
  loanAmount: string;
  issuanceFee: string;
  interestRate: string;
  collateralNature: string;
  disbursementSource: string;
  officerName: string;
  rolloverAmount?: string;
  totalNewPrincipal?: string;
}

/** Assembled receipt payload for a loan, or null when the loan is not found. */
export async function getLoanReceiptData(
  loanId: string,
): Promise<LoanReceiptData | null> {
  const [loan] = await db
    .select()
    .from(loans)
    .where(and(eq(loans.id, loanId), isNull(loans.deletedAt)));
  if (!loan) return null;

  const [[customer], [collateralRecord], [issuingUser]] = await Promise.all([
    db.select().from(customers).where(eq(customers.id, loan.customerId)),
    db.select().from(collateral).where(eq(collateral.loanId, loanId)),
    db.select().from(user).where(eq(user.id, loan.issuedBy)),
  ]);

  const rate = new BigNumber(
    loan.interestRateOverride ?? loan.interestRate,
  ).multipliedBy(100);
  const isRollover =
    !!loan.rolloverAmount &&
    new BigNumber(loan.rolloverAmount).isGreaterThan(0);
  return {
    receiptNumber: `LOAN-${shortId(loanId).toUpperCase()}`,
    date: loan.startDate.toISOString(),
    customerName: customer?.fullName ?? "—",
    customerNin: customer?.id ?? undefined,
    customerPhone: customer?.contact ?? undefined,
    loanAmount: isRollover
      ? new BigNumber(loan.principalAmount)
          .minus(new BigNumber(loan.rolloverAmount!))
          .toFixed(0)
      : loan.principalAmount,
    issuanceFee: loan.issuanceFee,
    interestRate: `${rate.toFixed(rate.mod(1).isZero() ? 0 : 1)}%`,
    collateralNature: collateralRecord?.nature ?? "—",
    disbursementSource: loan.disbursementSource,
    officerName: issuingUser?.name ?? "Officer",
    ...(isRollover
      ? {
          rolloverAmount: loan.rolloverAmount!,
          totalNewPrincipal: loan.principalAmount,
        }
      : {}),
  };
}

/** Resolve an array of user IDs to a { [id]: name } map. */
export async function resolveUserNames(
  userIds: string[],
): Promise<Record<string, string>> {
  if (userIds.length === 0) return {};
  const unique = [...new Set(userIds)];
  const rows = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, unique));
  const map: Record<string, string> = {};
  for (const r of rows) map[r.id] = r.name;
  return map;
}

/**
 * Enrich loans with overdue/balance projections from the ledger + payments.
 * Batch-fetches payments and ledger aggregates in parallel.
 */
export async function computeOverdue(
  loanList: LoanWithCustomer[],
): Promise<LoanListEntry[]> {
  const loanIds = loanList.map((l) => l.id);
  const paymentsPromise =
    loanIds.length > 0
      ? db
          .select()
          .from(payments)
          .where(
            and(
              inArray(payments.loanId, loanIds),
              isNull(payments.deletedAt),
              eq(payments.markedWrong, false),
            ),
          )
          .orderBy(asc(payments.paymentDate))
      : Promise.resolve([]);
  const [allPayments, ledgerBalances, interestEarnedMap] = await Promise.all([
    paymentsPromise,
    getLoanBalancesFromLedger(loanIds),
    getInterestEarnedFromLedger(loanIds),
  ]);

  const paymentsByLoanId = new Map<string, (typeof allPayments)[number][]>();
  for (const p of allPayments) {
    const existing = paymentsByLoanId.get(p.loanId) ?? [];
    existing.push(p);
    paymentsByLoanId.set(p.loanId, existing);
  }
  const balanceInfo = await computeLoanBalanceData(loanIds, new Date());
  // const info = await computeSingleLoanBalanceData(loan.id, new Date())
  return loanList.map((loan) => {
    let daysOverdue = 0;
    let dailyRate = "0";
    let unpaidInterest = "0";
    let outstandingBalance = "0";

    const balanceEntry = balanceInfo.get(loan.id);
    const lastPaymentDate: Date | null = balanceEntry?.lastPaymentDate ?? null;

    if (loan.status === "active") {
      const ledgerBalance = ledgerBalances.get(loan.id);
      if (ledgerBalance === undefined) {
        console.warn(
          `[computeOverdue] No ledger entries for loan ${loan.id}, using principalAmount as fallback`,
        );
      }
      outstandingBalance =
        ledgerBalance !== undefined
          ? ledgerBalance.toFixed(0)
          : loan.principalAmount;

      const info = balanceInfo.get(loan.id);
      if (info) {
        daysOverdue = info.daysOverdue;
        dailyRate = info.dailyRate;
        unpaidInterest = info.unpaidInterest;
      }
    }

    return {
      ...loan,
      daysOverdue,
      outstandingBalance,
      dailyRate,
      lastPaymentDate,
      unpaidInterest,
    };
  });
}

/** All non-deleted loans for a customer, enriched with overdue info, newest first. */
export async function getCustomerLoansWithOverdue(
  customerId: string,
): Promise<LoanListEntry[]> {
  const customerLoans = await db
    .select(loanWithCustomerSelect)
    .from(loans)
    .innerJoin(customers, eq(loans.customerId, customers.id))
    .where(and(eq(loans.customerId, customerId), isNull(loans.deletedAt)))
    .orderBy(desc(loans.createdAt));
  return computeOverdue(customerLoans);
}

/** Count of non-deleted loans grouped by status. */
export async function getLoanStatusCounts(): Promise<
  Record<LoanStatus, number>
> {
  const rows = await db
    .select({ status: loans.status, count: sql<number>`count(*)::int` })
    .from(loans)
    .where(isNull(loans.deletedAt))
    .groupBy(loans.status);

  const counts: Record<LoanStatus, number> = {
    pending: 0,
    active: 0,
    fully_paid: 0,
    settled_with_collateral: 0,
    rolled_over: 0,
  };
  for (const row of rows) {
    counts[row.status as LoanStatus] = row.count;
  }
  return counts;
}

/** Active loans enriched with overdue info (uncapped — uses listOperationalLoans). */
export async function listActiveLoansWithOverdue(): Promise<LoanListEntry[]> {
  const activeLoans = await Effect.runPromise(listOperationalLoans());
  return computeOverdue(activeLoans);
}

export type LoanExportFilter =
  | "all"
  | "critical"
  | "at-risk"
  | "early"
  | undefined;

/** Loan entries for Excel export, with optional overdue-bucket filter applied. */
export async function getLoansForExport(
  filter: LoanExportFilter,
): Promise<LoanListEntry[]> {
  const operational = await Effect.runPromise(listOperationalLoans());
  let entries = await computeOverdue(operational);

  if (filter && filter !== "all") {
    entries = entries.filter((entry) => {
      if (entry.daysOverdue < 0) return false;
      if (filter === "critical") return entry.daysOverdue >= 30;
      if (filter === "at-risk")
        return entry.daysOverdue >= 25 && entry.daysOverdue < 30;
      if (filter === "early")
        return entry.daysOverdue >= 0 && entry.daysOverdue < 25;
      return true;
    });
  }
  return entries;
}

/**
 * Waive penalty interest on a loan. Returns the updated loan + txid, or
 * { notFound: true } when the loan does not exist / is deleted.
 */
export async function waivePenalty(
  loanId: string,
  actorId: string,
): Promise<{ data: Loan; txid: number } | { notFound: true }> {
  return db.transaction(async (tx) => {
    const [loan] = await tx
      .select()
      .from(loans)
      .where(and(eq(loans.id, loanId), isNull(loans.deletedAt)))
      .for("update");

    if (!loan) return { notFound: true as const };
    assertLoanOperational(loan);

    const [updated] = await tx
      .update(loans)
      .set({
        penaltyWaived: true,
        penaltyWaivedBy: actorId,
        penaltyWaivedAt: new Date(),
      })
      .where(eq(loans.id, loanId))
      .returning();

    const txidRows = await tx.execute<{ txid: string }>(
      sql`SELECT pg_current_xact_id()::text as txid`,
    );
    const txid = Number(
      (txidRows as unknown as Array<{ txid: string }>)[0].txid,
    );
    return { data: updated as Loan, txid };
  });
}

/**
 * Set the penalty multiplier on a loan. `value` must already be validated
 * (0 <= value < 1) by the caller. Returns updated loan + txid or notFound.
 * (Mirrors the original action, which did not record an actor for this change.)
 */
export async function adjustPenaltyMultiplier(
  loanId: string,
  value: number,
): Promise<{ data: Loan; txid: number } | { notFound: true }> {
  return db.transaction(async (tx) => {
    const [loan] = await tx
      .select()
      .from(loans)
      .where(and(eq(loans.id, loanId), isNull(loans.deletedAt)))
      .for("update");

    if (!loan) return { notFound: true as const };
    assertLoanOperational(loan);

    const [updated] = await tx
      .update(loans)
      .set({ penaltyMultiplier: value.toFixed(4) })
      .where(eq(loans.id, loanId))
      .returning();

    const txidRows = await tx.execute<{ txid: string }>(
      sql`SELECT pg_current_xact_id()::text as txid`,
    );
    const txid = Number(
      (txidRows as unknown as Array<{ txid: string }>)[0].txid,
    );
    return { data: updated as Loan, txid };
  });
}
