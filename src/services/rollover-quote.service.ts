import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { loans } from "@/lib/db/schema/loans";
import { payments } from "@/lib/db/schema/payments";
import { loanWaivers } from "@/lib/db/schema/loan-waivers";
import { rateChangeRequests } from "@/lib/db/schema/rate-change-requests";
import { auditLog } from "@/lib/db/schema/audit";
import { quoteRolloverCarry } from "@/lib/interest/rollover-carry";
import { reconstructRolloverRateHistory, ROLLOVER_RATE_AUDIT_ACTIONS } from
  "@/lib/interest/rollover-rate-history";
import {
  getLoanBalancesFromLedger,
  getPaymentPortionsFromLedger,
  getWaiverPortionsFromLedger,
} from "./ledger-queries.service";

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
    [loan.id], effectiveDate, queryDb,
  )).get(loan.id);
  if (!ledgerPrincipal || ledgerPrincipal.minus(quote.carriedPrincipal).abs().gte(1)) {
    throw new Error("Predecessor principal does not reconcile to the ledger");
  }
  return quote;
}
