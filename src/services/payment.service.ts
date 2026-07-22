import { Effect } from "effect";
import { db } from "@/lib/db";
import { payments } from "@/lib/db/schema/payments";
import { loans } from "@/lib/db/schema/loans";
import { customers } from "@/lib/db/schema/customers";
import { user } from "@/lib/db/schema/auth";
import { getEffectiveRate } from "@/lib/interest/effective-rate";
import {
  eq,
  asc,
  and,
  isNull,
  gte,
  lte,
  ilike,
  desc,
  count,
  sql,
  inArray,
} from "drizzle-orm";
import {
  DatabaseError,
  LoanNotFound,
  PaymentNotFound,
  ValidationError,
} from "@/lib/errors";
import { isUniqueConstraintError } from "@/lib/db-errors";
import { writeAuditLog } from "./audit.service";
import { allocateLoanPayment, formatAmount } from "@/lib/interest/engine";
import {
  postJournalEntry,
  reverseInterestAccrual,
} from "./transaction.service";
import {
  autoPostInterestEarned,
  autoPostPrincipalRepayment,
} from "./auto-post.service";
import {
  getLoanBalanceFromLedger,
  getPaymentPortionsFromLedger,
} from "./ledger-queries.service";
import BigNumber from "bignumber.js";
import { escapeLikePattern } from "@/lib/db/utils";
import { localDateString } from "@/lib/utils";
import {
  assertLoanOperational,
  isOperationalLoan,
  isTerminalLoanStatus,
} from "@/lib/loan-visibility";
import { cancelPendingRateChangeRequestsForLoan } from "./rate-change-request.service";
import {
  toLoanType,
  type RecordPaymentInput,
  type EditPaymentInput,
  type DeletePaymentInput,
  type Payment,
  type ListPaymentsInput,
  type PaymentWithCustomer,
  type ActiveLoanSearchResult,
  type RecentlyCollectedLoan,
  type LoanStatus,
} from "@/types";
import { computeSingleLoanBalanceData } from "@/lib/interest/loanBalanceData";
import { endOfDay } from "date-fns";
import { allocateLoanPaymentServerSide } from "@/lib/interest/engine-server";
import {
  getLastSettlementDate,
  reconstructPrincipalBalanceBefore,
  sumInterestAlreadyPaidInPeriod,
  getPriorSettlementDate,
} from "@/services/settlement.service";

export {
  getLastSettlementDate,
  getLastSettlementEvent,
  getLastSettlementEventsForLoans,
  getLastPaymentDate,
} from "@/services/settlement.service";

type DrizzleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Skip automatic status transitions on terminal lifecycle loans
 * (never flip rolled_over / settled / fully_paid via payment side effects
 * when those statuses are already terminal — entry guards block mutations
 * on non-active loans; this is defense in depth).
 */
export async function maybeUpdateLoanStatusAfterPayment(
  tx: DrizzleTransaction,
  loan: { id: string; status: LoanStatus },
  next: "fully_paid" | "active",
  actorId?: string,
): Promise<void> {
  if (isTerminalLoanStatus(loan.status)) return;
  if (loan.status === next) return;

  await tx
    .update(loans)
    .set({ status: next, updatedAt: new Date() })
    .where(eq(loans.id, loan.id));

  if (next === "fully_paid" && actorId) {
    await cancelPendingRateChangeRequestsForLoan(
      tx,
      loan.id,
      "fully_paid",
      actorId,
    );
  }
}

/** Ledger principal = 0 AND accrual unpaid interest = 0 at `asOf`. */
export async function isLoanEconomicallyFullyPaid(
  loanId: string,
  asOf: Date = new Date(),
  queryDb?: Pick<typeof db, "select">,
): Promise<boolean> {
  const principal = await getLoanBalanceFromLedger(loanId, asOf, queryDb);
  if (principal.isGreaterThan(0)) return false;
  const info = await computeSingleLoanBalanceData(loanId, asOf, queryDb);
  return new BigNumber(info.unpaidInterest).isLessThanOrEqualTo(0);
}

/**
 * Compute the current balance summary for a loan: outstanding principal,
 * accrued interest, and total balance. Single source of truth used by
 * both the payment recording page and the quick-record dialog.
 */
export async function getLoanBalanceSummary(loanId: string): Promise<{
  outstandingPrincipal: string;
  accruedInterest: string;
  totalBalance: string;
  loanType: string;
}> {
  const [loan] = await db.select().from(loans).where(eq(loans.id, loanId));
  if (!loan || loan.deletedAt) throw new LoanNotFound({ id: loanId });

  const loanType = toLoanType(loan.loanType);

  // Path A / R21-4: readable for history but zeros for non-operational loans
  if (!isOperationalLoan(loan.status)) {
    return {
      outstandingPrincipal: "0",
      accruedInterest: "0",
      totalBalance: "0",
      loanType,
    };
  }

  const info = await computeSingleLoanBalanceData(loan.id, new Date());

  const outstandingPrincipal = info?.totalBalanceOwed;

  const accruedInterest = info?.unpaidInterest;
  const totalBalance = new BigNumber(outstandingPrincipal)
    .plus(new BigNumber(accruedInterest))
    .toFixed(0);

  return { outstandingPrincipal, accruedInterest, totalBalance, loanType };
}

export const recordPayment = (input: RecordPaymentInput, actorId: string) =>
  Effect.map(recordPaymentWithTxid(input, actorId), ({ payment }) => payment);

/**
 * Like recordPayment but also returns the Postgres transaction ID.
 * Required for Electric collections so the client can wait for the
 * specific transaction to appear in the shape stream before clearing
 * optimistic state.
 */
export const recordPaymentWithTxid = (
  input: RecordPaymentInput,
  actorId: string,
): Effect.Effect<
  {
    payment: Payment & {
      allocation: Awaited<ReturnType<typeof allocateLoanPaymentServerSide>>;
    };
    txid: number;
  },
  LoanNotFound | ValidationError | DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [loan] = await tx
          .select()
          .from(loans)
          .where(eq(loans.id, input.loanId))
          .for("update");
        if (!loan || loan.deletedAt)
          throw { _tag: "LoanNotFound", id: input.loanId };
        assertLoanOperational(loan);

        // L2: Reject zero or negative payment amounts
        if (new BigNumber(input.amount).isLessThanOrEqualTo(0)) {
          throw {
            _tag: "ValidationError",
            message: "Payment amount must be greater than zero",
            field: "amount",
          };
        }

        // L1: Reject payments dated before the loan start date
        if (new Date(input.paymentDate) < new Date(loan.startDate)) {
          throw {
            _tag: "ValidationError",
            message: "Payment date cannot be before loan start date",
            field: "paymentDate",
          };
        }

        // Reject future-dated payments — payments can only be recorded for today or earlier
        // Use localDateString to avoid UTC-shift: toISOString() returns UTC date which
        // can differ from the local calendar day in UTC+ timezones (BUG-7).
        const paymentDateOnly = localDateString(new Date(input.paymentDate));
        const todayOnly = localDateString(new Date());
        if (paymentDateOnly > todayOnly) {
          throw {
            _tag: "ValidationError",
            message: "Payment date cannot be in the future",
            field: "paymentDate",
          };
        }
        const allocation = await allocateLoanPaymentServerSide({
          loanId: loan.id,
          asOf: endOfDay(new Date(input.paymentDate)),
          paymentAmount: input.amount,
          queryDb: tx,
        });

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
          .orderBy(asc(payments.paymentDate), asc(payments.createdAt))
          .for("update");

        const principalBalanceBefore = allocation.principalBalanceBefore;
        const monthlyRateDecimal = getEffectiveRate(
          loan,
          allocation.penaltyActive,
        );
        const loanType = loan.loanType ?? "perpetual";
        const paymentNumber = activePayments.length + 1;

        const principalPortion = allocation.principalPortion;
        const interestPortion = allocation.interestPortion;

        // M2: Reject overpayments that exceed total owed
        let totalOwed: BigNumber;
        if (loanType === "fixed_rate") {
          // Fixed rate: remaining principal + all remaining term interest
          const monthlyInterest = new BigNumber(
            principalBalanceBefore,
          ).multipliedBy(new BigNumber(monthlyRateDecimal));
          const remainingMonths = Math.max(
            (loan.termMonths ?? 0) - paymentNumber + 1,
            1,
          );
          totalOwed = new BigNumber(principalBalanceBefore).plus(
            monthlyInterest.multipliedBy(remainingMonths),
          );
        } else if (loanType === "reducing_balance") {
          // Reducing balance: remaining principal + current period interest
          const currentInterest = new BigNumber(
            principalBalanceBefore,
          ).multipliedBy(new BigNumber(monthlyRateDecimal));
          totalOwed = new BigNumber(principalBalanceBefore).plus(
            currentInterest,
          );
        } else {
          // Perpetual: interest + principal (existing logic)
          totalOwed = new BigNumber(interestPortion).plus(
            new BigNumber(principalBalanceBefore),
          );
        }
        if (new BigNumber(input.amount).isGreaterThan(totalOwed)) {
          throw {
            _tag: "ValidationError",
            message: `Payment amount ${input.amount} exceeds total owed ${formatAmount(totalOwed)}`,
            field: "amount",
          };
        }

        const [newPayment] = await tx
          .insert(payments)
          .values({
            ...(input.id ? { id: input.id } : {}),
            loanId: input.loanId,
            paymentDate: new Date(input.paymentDate),
            amount: input.amount,
            recordedBy: actorId,
            depositLocation: input.depositLocation,
            subLocationId: input.subLocationId ?? null,
          })
          .returning();

        await writeAuditLog(tx, {
          actorId,
          action: "payment.create",
          entityType: "payment",
          entityId: newPayment.id,
          beforeValue: null,
          afterValue: newPayment,
        });

        if (new BigNumber(interestPortion).isGreaterThan(0)) {
          // Reverse any outstanding interest accrual before posting cash-basis interest
          await reverseInterestAccrual(tx, {
            loanId: input.loanId,
            paymentDate: input.paymentDate,
            actorId,
          });
          await autoPostInterestEarned(tx, {
            amount: interestPortion,
            loanId: input.loanId,
            paymentId: newPayment.id,
            paymentDate: input.paymentDate,
            actorId,
            depositLocation: input.depositLocation,
            subLocationId: input.subLocationId,
          });
        }

        if (new BigNumber(principalPortion).isGreaterThan(0)) {
          await autoPostPrincipalRepayment(tx, {
            amount: principalPortion,
            loanId: input.loanId,
            paymentId: newPayment.id,
            paymentDate: input.paymentDate,
            actorId,
            depositLocation: input.depositLocation,
            subLocationId: input.subLocationId,
          });
        }

        // Check fully-paid status after posting journals
        if (
          await isLoanEconomicallyFullyPaid(input.loanId, endOfDay(new Date(input.paymentDate)), tx)
        ) {
          await maybeUpdateLoanStatusAfterPayment(
            tx,
            loan,
            "fully_paid",
            actorId,
          );
        }

        const txidRows = await tx.execute<{ txid: string }>(
          sql`SELECT pg_current_xact_id()::text as txid`,
        );
        const txid = Number(
          (txidRows as unknown as Array<{ txid: string }>)[0].txid,
        );
        return { payment: { ...newPayment, allocation }, txid };
      });
    },
    catch: (e: any) => {
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id });
      if (e?._tag === "ValidationError")
        return new ValidationError({ message: e.message, field: e.field });
      return new DatabaseError({ cause: e });
    },
  }).pipe(
    Effect.catchIf(
      (e) =>
        e._tag === "DatabaseError" &&
        !!input.id &&
        isUniqueConstraintError(e.cause),
      () => recordPaymentWithTxid({ ...input, id: undefined }, actorId),
    ),
  );

export const editPayment = (
  input: EditPaymentInput,
  actorId: string,
): Effect.Effect<
  Payment,
  PaymentNotFound | LoanNotFound | ValidationError | DatabaseError
> => Effect.map(editPaymentWithTxid(input, actorId), ({ payment }) => payment);

/**
 * Like editPayment but also returns the Postgres transaction ID.
 * Required for Electric collections so the client can wait for the
 * specific transaction to appear in the shape stream before clearing
 * optimistic state.
 */
export const editPaymentWithTxid = (
  input: EditPaymentInput,
  actorId: string,
): Effect.Effect<
  { payment: Payment; txid: number },
  PaymentNotFound | LoanNotFound | ValidationError | DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [payment] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, input.paymentId));
        if (!payment || payment.deletedAt !== null)
          throw { _tag: "PaymentNotFound", id: input.paymentId };

        const [loan] = await tx
          .select()
          .from(loans)
          .where(eq(loans.id, payment.loanId))
          .for("update");
        if (!loan || loan.deletedAt)
          throw { _tag: "LoanNotFound", id: payment.loanId };
        assertLoanOperational(loan);

        const newAmount = input.amount ?? payment.amount;
        const newPaymentDate = input.paymentDate
          ? new Date(input.paymentDate)
          : new Date(payment.paymentDate);

        // L2: Reject zero or negative payment amounts
        if (new BigNumber(newAmount).isLessThanOrEqualTo(0)) {
          throw {
            _tag: "ValidationError",
            message: "Payment amount must be greater than zero",
            field: "amount",
          };
        }

        // L1: Reject payments dated before the loan start date
        if (newPaymentDate < new Date(loan.startDate)) {
          throw {
            _tag: "ValidationError",
            message: "Payment date cannot be before loan start date",
            field: "paymentDate",
          };
        }

        // Reject future-dated payments — use local date to avoid UTC-shift (BUG-7)
        const editDateOnly = localDateString(newPaymentDate);
        const editTodayOnly = localDateString(new Date());
        if (editDateOnly > editTodayOnly) {
          throw {
            _tag: "ValidationError",
            message: "Payment date cannot be in the future",
            field: "paymentDate",
          };
        }

        // 1. Reverse old journals using ledger-derived portions
        const oldPortions = await getPaymentPortionsFromLedger(
          [input.paymentId],
          tx,
        );
        const oldPortion = oldPortions.get(input.paymentId);

        if (
          oldPortion &&
          new BigNumber(oldPortion.interestPortion).isGreaterThan(0)
        ) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Interest Earned", type: "revenue" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: oldPortion.interestPortion,
            referenceType: "payment_reversal",
            referenceId: input.paymentId,
            description: `Reversal - payment ${input.paymentId} edited: ${input.reason}`,
            transactionDate: new Date(payment.paymentDate),
            recordedBy: actorId,
            creditDepositLocation: payment.depositLocation ?? undefined,
            creditSubLocationId: payment.subLocationId ?? undefined,
            loanId: payment.loanId,
          });
        }

        if (
          oldPortion &&
          new BigNumber(oldPortion.principalPortion).isGreaterThan(0)
        ) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Loans Receivable", type: "asset" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: oldPortion.principalPortion,
            referenceType: "payment_reversal",
            referenceId: input.paymentId,
            description: `Reversal - principal repayment ${input.paymentId} edited: ${input.reason}`,
            transactionDate: new Date(payment.paymentDate),
            recordedBy: actorId,
            creditDepositLocation: payment.depositLocation ?? undefined,
            creditSubLocationId: payment.subLocationId ?? undefined,
            loanId: payment.loanId,
          });
        }

        // 2. Update the payment row
        const beforeValue = { ...payment };
        const updates: {
          updatedAt: Date;
          editReason: string;
          amount?: string;
          paymentDate?: Date;
        } = {
          updatedAt: new Date(),
          editReason: input.reason,
        };
        if (input.amount !== undefined) updates.amount = input.amount;
        if (input.paymentDate !== undefined)
          updates.paymentDate = new Date(input.paymentDate);

        await tx
          .update(payments)
          .set(updates)
          .where(eq(payments.id, input.paymentId));

        // 3. Recompute allocation with new amount/date
        // BUG-8 fix: compute overdue info to get effective rate (with penalty if applicable),
        // consistent with recordPayment which uses getEffectiveRate via overdueInfo.
        const minInterestDays = loan.minPeriodOverride ?? loan.minInterestDays;
        const loanType = loan.loanType ?? "perpetual";

        const activePayments = await tx
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.loanId, payment.loanId),
              isNull(payments.deletedAt),
              eq(payments.markedWrong, false),
            ),
          )
          .orderBy(asc(payments.paymentDate), asc(payments.createdAt));

        const paymentIdx = activePayments.findIndex(
          (p) => p.id === input.paymentId,
        );
        const paymentNumber = paymentIdx + 1;

        const priorPaymentIds =
          paymentIdx > 0
            ? activePayments.slice(0, paymentIdx).map((p) => p.id)
            : [];
        const principalBalanceBefore = await reconstructPrincipalBalanceBefore(
          {
            loanId: loan.id,
            originalPrincipal: loan.principalAmount,
            targetDate: newPaymentDate,
            priorPaymentIds,
            queryDb: tx,
          },
        );

        const overdueInfo = await computeSingleLoanBalanceData(
          loan.id,
          endOfDay(newPaymentDate),
        );

        const monthlyRateDecimal = getEffectiveRate(
          loan,
          overdueInfo.penaltyActive,
        );

        const prevSettlementDate = await getPriorSettlementDate(
          loan,
          newPaymentDate,
          [input.paymentId],
          tx,
        );
        const interestAlreadyPaidInPeriod =
          await sumInterestAlreadyPaidInPeriod({
            loanId: loan.id,
            prevDate: prevSettlementDate,
            targetDate: newPaymentDate,
            excludePaymentId: input.paymentId,
            queryDb: tx,
          });

        const allocation = await allocateLoanPayment({
          paymentAmount: newAmount,
          loanId: loan.id,
          asOf: endOfDay(newPaymentDate),
          interestAlreadyPaidInPeriod,
          principalBalanceBefore,
          paymentNumber,
          prevSettlementDate,
          queryDb: tx,
        });

        // M2: Reject overpayments that exceed total owed
        let totalOwed: BigNumber;
        if (loanType === "fixed_rate") {
          const monthlyInterest = new BigNumber(
            principalBalanceBefore,
          ).multipliedBy(new BigNumber(monthlyRateDecimal));
          const remainingMonths = Math.max(
            (loan.termMonths ?? 0) - paymentNumber + 1,
            1,
          );
          totalOwed = new BigNumber(principalBalanceBefore).plus(
            monthlyInterest.multipliedBy(remainingMonths),
          );
        } else if (loanType === "reducing_balance") {
          const currentInterest = new BigNumber(
            principalBalanceBefore,
          ).multipliedBy(new BigNumber(monthlyRateDecimal));
          totalOwed = new BigNumber(principalBalanceBefore).plus(
            currentInterest,
          );
        } else {
          totalOwed = new BigNumber(allocation.interestPortion).plus(
            new BigNumber(principalBalanceBefore),
          );
        }
        if (new BigNumber(newAmount).isGreaterThan(totalOwed)) {
          throw {
            _tag: "ValidationError",
            message: `Payment amount ${newAmount} exceeds total owed ${formatAmount(totalOwed)}`,
            field: "amount",
          };
        }

        // 4. Post new journals
        if (new BigNumber(allocation.interestPortion).isGreaterThan(0)) {
          await reverseInterestAccrual(tx, {
            loanId: payment.loanId,
            paymentDate: newPaymentDate.toISOString(),
            actorId,
          });
          await autoPostInterestEarned(tx, {
            amount: allocation.interestPortion,
            loanId: payment.loanId,
            paymentId: input.paymentId,
            paymentDate: newPaymentDate.toISOString(),
            actorId,
            depositLocation: payment.depositLocation ?? undefined,
          });
        }

        if (new BigNumber(allocation.principalPortion).isGreaterThan(0)) {
          await autoPostPrincipalRepayment(tx, {
            amount: allocation.principalPortion,
            loanId: payment.loanId,
            paymentId: input.paymentId,
            paymentDate: newPaymentDate.toISOString(),
            actorId,
            depositLocation: payment.depositLocation ?? undefined,
          });
        }

        // 5. Check fully-paid status (economic, not ledger-principal-only)
        if (
          await isLoanEconomicallyFullyPaid(
            payment.loanId,
            endOfDay(newPaymentDate),
            tx,
          )
        ) {
          await maybeUpdateLoanStatusAfterPayment(
            tx,
            loan,
            "fully_paid",
            actorId,
          );
        } else if (loan.status === "fully_paid") {
          await maybeUpdateLoanStatusAfterPayment(tx, loan, "active", actorId);
        }

        const [updatedPayment] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, input.paymentId));

        await writeAuditLog(tx, {
          actorId,
          action: "payment.update",
          entityType: "payment",
          entityId: input.paymentId,
          beforeValue,
          afterValue: { ...updatedPayment, reason: input.reason },
        });

        const txidRows = await tx.execute<{ txid: string }>(
          sql`SELECT pg_current_xact_id()::text as txid`,
        );
        const txid = Number(
          (txidRows as unknown as Array<{ txid: string }>)[0].txid,
        );
        return { payment: updatedPayment, txid };
      });
    },
    catch: (e: any) => {
      if (e?._tag === "PaymentNotFound")
        return new PaymentNotFound({ id: e.id });
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id });
      if (e?._tag === "ValidationError")
        return new ValidationError({ message: e.message, field: e.field });
      return new DatabaseError({ cause: e });
    },
  });

export const deletePayment = (
  input: DeletePaymentInput,
  actorId: string,
): Effect.Effect<
  Payment,
  PaymentNotFound | LoanNotFound | ValidationError | DatabaseError
> =>
  Effect.map(deletePaymentWithTxid(input, actorId), ({ payment }) => payment);

/**
 * Like deletePayment but also returns the Postgres transaction ID.
 * Required for Electric collections so the client can wait for the
 * specific transaction to appear in the shape stream before clearing
 * optimistic state.
 */
export const deletePaymentWithTxid = (
  input: DeletePaymentInput,
  actorId: string,
): Effect.Effect<
  { payment: Payment; txid: number },
  PaymentNotFound | LoanNotFound | ValidationError | DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [payment] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, input.paymentId));
        if (!payment || payment.deletedAt !== null)
          throw { _tag: "PaymentNotFound", id: input.paymentId };

        const [loan] = await tx
          .select()
          .from(loans)
          .where(eq(loans.id, payment.loanId))
          .for("update");
        if (!loan || loan.deletedAt)
          throw { _tag: "LoanNotFound", id: payment.loanId };
        assertLoanOperational(loan);

        // 1. Get portions from ledger before soft-deleting
        const portions = await getPaymentPortionsFromLedger(
          [input.paymentId],
          tx,
        );
        const portion = portions.get(input.paymentId);

        // 2. Soft-delete the payment
        const now = new Date();
        const softDeletedPayment = {
          ...payment,
          deletedAt: now,
          deletedBy: actorId,
          deleteReason: input.reason,
        };
        await tx
          .update(payments)
          .set({
            deletedAt: now,
            deletedBy: actorId,
            deleteReason: input.reason,
            updatedAt: now,
          })
          .where(eq(payments.id, input.paymentId));

        await writeAuditLog(tx, {
          actorId,
          action: "payment.delete",
          entityType: "payment",
          entityId: input.paymentId,
          beforeValue: payment,
          afterValue: softDeletedPayment,
        });

        // 3. Reverse journals using ledger-derived portions
        if (
          portion &&
          new BigNumber(portion.interestPortion).isGreaterThan(0)
        ) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Interest Earned", type: "revenue" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: portion.interestPortion,
            referenceType: "payment_reversal",
            referenceId: input.paymentId,
            description: `Reversal - payment ${input.paymentId} deleted: ${input.reason}`,
            transactionDate: new Date(payment.paymentDate),
            recordedBy: actorId,
            creditDepositLocation: payment.depositLocation ?? undefined,
            creditSubLocationId: payment.subLocationId ?? undefined,
            loanId: payment.loanId,
          });
        }

        if (
          portion &&
          new BigNumber(portion.principalPortion).isGreaterThan(0)
        ) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Loans Receivable", type: "asset" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: portion.principalPortion,
            referenceType: "payment_reversal",
            referenceId: input.paymentId,
            description: `Reversal - principal repayment ${input.paymentId} deleted: ${input.reason}`,
            transactionDate: new Date(payment.paymentDate),
            recordedBy: actorId,
            creditDepositLocation: payment.depositLocation ?? undefined,
            creditSubLocationId: payment.subLocationId ?? undefined,
            loanId: payment.loanId,
          });
        }

        // 4. Check loan status (economic fully paid, not ledger-principal-only)
        if (
          await isLoanEconomicallyFullyPaid(payment.loanId, new Date(), tx)
        ) {
          if (loan.status !== "fully_paid") {
            await maybeUpdateLoanStatusAfterPayment(
              tx,
              loan,
              "fully_paid",
              actorId,
            );
          }
        } else if (loan.status === "fully_paid") {
          await maybeUpdateLoanStatusAfterPayment(tx, loan, "active", actorId);
        }

        const [deletedRow] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, input.paymentId));

        const txidRows = await tx.execute<{ txid: string }>(
          sql`SELECT pg_current_xact_id()::text as txid`,
        );
        const txid = Number(
          (txidRows as unknown as Array<{ txid: string }>)[0].txid,
        );
        return { payment: deletedRow, txid };
      });
    },
    catch: (e: any) => {
      if (e?._tag === "PaymentNotFound")
        return new PaymentNotFound({ id: e.id });
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id });
      if (e?._tag === "ValidationError")
        return new ValidationError({ message: e.message, field: e.field });
      return new DatabaseError({ cause: e });
    },
  });

export const listPayments = (
  input: ListPaymentsInput,
): Effect.Effect<
  { rows: PaymentWithCustomer[]; total: number },
  DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      const page = input.page ?? 1;
      const pageSize = input.pageSize ?? 25;
      const offset = (page - 1) * pageSize;

      const conditions = [isNull(payments.deletedAt)];
      if (input.dateFrom)
        conditions.push(gte(payments.paymentDate, new Date(input.dateFrom)));
      if (input.dateTo)
        conditions.push(
          lte(payments.paymentDate, new Date(input.dateTo + "T23:59:59.999Z")),
        );
      if (input.amountMin)
        conditions.push(gte(payments.amount, input.amountMin));
      if (input.amountMax)
        conditions.push(lte(payments.amount, input.amountMax));
      if (input.customerName)
        conditions.push(
          ilike(
            customers.fullName,
            `%${escapeLikePattern(input.customerName)}%`,
          ),
        );

      const where = and(...conditions);

      const [rows, [{ value: total }]] = await Promise.all([
        db
          .select({
            id: payments.id,
            loanId: payments.loanId,
            customerId: loans.customerId,
            customerName: customers.fullName,
            paymentDate: payments.paymentDate,
            amount: payments.amount,
            recordedBy: payments.recordedBy,
            recorderName: user.name,
            depositLocation: payments.depositLocation,
            createdAt: payments.createdAt,
          })
          .from(payments)
          .innerJoin(loans, eq(payments.loanId, loans.id))
          .innerJoin(customers, eq(loans.customerId, customers.id))
          .leftJoin(user, eq(payments.recordedBy, user.id))
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
      ]);

      // Enrich with ledger-derived portions and per-payment running balances
      const paymentIds = rows.map((r) => r.id);
      const loanIds = [...new Set(rows.map((r) => r.loanId))];

      // Fetch portions for this page's payments
      const portions =
        paymentIds.length > 0
          ? await getPaymentPortionsFromLedger(paymentIds)
          : new Map<
              string,
              { interestPortion: string; principalPortion: string }
            >();

      // For each loan on this page, fetch ALL its active payments' portions
      // to compute correct per-payment running balances
      const loanPrincipalMap = new Map<string, string>();
      const loanRateMap = new Map<string, string>();
      const perPaymentBalance = new Map<string, string>();
      const perPaymentBalanceBefore = new Map<string, string>();

      if (loanIds.length > 0) {
        // Fetch loan principal amounts and interest rates
        const loanRows = await db
          .select({
            id: loans.id,
            principalAmount: loans.principalAmount,
            interestRate: loans.interestRate,
            interestRateOverride: loans.interestRateOverride,
          })
          .from(loans)
          .where(inArray(loans.id, loanIds));
        for (const l of loanRows) {
          loanPrincipalMap.set(l.id, l.principalAmount);
          loanRateMap.set(l.id, l.interestRateOverride ?? l.interestRate);
        }

        // For each loan, get all its active payments sorted by date to compute running balance
        for (const loanId of loanIds) {
          const loanPayments = await db
            .select({
              id: payments.id,
              paymentDate: payments.paymentDate,
              createdAt: payments.createdAt,
            })
            .from(payments)
            .where(
              and(
                eq(payments.loanId, loanId),
                isNull(payments.deletedAt),
                eq(payments.markedWrong, false),
              ),
            )
            .orderBy(asc(payments.paymentDate), asc(payments.createdAt));
          const allIds = loanPayments.map((p) => p.id);
          const allPortions =
            allIds.length > 0
              ? await getPaymentPortionsFromLedger(allIds)
              : new Map();
          let balance = new BigNumber(loanPrincipalMap.get(loanId) ?? "0");
          for (const p of loanPayments) {
            perPaymentBalanceBefore.set(p.id, balance.toFixed(0));
            const pp = allPortions.get(p.id);
            if (pp) balance = balance.minus(new BigNumber(pp.principalPortion));
            if (balance.isLessThan(0)) balance = new BigNumber(0);
            perPaymentBalance.set(p.id, balance.toFixed(0));
          }
        }
      }

      const enrichedRows: PaymentWithCustomer[] = rows.map((r) => {
        const portion = portions.get(r.id);
        const principalAfter = perPaymentBalance.get(r.id) ?? "0.00";
        const principalBefore =
          perPaymentBalanceBefore.get(r.id) ?? principalAfter;
        const rate = loanRateMap.get(r.loanId) ?? "0";
        // Outstanding = what the borrower owed before this payment (principal + one period interest)
        const periodInterestBefore = new BigNumber(
          principalBefore,
        ).multipliedBy(rate);
        return {
          ...r,
          recorderName: r.recorderName ?? "Officer",
          interestPortion: portion?.interestPortion ?? "0.00",
          principalPortion: portion?.principalPortion ?? "0.00",
          principalBalanceAfter: principalAfter,
          outstandingBalance: new BigNumber(principalBefore)
            .plus(periodInterestBefore)
            .toFixed(0),
        } as PaymentWithCustomer;
      });

      return { rows: enrichedRows, total: Number(total) };
    },
    catch: (e) => new DatabaseError({ cause: e }),
  });

export const getPaymentsForLoan = (
  loanId: string,
): Effect.Effect<Payment[], LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [loan] = await db.select().from(loans).where(eq(loans.id, loanId));
      if (!loan) throw { _tag: "LoanNotFound", id: loanId };

      return await db
        .select()
        .from(payments)
        .where(and(eq(payments.loanId, loanId), isNull(payments.deletedAt)))
        .orderBy(asc(payments.paymentDate), asc(payments.createdAt));
    },
    catch: (e: any) => {
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id });
      return new DatabaseError({ cause: e });
    },
  });

export const searchActiveLoans = (
  query: string,
): Effect.Effect<ActiveLoanSearchResult[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      if (!query || query.trim().length < 2) return [];
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
            ilike(customers.fullName, `%${escapeLikePattern(query.trim())}%`),
          ),
        )
        .limit(10);
      return rows;
    },
    catch: (e) => new DatabaseError({ cause: e }),
  });

export const getRecentlyCollectedLoans = (
  userId: string,
  limit: number = 5,
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
      `);
      return Array.from(rows).map((row) => ({
        loanId: row.loan_id as string,
        customerName: row.customer_name as string,
        paymentDate: new Date(row.payment_date as string),
      }));
    },
    catch: (e) => new DatabaseError({ cause: e }),
  });

/**
 * List all non-deleted payment rows from the `payments` table without joins.
 * Mirrors the data Electric was syncing for the paymentCollection.
 * Returns up to 2000 rows ordered by payment date descending.
 */
export const listAllPayments = (): Effect.Effect<Payment[], DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(payments)
        .where(isNull(payments.deletedAt))
        .orderBy(desc(payments.paymentDate), desc(payments.createdAt))
        .limit(2000),
    catch: (e) => new DatabaseError({ cause: e }),
  });

/** Loads a single non-deleted payment by id (used for ownership checks). */
export async function getActivePaymentById(
  paymentId: string,
): Promise<Payment | undefined> {
  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, paymentId), isNull(payments.deletedAt)));
  return payment;
}

/** Lists a loan's non-deleted, non-wrong payments ordered chronologically. */
export async function listActivePaymentsByLoan(
  loanId: string,
): Promise<Payment[]> {
  return db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.loanId, loanId),
        isNull(payments.deletedAt),
        eq(payments.markedWrong, false),
      ),
    )
    .orderBy(asc(payments.paymentDate), asc(payments.createdAt));
}

/** Uncapped payments for many loans (credit score — R17-2). */
export async function listPaymentsForLoanIds(
  loanIds: string[],
): Promise<Payment[]> {
  const unique = [...new Set(loanIds.filter(Boolean))];
  if (unique.length === 0) return [];
  return db
    .select()
    .from(payments)
    .where(
      and(
        inArray(payments.loanId, unique),
        isNull(payments.deletedAt),
        eq(payments.markedWrong, false),
      ),
    )
    .orderBy(asc(payments.paymentDate), asc(payments.createdAt));
}

/**
 * Marks a payment as wrong and reverses its ledger impact in a single
 * transaction. Throws `{ _tag: "PaymentNotFound" | "AlreadyMarkedWrong" }`.
 */
export async function markPaymentWrong(
  paymentId: string,
  reason: string,
  actorId: string,
): Promise<{ updated: Payment; txid: number }> {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), isNull(payments.deletedAt)));
    if (!payment) throw { _tag: "PaymentNotFound" };
    if (payment.markedWrong) throw { _tag: "AlreadyMarkedWrong" };

    const [loan] = await tx
      .select()
      .from(loans)
      .where(eq(loans.id, payment.loanId))
      .for("update");
    if (!loan || loan.deletedAt) throw { _tag: "LoanNotFound", id: payment.loanId };
    assertLoanOperational(loan);

    const [updatedPayment] = await tx
      .update(payments)
      .set({
        markedWrong: true,
        markedWrongReason: reason.trim(),
        markedWrongBy: actorId,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId))
      .returning();

    // Derive portions from ledger (not cached columns)
    const portions = await getPaymentPortionsFromLedger([paymentId], tx);
    const portion = portions.get(paymentId);

    // Reverse interest journal entry
    if (portion && new BigNumber(portion.interestPortion).isGreaterThan(0)) {
      await postJournalEntry(tx, {
        debitCategory: { name: "Interest Earned", type: "revenue" },
        creditCategory: { name: "Cash", type: "asset" },
        amount: portion.interestPortion,
        referenceType: "payment_reversal",
        referenceId: paymentId,
        description: `Reversal - payment ${paymentId} marked wrong: ${reason.trim()}`,
        transactionDate: new Date(payment.paymentDate),
        recordedBy: actorId,
        creditDepositLocation: payment.depositLocation ?? undefined,
        loanId: payment.loanId,
      });
    }

    // Reverse principal journal entry
    if (portion && new BigNumber(portion.principalPortion).isGreaterThan(0)) {
      await postJournalEntry(tx, {
        debitCategory: { name: "Loans Receivable", type: "asset" },
        creditCategory: { name: "Cash", type: "asset" },
        amount: portion.principalPortion,
        referenceType: "payment_reversal",
        referenceId: paymentId,
        description: `Reversal - principal repayment ${paymentId} marked wrong: ${reason.trim()}`,
        transactionDate: new Date(payment.paymentDate),
        recordedBy: actorId,
        creditDepositLocation: payment.depositLocation ?? undefined,
        loanId: payment.loanId,
      });
    }

    // Check if loan should revert from fully_paid to active
    if (
      loan.status === "fully_paid" &&
      !(await isLoanEconomicallyFullyPaid(payment.loanId, new Date(), tx))
    ) {
      await maybeUpdateLoanStatusAfterPayment(tx, loan, "active", actorId);
    }

    const txidRows = await tx.execute<{ txid: string }>(
      sql`SELECT pg_current_xact_id()::text as txid`,
    );
    const txid = Number(
      (txidRows as unknown as Array<{ txid: string }>)[0].txid,
    );
    return { updated: updatedPayment, txid };
  });
}

/**
 * Reverses a wrong-marking: clears the flag and re-posts the payment's
 * interest/principal ledger entries by recomputing the allocation from loan
 * state. Throws `{ _tag: "PaymentNotFound" | "LoanNotFound" | "NotMarkedWrong" }`.
 */
export async function unmarkPaymentWrong(
  paymentId: string,
  actorId: string,
): Promise<{ updated: Payment; txid: number }> {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), isNull(payments.deletedAt)));
    if (!payment) throw { _tag: "PaymentNotFound" };
    if (!payment.markedWrong) throw { _tag: "NotMarkedWrong" };

    const [loan] = await tx
      .select()
      .from(loans)
      .where(eq(loans.id, payment.loanId))
      .for("update");
    if (!loan || loan.deletedAt) throw { _tag: "LoanNotFound", id: payment.loanId };
    assertLoanOperational(loan);

    const [updatedPayment] = await tx
      .update(payments)
      .set({
        markedWrong: false,
        markedWrongReason: null,
        markedWrongBy: null,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId))
      .returning();

    // Get all active (non-deleted, non-wrong) payments ordered by date to find position
    const activePayments = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.loanId, payment.loanId),
          isNull(payments.deletedAt),
          eq(payments.markedWrong, false),
        ),
      )
      .orderBy(asc(payments.paymentDate), asc(payments.createdAt));

    const paymentIndex = activePayments.findIndex((p) => p.id === paymentId);
    const paymentDate = new Date(payment.paymentDate);
    const paymentNumber = paymentIndex + 1;

    const priorPaymentIds =
      paymentIndex > 0
        ? activePayments.slice(0, paymentIndex).map((p) => p.id)
        : [];
    const principalBalanceBefore = await reconstructPrincipalBalanceBefore({
      loanId: loan.id,
      originalPrincipal: loan.principalAmount,
      targetDate: paymentDate,
      priorPaymentIds,
      queryDb: tx,
    });

    const prevSettlementDate = await getPriorSettlementDate(
      loan,
      paymentDate,
      [paymentId],
      tx,
    );
    const interestAlreadyPaidInPeriod = await sumInterestAlreadyPaidInPeriod({
      loanId: loan.id,
      prevDate: prevSettlementDate,
      targetDate: paymentDate,
      excludePaymentId: paymentId,
      queryDb: tx,
    });

    const allocation = await allocateLoanPayment({
      paymentAmount: payment.amount,
      loanId: loan.id,
      asOf: endOfDay(paymentDate),
      interestAlreadyPaidInPeriod,
      principalBalanceBefore,
      paymentNumber,
      prevSettlementDate,
      queryDb: tx,
    });
    // Re-post interest earned journal entry
    if (new BigNumber(allocation.interestPortion).isGreaterThan(0)) {
      await reverseInterestAccrual(tx, {
        loanId: payment.loanId,
        paymentDate: payment.paymentDate.toISOString(),
        actorId,
      });
      await autoPostInterestEarned(tx, {
        amount: allocation.interestPortion,
        loanId: payment.loanId,
        paymentId,
        paymentDate: payment.paymentDate.toISOString(),
        actorId,
        depositLocation: payment.depositLocation ?? undefined,
      });
    }

    // Re-post principal repayment journal entry
    if (new BigNumber(allocation.principalPortion).isGreaterThan(0)) {
      await autoPostPrincipalRepayment(tx, {
        amount: allocation.principalPortion,
        loanId: payment.loanId,
        paymentId,
        paymentDate: payment.paymentDate.toISOString(),
        actorId,
        depositLocation: payment.depositLocation ?? undefined,
      });
    }

    // Check if loan should be marked fully_paid (economic, not allocator-only)
    if (
      (await isLoanEconomicallyFullyPaid(payment.loanId, endOfDay(paymentDate), tx)) &&
      loan.status !== "fully_paid"
    ) {
      await maybeUpdateLoanStatusAfterPayment(
        tx,
        loan,
        "fully_paid",
        actorId,
      );
    }

    const txidRows = await tx.execute<{ txid: string }>(
      sql`SELECT pg_current_xact_id()::text as txid`,
    );
    const txid = Number(
      (txidRows as unknown as Array<{ txid: string }>)[0].txid,
    );
    return { updated: updatedPayment, txid };
  });
}
