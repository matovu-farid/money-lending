import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import BigNumber from "bignumber.js";
import { db } from "@/lib/db";
import { loans } from "@/lib/db/schema/loans";
import { payments } from "@/lib/db/schema/payments";
import { loanWaivers } from "@/lib/db/schema/loan-waivers";
import { rateChangeRequests } from "@/lib/db/schema/rate-change-requests";
import { auditLog } from "@/lib/db/schema/audit";
import { transactions } from "@/lib/db/schema/transactions";
import { transactionCategories } from "@/lib/db/schema/transaction-categories";
import {
  getPaymentPortionsFromLedger,
  getPaymentOverpaymentFromLedger,
  getWaiverPortionsFromLedger,
} from "./ledger-queries.service";
import {
  planRolloverCorrection,
  ROLLOVER_CORRECTION_POLICY_VERSION,
  type ChainLoan,
  type ChainSnapshot,
  type CorrectionPlan,
} from "@/lib/interest/rollover-correction";
import type { RolloverSourceJournal } from
  "@/lib/financial-corrections/rollover-verifier";
import { reconstructRolloverRateHistory, ROLLOVER_RATE_AUDIT_ACTIONS,
  type RolloverRateAudit } from "@/lib/interest/rollover-rate-history";

type LoanRow = typeof loans.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;
type WaiverRow = typeof loanWaivers.$inferSelect;
type RateRow = typeof rateChangeRequests.$inferSelect;
type JournalRow = {
  id?: string;
  loanId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  categoryName: string;
  type: "credit" | "debit";
  amount: string;
  journalGroupId: string | null;
  transactionDate?: Date;
  depositLocation?: string | null;
  subLocationId?: string | null;
};

function sumJournal(
  rows: JournalRow[],
  loanId: string,
  categoryName: string,
  type: "credit" | "debit",
  referenceType: string,
  referenceId?: string,
): BigNumber {
  return rows.reduce((total, row) =>
    row.loanId === loanId && row.categoryName === categoryName &&
    row.type === type && row.referenceType === referenceType &&
    (referenceId === undefined || row.referenceId === referenceId)
      ? total.plus(row.amount) : total,
  new BigNumber(0));
}

function netJournal(
  rows: JournalRow[], loanId: string, categoryName: string,
  referenceType: string, positiveType: "credit" | "debit", referenceId?: string,
): BigNumber {
  return sumJournal(rows, loanId, categoryName, positiveType, referenceType, referenceId)
    .minus(sumJournal(rows, loanId, categoryName,
      positiveType === "credit" ? "debit" : "credit", referenceType, referenceId));
}

function withinRounding(left: BigNumber, right: BigNumber): boolean {
  return left.minus(right).abs().lt(1);
}

function cashDisbursedInIssueGroups(rows: JournalRow[], loanId: string,
  source: string, subLocationId: string | null): { amount: BigNumber; wrongLocation: boolean } {
  const groupIds = new Set(rows.filter((row) => row.loanId === loanId &&
    row.referenceType === "loan" && row.referenceId === loanId &&
    row.categoryName === "Loans Receivable" && row.journalGroupId)
    .map((row) => row.journalGroupId));
  const cashRows = rows.filter((row) => row.journalGroupId &&
    groupIds.has(row.journalGroupId) && row.referenceType === "loan" &&
    row.referenceId === loanId && row.categoryName === "Cash");
  return {
    amount: cashRows.reduce((sum, row) => row.type === "credit"
      ? sum.plus(row.amount) : sum.minus(row.amount), new BigNumber(0)),
    wrongLocation: cashRows.some((row) => row.depositLocation !== source ||
      (row.subLocationId ?? null) !== subLocationId),
  };
}

function settlementCounterparty(rows: JournalRow[], referenceId: string,
  referenceTypes: string[], categoryName: string): BigNumber {
  return rows.reduce((total, row) =>
    row.referenceId === referenceId && referenceTypes.includes(row.referenceType ?? "") &&
    row.categoryName === categoryName
      ? row.type === "debit" ? total.plus(row.amount) : total.minus(row.amount)
      : total,
  new BigNumber(0));
}

/** Converts one consistent DB snapshot into complete, anonymized chains. */
export function assembleRolloverChains(input: {
  loans: LoanRow[];
  payments: PaymentRow[];
  waivers: WaiverRow[];
  rates: RateRow[];
  rateAudits?: Array<RolloverRateAudit & { entityId: string }>;
  journals: JournalRow[];
  paymentPortions: Map<string, { interestPortion: string; principalPortion: string }>;
  paymentOverpayments?: Map<string, string>;
  waiverPortions: Map<string, { interestPortion: string; principalPortion: string }>;
}): ChainSnapshot[] {
  const byId = new Map(input.loans.map((loan) => [loan.id, loan]));
  const successors = input.loans.filter((loan) => loan.rolledOverFrom);
  const predecessorIds = new Set(successors.map((loan) => loan.rolledOverFrom));
  const groupTotals = new Map<string, BigNumber>();
  for (const row of input.journals) {
    if (!row.journalGroupId) continue;
    const previous = groupTotals.get(row.journalGroupId) ?? new BigNumber(0);
    groupTotals.set(row.journalGroupId,
      row.type === "debit" ? previous.plus(row.amount) : previous.minus(row.amount));
  }
  const groups = new Map<string, Set<string>>();
  for (const successor of successors) {
    let root: LoanRow = successor;
    const seen = new Set<string>();
    while (root.rolledOverFrom && byId.has(root.rolledOverFrom) && !seen.has(root.id)) {
      seen.add(root.id);
      root = byId.get(root.rolledOverFrom)!;
    }
    const group = groups.get(root.id) ?? new Set<string>();
    group.add(root.id);
    group.add(successor.id);
    groups.set(root.id, group);
  }

  return [...groups.values()].map((ids) => ({
    loans: [...ids].map((id): ChainLoan => {
      const loan = byId.get(id)!;
      const loanPayments = input.payments.filter((p) => p.loanId === id);
      const waivers = input.waivers.filter((w) => w.loanId === id);
      const rateChanges = input.rates.filter((r) => r.loanId === id);
      const rateAudits = (input.rateAudits ?? []).filter((audit) => audit.entityId === id);
      const rateHistory = reconstructRolloverRateHistory({
        loan,
        approvedRequests: rateChanges,
        audits: rateAudits,
      });
      const sourceExceptions: string[] = [];
      sourceExceptions.push(...rateHistory.exceptions);
      const activePaymentIds = new Set(loanPayments.map((payment) => payment.id));
      const activeWaiverIds = new Set(waivers.map((waiver) => waiver.id));
      const directRows = input.journals.filter((row) => row.loanId === id);

      const orphanPaymentIds = new Set(directRows
        .filter((row) => ["payment", "payment_reversal"].includes(row.referenceType ?? "") &&
          !activePaymentIds.has(row.referenceId ?? ""))
        .map((row) => row.referenceId));
      for (const referenceId of orphanPaymentIds) {
        if (!referenceId || ["Cash", "Interest Earned", "Loans Receivable", "Overpayment Revenue"]
          .some((category) => settlementCounterparty(directRows, referenceId,
            ["payment", "payment_reversal"], category).abs().gte(0.01))) {
          sourceExceptions.push(`Orphan payment ${referenceId ?? "unknown"} journal has an unsettled balance`);
        }
      }
      const orphanWaiverIds = new Set(directRows
        .filter((row) => ["loan_waiver", "loan_waiver_reversal"].includes(row.referenceType ?? "") &&
          !activeWaiverIds.has(row.referenceId ?? ""))
        .map((row) => row.referenceId));
      for (const referenceId of orphanWaiverIds) {
        if (!referenceId || ["Loan Losses", "Interest Earned", "Loans Receivable"]
          .some((category) => settlementCounterparty(directRows, referenceId,
            ["loan_waiver", "loan_waiver_reversal"], category).abs().gte(0.01))) {
          sourceExceptions.push(`Orphan waiver ${referenceId ?? "unknown"} journal has an unsettled balance`);
        }
      }

      for (const row of directRows) {
        if (!row.journalGroupId ||
            (groupTotals.get(row.journalGroupId) ?? new BigNumber(0)).abs().gte(0.01)) {
          sourceExceptions.push("Journal group is missing or unbalanced");
          break;
        }
      }

      for (const payment of loanPayments) {
        const allocation = input.paymentPortions.get(payment.id);
        if (!allocation) {
          sourceExceptions.push(`Missing payment allocation ${payment.id}`);
        } else if (new BigNumber(allocation.interestPortion)
          .plus(allocation.principalPortion)
          .plus(input.paymentOverpayments?.get(payment.id) ?? "0")
          .minus(payment.amount).abs().gte(0.01)) {
          sourceExceptions.push(`Payment ${payment.id} amount ${payment.amount} has an unallocated amount ` +
            `(interest ${allocation.interestPortion}, principal ${allocation.principalPortion}, ` +
            `overpayment ${input.paymentOverpayments?.get(payment.id) ?? "0"})`);
        }
        const cashReceived = settlementCounterparty(input.journals, payment.id,
          ["payment", "payment_reversal"], "Cash");
        if (cashReceived.minus(payment.amount).abs().gte(0.01)) {
          sourceExceptions.push(`Payment ${payment.id} has no matching cash receipt`);
        }
      }
      for (const waiver of waivers) {
        const allocation = input.waiverPortions.get(waiver.id);
        if (!allocation) {
          sourceExceptions.push(`Missing waiver allocation ${waiver.id}`);
        } else if (new BigNumber(allocation.interestPortion)
          .plus(allocation.principalPortion).minus(waiver.amount).abs().gte(0.01)) {
          sourceExceptions.push(`Waiver ${waiver.id} amount ${waiver.amount} has an unallocated amount ` +
            `(interest ${allocation.interestPortion}, principal ${allocation.principalPortion})`);
        }
        const loanLoss = settlementCounterparty(input.journals, waiver.id,
          ["loan_waiver"], "Loan Losses");
        if (loanLoss.minus(waiver.amount).abs().gte(0.01)) {
          sourceExceptions.push(`Waiver ${waiver.id} has no matching loan loss journal`);
        }
      }
      if (rateChanges.some((rate) => !rate.reviewedAt)) {
        sourceExceptions.push("Approved rate change lacks review date");
      }
      const reviewedDates = rateChanges.filter((rate) => rate.reviewedAt)
        .map((rate) => rate.reviewedAt!.getTime());
      if (new Set(reviewedDates).size !== reviewedDates.length) {
        sourceExceptions.push("Approved rate changes have an ambiguous same-day order");
      }
      if (loan.rolledOverFrom) {
        const predecessor = byId.get(loan.rolledOverFrom);
        if (!predecessor || predecessor.customerId !== loan.customerId) {
          sourceExceptions.push("Rollover predecessor is missing or belongs to another customer");
        }
        const carried = new BigNumber(loan.rolloverAmount ?? "0");
        const freshCash = new BigNumber(loan.principalAmount).minus(carried);
        const disbursed = netJournal(input.journals, id,
          "Loans Receivable", "loan", "debit", id);
        if (!withinRounding(disbursed, freshCash)) {
          sourceExceptions.push("Fresh disbursement does not reconcile to successor principal");
        }
        const cashDisbursement = cashDisbursedInIssueGroups(input.journals, id,
          loan.disbursementSource, loan.subLocationId ?? null);
        if (!withinRounding(cashDisbursement.amount, freshCash) ||
            cashDisbursement.wrongLocation) {
          sourceExceptions.push("Fresh cash disbursement does not reconcile to its source location");
        }
        const receivable = netJournal(input.journals, id, "Loans Receivable", "rollover", "debit", loan.rolledOverFrom);
        const interest = netJournal(input.journals, id, "Interest Earned", "rollover", "credit", loan.rolledOverFrom);
        const principal = netJournal(input.journals, loan.rolledOverFrom, "Loans Receivable", "rollover", "credit", id);
        if (!withinRounding(receivable, carried) ||
            !withinRounding(interest.plus(principal), carried)) {
          sourceExceptions.push("Recorded rollover does not reconcile to original journal");
        }
      } else {
        const opening = netJournal(input.journals, id, "Loans Receivable", "loan", "debit", id);
        if (!withinRounding(opening, new BigNumber(loan.principalAmount))) {
          sourceExceptions.push("Original principal does not reconcile to disbursement journal");
        }
      }
      const receivableBalance = input.journals.reduce((balance, row) =>
        row.loanId === id && row.categoryName === "Loans Receivable"
          ? row.type === "debit" ? balance.plus(row.amount) : balance.minus(row.amount)
          : balance,
      new BigNumber(0));
      const expectedReceivable = predecessorIds.has(id)
        ? new BigNumber(0)
        : new BigNumber(loan.principalAmount)
          .minus(loanPayments.reduce((sum, payment) => sum.plus(
            input.paymentPortions.get(payment.id)?.principalPortion ?? "0"), new BigNumber(0)))
          .minus(waivers.reduce((sum, waiver) => sum.plus(
            input.waiverPortions.get(waiver.id)?.principalPortion ?? "0"), new BigNumber(0)));
      if (!withinRounding(receivableBalance, expectedReceivable)) {
        sourceExceptions.push("Loans receivable does not reconcile to principal and settlements");
      }
      const relevantGroupIds = new Set(input.journals
        .filter((row) => row.loanId === id && row.journalGroupId)
        .map((row) => row.journalGroupId));
      const sourceRows = input.journals.filter((row) => row.loanId === id ||
        (row.journalGroupId && relevantGroupIds.has(row.journalGroupId)));

      return {
        id: loan.id,
        principalAmount: loan.principalAmount,
        rolloverAmount: loan.rolloverAmount,
        rolledOverFrom: loan.rolledOverFrom,
        interestRate: rateHistory.initialRate,
        interestRateOverride: null,
        penaltyMultiplier: loan.penaltyMultiplier,
        penaltyWaived: loan.penaltyWaived,
        penaltyWaivedAt: loan.penaltyWaivedAt,
        penaltyWaivedBy: loan.penaltyWaivedBy,
        minInterestDays: loan.minInterestDays,
        minPeriodOverride: loan.minPeriodOverride,
        issuanceFee: loan.issuanceFee,
        disbursementSource: loan.disbursementSource,
        subLocationId: loan.subLocationId,
        loanType: loan.loanType,
        startDate: loan.startDate,
        createdAt: loan.createdAt,
        status: loan.status,
        deletedAt: loan.deletedAt,
        sourceExceptions,
        sourceDigest: createHash("sha256").update(JSON.stringify({
          journals: sourceRows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
          payments: loanPayments.toSorted((a, b) => a.id.localeCompare(b.id)),
          waivers: waivers.toSorted((a, b) => a.id.localeCompare(b.id)),
          rateChanges: rateChanges.toSorted((a, b) => a.id.localeCompare(b.id)),
          rateAudits: rateAudits.toSorted((a, b) => a.id.localeCompare(b.id)),
        })).digest("hex"),
        payments: loanPayments.map((payment) => ({
          id: payment.id,
          paymentDate: payment.paymentDate,
          amount: payment.amount,
          interestPortion: input.paymentPortions.get(payment.id)?.interestPortion ?? "0",
          principalPortion: input.paymentPortions.get(payment.id)?.principalPortion ?? "0",
          overpaymentPortion: input.paymentOverpayments?.get(payment.id) ?? "0",
          depositLocation: payment.depositLocation,
          subLocationId: payment.subLocationId,
          recorderName: "",
        })),
        waivers: waivers.map((waiver) => ({
          id: waiver.id,
          waiverDate: waiver.waiverDate,
          amount: waiver.amount,
          interestPortion: input.waiverPortions.get(waiver.id)?.interestPortion ?? "0",
          principalPortion: input.waiverPortions.get(waiver.id)?.principalPortion ?? "0",
          reason: waiver.reason,
        })),
        rateChanges: rateHistory.changes,
      };
    }),
  }));
}

/** Every query runs inside one repeatable, read-only PostgreSQL transaction. */
export async function loadRolloverCorrectionPlansInSnapshot(
  queryDb: Pick<typeof db, "select">,
  policyVersion = ROLLOVER_CORRECTION_POLICY_VERSION,
): Promise<{
  plans: CorrectionPlan[];
  chains: ChainSnapshot[];
  sourceJournals: RolloverSourceJournal[];
  liveLinks: number;
  deletedLinks: number;
}> {
    const loanRows = await queryDb.select().from(loans);
    const relevant = new Set<string>();
    const byId = new Map(loanRows.map((loan) => [loan.id, loan]));
    for (const loan of loanRows) {
      if (!loan.rolledOverFrom) continue;
      relevant.add(loan.id);
      let predecessor: string | null = loan.rolledOverFrom;
      while (predecessor && !relevant.has(predecessor)) {
        relevant.add(predecessor);
        predecessor = byId.get(predecessor)?.rolledOverFrom ?? null;
      }
    }
    const loanIds = [...relevant];
    if (!loanIds.length) return { plans: [], chains: [], sourceJournals: [],
      liveLinks: 0, deletedLinks: 0 };
    const [paymentRows, waiverRows, rateRows, rateAudits, journalRows] = await Promise.all([
      queryDb.select().from(payments).where(and(inArray(payments.loanId, loanIds), isNull(payments.deletedAt), eq(payments.markedWrong, false))),
      queryDb.select().from(loanWaivers).where(and(inArray(loanWaivers.loanId, loanIds), isNull(loanWaivers.deletedAt))),
      queryDb.select().from(rateChangeRequests).where(and(inArray(rateChangeRequests.loanId, loanIds), eq(rateChangeRequests.status, "approved"))),
      queryDb.select({
        id: auditLog.id,
        entityId: auditLog.entityId,
        action: auditLog.action,
        occurredAt: auditLog.occurredAt,
        beforeValue: auditLog.beforeValue,
        afterValue: auditLog.afterValue,
      }).from(auditLog).where(and(
        eq(auditLog.entityType, "loan"),
        inArray(auditLog.entityId, loanIds),
        inArray(auditLog.action, ROLLOVER_RATE_AUDIT_ACTIONS),
      )),
      queryDb.select({
        id: transactions.id,
        loanId: transactions.loanId,
        referenceType: transactions.referenceType,
        referenceId: transactions.referenceId,
        categoryName: transactionCategories.name,
        type: transactions.type,
        amount: transactions.amount,
        journalGroupId: transactions.journalGroupId,
        transactionDate: transactions.transactionDate,
        depositLocation: transactions.depositLocation,
        subLocationId: transactions.subLocationId,
      }).from(transactions).innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
        .where(inArray(transactions.loanId, loanIds)),
    ]);
    const groupIds = [...new Set(journalRows.map((row) => row.journalGroupId)
      .filter((id): id is string => !!id))];
    const completeJournalRows = groupIds.length ? await queryDb.select({
      id: transactions.id,
      loanId: transactions.loanId,
      referenceType: transactions.referenceType,
      referenceId: transactions.referenceId,
      categoryName: transactionCategories.name,
      type: transactions.type,
      amount: transactions.amount,
      journalGroupId: transactions.journalGroupId,
      transactionDate: transactions.transactionDate,
      depositLocation: transactions.depositLocation,
      subLocationId: transactions.subLocationId,
    }).from(transactions).innerJoin(transactionCategories,
      eq(transactions.categoryId, transactionCategories.id))
      .where(inArray(transactions.journalGroupId, groupIds)) : [];
    const [paymentPortions, paymentOverpayments, waiverPortions] = await Promise.all([
      getPaymentPortionsFromLedger(paymentRows.map((p) => p.id), queryDb),
      getPaymentOverpaymentFromLedger(paymentRows.map((p) => p.id), queryDb),
      getWaiverPortionsFromLedger(waiverRows.map((w) => w.id), queryDb),
    ]);
    const sourceJournals = completeJournalRows.concat(
      journalRows.filter((row) => !row.journalGroupId));
    const chains = assembleRolloverChains({
      loans: loanRows.filter((loan) => relevant.has(loan.id)),
      payments: paymentRows,
      waivers: waiverRows,
      rates: rateRows,
      rateAudits,
      journals: sourceJournals,
      paymentPortions,
      paymentOverpayments,
      waiverPortions,
    });
    const plans = chains.map((chain) => planRolloverCorrection(chain, policyVersion));
    return {
      plans,
      chains,
      sourceJournals,
      liveLinks: loanRows.filter((loan) => loan.rolledOverFrom && !loan.deletedAt).length,
      deletedLinks: loanRows.filter((loan) => loan.rolledOverFrom && loan.deletedAt).length,
    };
}

export async function loadRolloverCorrectionPlans(
  policyVersion = ROLLOVER_CORRECTION_POLICY_VERSION) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    return loadRolloverCorrectionPlansInSnapshot(tx, policyVersion);
  });
}
