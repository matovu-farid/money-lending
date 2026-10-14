import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { loans } from "@/lib/db/schema/loans";
import { payments } from "@/lib/db/schema/payments";
import { loanWaivers } from "@/lib/db/schema/loan-waivers";
import { rateChangeRequests } from "@/lib/db/schema/rate-change-requests";
import { auditLog } from "@/lib/db/schema/audit";
import { transactions } from "@/lib/db/schema/transactions";
import { transactionCategories } from "@/lib/db/schema/transaction-categories";
import { quoteRolloverCarry } from "@/lib/interest/rollover-carry";
import { rolloverPaymentCutoff } from "@/lib/interest/rollover-payment-boundary";
import { reconstructRolloverRateHistory, ROLLOVER_RATE_AUDIT_ACTIONS } from
  "@/lib/interest/rollover-rate-history";
import {
  getLoanBalancesFromLedger,
  getPaymentOverpaymentFromLedger,
  getPaymentPortionsFromLedger,
  getWaiverPortionsFromLedger,
} from "./ledger-queries.service";
import BigNumber from "bignumber.js";

type QueryDb = Pick<typeof db, "select">;
type LoanRow = typeof loans.$inferSelect;

/** Read-only preview; loan creation requotes under the predecessor row lock. */
export async function getActiveRolloverQuote(customerId: string, effectiveDate: Date) {
  const [loan] = await db.select().from(loans).where(and(
    eq(loans.customerId, customerId),
    eq(loans.status, "active"),
    isNull(loans.deletedAt),
  ));
  if (!loan) throw new Error("Customer has no active loan to roll over");
  return { fromLoanId: loan.id, ...await quoteRecordedRollover(db, loan, effectiveDate) };
}

/** Load and quote all recorded predecessor events in the caller's transaction. */
export async function quoteRecordedRollover(
  queryDb: QueryDb,
  loan: LoanRow,
  effectiveDate: Date,
): Promise<{ carriedPrincipal: string; carriedInterest: string }> {
  const existingSuccessors = await queryDb.select({ id: loans.id }).from(loans)
    .where(eq(loans.rolledOverFrom, loan.id));
  if (existingSuccessors.length) {
    throw new Error("Predecessor already has a recorded rollover");
  }
  const rolloverCredits = await queryDb.select({
    loanId: transactions.loanId,
    referenceId: transactions.referenceId,
    journalGroupId: transactions.journalGroupId,
    transactionDate: transactions.transactionDate,
    amount: transactions.amount,
    description: transactions.description,
    recordedBy: transactions.recordedBy,
  })
    .from(transactions).innerJoin(transactionCategories,
      eq(transactions.categoryId, transactionCategories.id))
    .where(and(eq(transactions.loanId, loan.id),
      eq(transactions.referenceType, "rollover"), eq(transactions.type, "credit"),
      eq(transactionCategories.name, "Loans Receivable")));
  if (rolloverCredits.some((row) => !loan.rolledOverFrom ||
      row.referenceId !== loan.rolledOverFrom || !row.journalGroupId ||
      row.transactionDate.getTime() !== loan.startDate.getTime() ||
      !row.description?.startsWith("Non-cash rollover correction "))) {
    throw new Error("Predecessor already has an outgoing rollover journal");
  }
  if (rolloverCredits.length) {
    const groups = await queryDb.select({
      loanId: transactions.loanId,
      referenceType: transactions.referenceType,
      referenceId: transactions.referenceId,
      journalGroupId: transactions.journalGroupId,
      transactionDate: transactions.transactionDate,
      categoryName: transactionCategories.name,
      type: transactions.type,
      amount: transactions.amount,
      description: transactions.description,
      recordedBy: transactions.recordedBy,
    }).from(transactions).innerJoin(transactionCategories,
      eq(transactions.categoryId, transactionCategories.id))
      .where(inArray(transactions.journalGroupId,
        rolloverCredits.map((row) => row.journalGroupId!)));
    for (const credit of rolloverCredits) {
      const pair = groups.filter((row) => row.journalGroupId === credit.journalGroupId);
      const counterpart = pair.find((row) => row.type === "debit");
      if (pair.length !== 2 || !counterpart ||
          counterpart.amount !== credit.amount ||
          counterpart.transactionDate.getTime() !== credit.transactionDate.getTime() ||
          counterpart.referenceType !== "rollover" ||
          counterpart.description !== credit.description ||
          counterpart.recordedBy !== credit.recordedBy ||
          !(counterpart.loanId === loan.id &&
              counterpart.referenceId === loan.rolledOverFrom &&
              counterpart.categoryName === "Interest Earned" ||
            counterpart.loanId === loan.rolledOverFrom &&
              counterpart.referenceId === loan.id &&
              counterpart.categoryName === "Loans Receivable")) {
        throw new Error("Predecessor already has an outgoing rollover journal");
      }
    }
  }
  const [loanPayments, waivers, approvedRateChanges, rateAudits] = await Promise.all([
    queryDb.select().from(payments).where(and(
      eq(payments.loanId, loan.id),
      isNull(payments.deletedAt),
      eq(payments.markedWrong, false),
    )).orderBy(asc(payments.paymentDate), asc(payments.createdAt)),
    queryDb.select().from(loanWaivers).where(and(
      eq(loanWaivers.loanId, loan.id),
      isNull(loanWaivers.deletedAt),
    )).orderBy(asc(loanWaivers.waiverDate)),
    queryDb.select().from(rateChangeRequests).where(and(
      eq(rateChangeRequests.loanId, loan.id),
      eq(rateChangeRequests.status, "approved"),
    )).orderBy(asc(rateChangeRequests.reviewedAt)),
    queryDb.select({
      id: auditLog.id,
      action: auditLog.action,
      occurredAt: auditLog.occurredAt,
      beforeValue: auditLog.beforeValue,
      afterValue: auditLog.afterValue,
    }).from(auditLog).where(and(
      eq(auditLog.entityType, "loan"),
      eq(auditLog.entityId, loan.id),
      inArray(auditLog.action, ROLLOVER_RATE_AUDIT_ACTIONS),
    )).orderBy(asc(auditLog.occurredAt), asc(auditLog.id)),
  ]);

  const [paymentPortions, waiverPortions] = await Promise.all([
    getPaymentPortionsFromLedger(loanPayments.map((p) => p.id), queryDb),
    getWaiverPortionsFromLedger(waivers.map((w) => w.id), queryDb),
  ]);
  if (loanPayments.some((p) => !paymentPortions.has(p.id)) ||
      waivers.some((w) => !waiverPortions.has(w.id))) {
    throw new Error("Predecessor settlement has no complete ledger allocation");
  }
  const paymentCutoff = rolloverPaymentCutoff(loan.startDate, effectiveDate);
  const sameDayPayments = loanPayments.filter((payment) =>
    payment.paymentDate >= effectiveDate && payment.paymentDate <= paymentCutoff);
  if (sameDayPayments.length) {
    const ids = sameDayPayments.map((payment) => payment.id);
    const [journalRows, overpayments] = await Promise.all([
      queryDb.select({
        loanId: transactions.loanId,
        referenceId: transactions.referenceId,
        transactionDate: transactions.transactionDate,
        categoryName: transactionCategories.name,
        type: transactions.type,
        amount: transactions.amount,
      }).from(transactions).innerJoin(transactionCategories,
        eq(transactions.categoryId, transactionCategories.id))
        .where(and(inArray(transactions.referenceId, ids),
          inArray(transactions.referenceType, ["payment", "payment_reversal"]))),
      getPaymentOverpaymentFromLedger(ids, queryDb),
    ]);
    for (const payment of sameDayPayments) {
      const rows = journalRows.filter((row) => row.referenceId === payment.id);
      if (!rows.length || rows.some((row) => row.loanId !== loan.id ||
          row.transactionDate.getTime() !== payment.paymentDate.getTime())) {
        throw new Error("Same-day payment journal does not belong to the predecessor at the recorded date");
      }
      const cashReceived = rows.filter((row) => row.categoryName === "Cash")
        .reduce((sum, row) => row.type === "debit"
          ? sum.plus(row.amount) : sum.minus(row.amount), new BigNumber(0));
      const allocation = paymentPortions.get(payment.id)!;
      const allocated = new BigNumber(allocation.interestPortion)
        .plus(allocation.principalPortion)
        .plus(overpayments.get(payment.id) ?? "0");
      if (cashReceived.minus(payment.amount).abs().gte(0.01) ||
          allocated.minus(payment.amount).abs().gte(0.01)) {
        throw new Error("Same-day predecessor payment journal does not reconcile to its receipt");
      }
    }
  }
  const rateHistory = reconstructRolloverRateHistory({
    loan,
    approvedRequests: approvedRateChanges,
    audits: rateAudits,
  });
  if (rateHistory.exceptions.length) {
    throw new Error(`Predecessor rate history needs review: ${rateHistory.exceptions.join("; ")}`);
  }

  const quote = quoteRolloverCarry({
    loan: {
      id: loan.id,
      principalAmount: loan.principalAmount,
      interestRate: rateHistory.initialRate,
      interestRateOverride: null,
      penaltyMultiplier: loan.penaltyMultiplier,
      penaltyWaived: loan.penaltyWaived,
      penaltyWaivedAt: loan.penaltyWaivedAt,
      penaltyWaivedBy: loan.penaltyWaivedBy,
      minInterestDays: loan.minInterestDays,
      minPeriodOverride: loan.minPeriodOverride,
      rolledOverFrom: loan.rolledOverFrom,
      issuanceFee: loan.issuanceFee,
      loanType: loan.loanType,
      startDate: loan.startDate,
      createdAt: loan.createdAt,
    },
    asOf: effectiveDate,
    payments: loanPayments.map((payment) => ({
      paymentDate: payment.paymentDate,
      amount: payment.amount,
      interestPortion: paymentPortions.get(payment.id)!.interestPortion,
      principalPortion: paymentPortions.get(payment.id)!.principalPortion,
      recorderName: "",
    })),
    waivers: waivers.map((waiver) => ({
      waiverDate: waiver.waiverDate,
      amount: waiver.amount,
      interestPortion: waiverPortions.get(waiver.id)!.interestPortion,
      principalPortion: waiverPortions.get(waiver.id)!.principalPortion,
      reason: waiver.reason,
    })),
    rateChanges: rateHistory.changes,
  });

  const ledgerPrincipal = (await getLoanBalancesFromLedger(
    [loan.id], paymentCutoff, queryDb,
  )).get(loan.id);
  if (!ledgerPrincipal || ledgerPrincipal.minus(quote.carriedPrincipal).abs().gte(1)) {
    throw new Error("Predecessor principal does not reconcile to the ledger");
  }
  return quote;
}
