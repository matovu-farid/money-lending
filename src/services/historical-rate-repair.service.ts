import { createHash } from "node:crypto";
import BigNumber from "bignumber.js";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { loans } from "@/lib/db/schema/loans";
import { payments } from "@/lib/db/schema/payments";
import { loanWaivers } from "@/lib/db/schema/loan-waivers";
import { rateChangeRequests } from "@/lib/db/schema/rate-change-requests";
import { auditLog } from "@/lib/db/schema/audit";
import { transactions } from "@/lib/db/schema/transactions";
import { transactionCategories } from "@/lib/db/schema/transaction-categories";
import { planHistoricalRateRepair, type HistoricalRatePlan,
  type HistoricalRateSnapshot } from "@/lib/interest/historical-rate-repair";
import { ROLLOVER_RATE_AUDIT_ACTIONS } from "@/lib/interest/rollover-rate-history";
import { getPaymentPortionsFromLedger, getPaymentOverpaymentFromLedger,
  getWaiverPortionsFromLedger } from "./ledger-queries.service";

type QueryDb = Pick<typeof db, "select">;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function net(rows: Array<{ amount: string; type: "debit" | "credit" }>,
  positive: "debit" | "credit"): BigNumber {
  return rows.reduce((total, row) =>
    row.type === positive ? total.plus(row.amount) : total.minus(row.amount),
  new BigNumber(0));
}

function parseAudit(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function rateFromAudit(value: Record<string, unknown> | null): BigNumber | null {
  const raw = value?.interestRateOverride ?? value?.interestRate;
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const rate = new BigNumber(raw);
  return rate.isFinite() && rate.gt(0) && rate.lt(1) ? rate : null;
}

function sameMoney(a: BigNumber, b: string): boolean {
  return a.minus(b).abs().lt(0.01);
}

/** Load one complete, fingerprinted loan snapshot without writing to the database. */
export async function loadHistoricalRateRepairPlanInSnapshot(
  queryDb: QueryDb,
  loanId: string,
  asOf: Date,
  policyVersion = "v1",
): Promise<HistoricalRatePlan> {
  const [loan] = await queryDb.select().from(loans).where(eq(loans.id, loanId));
  if (!loan) throw new Error("Historical rate repair loan not found");

  const [paymentRows, waiverRows, rateRows, rateAudits, successorRows] = await Promise.all([
    queryDb.select().from(payments).where(eq(payments.loanId, loanId)),
    queryDb.select().from(loanWaivers).where(eq(loanWaivers.loanId, loanId)),
    queryDb.select().from(rateChangeRequests).where(eq(rateChangeRequests.loanId, loanId)),
    queryDb.select().from(auditLog).where(and(eq(auditLog.entityType, "loan"),
      eq(auditLog.entityId, loanId),
      inArray(auditLog.action, ROLLOVER_RATE_AUDIT_ACTIONS))),
    queryDb.select().from(loans).where(eq(loans.rolledOverFrom, loanId)),
  ]);
  const linkedRows = loan.rolledOverFrom
    ? await queryDb.select().from(loans).where(eq(loans.id, loan.rolledOverFrom)) : [];
  const activePayments = paymentRows.filter((row) => !row.deletedAt && !row.markedWrong);
  const activeWaivers = waiverRows.filter((row) => !row.deletedAt);
  const settlementIds = [...paymentRows.map((row) => row.id),
    ...waiverRows.map((row) => row.id)];
  const directJournalRows = await queryDb.select({
    id: transactions.id,
    loanId: transactions.loanId,
    referenceType: transactions.referenceType,
    referenceId: transactions.referenceId,
    journalGroupId: transactions.journalGroupId,
    transactionDate: transactions.transactionDate,
    depositLocation: transactions.depositLocation,
    subLocationId: transactions.subLocationId,
    amount: transactions.amount,
    type: transactions.type,
    categoryId: transactions.categoryId,
    categoryName: transactionCategories.name,
    categoryType: transactionCategories.type,
  }).from(transactions)
    .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
    .where(settlementIds.length
      ? or(eq(transactions.loanId, loanId), inArray(transactions.referenceId, settlementIds))
      : eq(transactions.loanId, loanId));
  const groupIds = [...new Set(directJournalRows.map((row) => row.journalGroupId)
    .filter((id): id is string => !!id))];
  const groupRows = groupIds.length ? await queryDb.select({
    id: transactions.id,
    loanId: transactions.loanId,
    referenceType: transactions.referenceType,
    referenceId: transactions.referenceId,
    journalGroupId: transactions.journalGroupId,
    transactionDate: transactions.transactionDate,
    depositLocation: transactions.depositLocation,
    subLocationId: transactions.subLocationId,
    amount: transactions.amount,
    type: transactions.type,
    categoryId: transactions.categoryId,
    categoryName: transactionCategories.name,
    categoryType: transactionCategories.type,
  }).from(transactions)
    .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
    .where(inArray(transactions.journalGroupId, groupIds)) : [];
  const journalRows = [...new Map([...directJournalRows, ...groupRows]
    .map((row) => [row.id, row])).values()];
  const [paymentPortions, paymentOverpayments, waiverPortions] = await Promise.all([
    getPaymentPortionsFromLedger(activePayments.map((row) => row.id), queryDb),
    getPaymentOverpaymentFromLedger(activePayments.map((row) => row.id), queryDb),
    getWaiverPortionsFromLedger(activeWaivers.map((row) => row.id), queryDb),
  ]);

  const exceptions: string[] = [];
  const requiredTypes = new Map([
    ["Cash", "asset"], ["Loans Receivable", "asset"],
    ["Interest Receivable", "revenue"], ["Interest Earned", "revenue"],
    ["Overpayment Revenue", "revenue"], ["Loan Losses", "expense"],
    ["Issuance Fees", "revenue"],
  ]);
  for (const row of journalRows) {
    const expected = requiredTypes.get(row.categoryName);
    if (expected && row.categoryType !== expected) {
      exceptions.push(`Journal ${row.id} category type does not match ${row.categoryName}`);
    }
  }
  const relevantCategoryRows = await queryDb.select().from(transactionCategories)
    .where(inArray(transactionCategories.name, [...requiredTypes.keys()]));
  for (const [name, expected] of requiredTypes) {
    const rows = relevantCategoryRows.filter((row) => row.name === name);
    if (rows.some((row) => row.type !== expected) || rows.length > 1) {
      exceptions.push(`Account category type or identity is ambiguous for ${name}`);
    }
  }
  if (loan.deletedAt) exceptions.push("Loan is deleted");
  if (loan.rolledOverFrom || successorRows.length) {
    exceptions.push("Loan is part of a rollover chain; chain-level repair is required");
  }
  const orderedAudits = rateAudits.toSorted((a, b) =>
    a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
  const appliedAudits = orderedAudits.filter((row) => row.action !== "loan.update");
  const finalAudit = appliedAudits.at(-1);
  const finalAuditValue = parseAudit(finalAudit?.afterValue ?? null);
  const currentRate = new BigNumber(loan.interestRateOverride ?? loan.interestRate);
  const auditRate = rateFromAudit(finalAuditValue);
  if (!currentRate.isFinite() || currentRate.lte(0) || currentRate.gte(1) ||
      !finalAudit || !auditRate?.isFinite() || !auditRate.eq(currentRate)) {
    exceptions.push("Final applied rate audit does not reconcile to the loan rate");
  }
  let priorRate = new BigNumber(loan.interestRate);
  const approvedRequests = new Map(rateRows.filter((row) => row.status === "approved")
    .map((row) => [row.id, row]));
  const matchedRequests = new Set<string>();
  for (const row of appliedAudits) {
    const before = rateFromAudit(parseAudit(row.beforeValue));
    const parsed = parseAudit(row.afterValue);
    const after = rateFromAudit(parsed);
    if (!before || !after) {
      exceptions.push(`Applied rate audit ${row.id} is incomplete`);
      continue;
    }
    if (!priorRate.eq(before)) {
      exceptions.push(`Applied rate audit ${row.id} breaks rate history continuity`);
    }
    if (row.action === "loan.rate_change.approved") {
      const requestId = parsed?.requestId;
      const request = typeof requestId === "string" ? approvedRequests.get(requestId) : undefined;
      if (!request || !request.reviewedAt ||
          !new BigNumber(request.currentRate).eq(before) ||
          !new BigNumber(request.requestedRate).eq(after) ||
          matchedRequests.has(request.id)) {
        exceptions.push(`Approved rate audit ${row.id} does not match its approved rate request`);
      } else {
        matchedRequests.add(request.id);
      }
    }
    priorRate = after;
  }
  for (const request of approvedRequests.values()) {
    if (!matchedRequests.has(request.id)) {
      exceptions.push(`Approved rate request ${request.id} lacks an applied audit`);
    }
  }
  if (appliedAudits.some((row, index) => index > 0 &&
      row.occurredAt.getTime() === appliedAudits[index - 1].occurredAt.getTime())) {
    exceptions.push("Applied rate audits have an ambiguous exact-time order");
  }
  if (orderedAudits.some((row) => row.action === "loan.update" &&
      (() => {
        const value = parseAudit(row.afterValue);
        return value && (Object.hasOwn(value, "interestRate") ||
          Object.hasOwn(value, "interestRateOverride") ||
          Object.hasOwn(value, "startDate"));
      })())) {
    exceptions.push("Direct loan terms edit needs separate effective-date review");
  }

  const groups = new Map<string, typeof journalRows>();
  for (const row of journalRows) {
    if (!row.journalGroupId) {
      exceptions.push(`Journal ${row.id} has no group`);
      continue;
    }
    const group = groups.get(row.journalGroupId) ?? [];
    group.push(row);
    groups.set(row.journalGroupId, group);
  }
  for (const [id, group] of groups) {
    if (!net(group, "debit").isZero()) {
      exceptions.push(`Journal group ${id} is unbalanced`);
    }
  }
  const directRows = journalRows.filter((row) => row.loanId === loanId);
  if (!loan.rolledOverFrom && !sameMoney(net(directRows.filter((row) =>
    row.referenceType === "loan" && row.referenceId === loanId &&
    row.categoryName === "Loans Receivable"), "debit"), loan.principalAmount)) {
    exceptions.push("Opening principal does not reconcile to loan journal");
  }
  const issuanceCashRows = journalRows.filter((row) =>
    row.referenceType === "loan" && row.referenceId === loanId &&
    row.categoryName === "Cash");
  const issuanceFeeRows = journalRows.filter((row) =>
    row.referenceType === "loan" && row.referenceId === loanId &&
    row.categoryName === "Issuance Fees");
  if (!loan.rolledOverFrom &&
      (!sameMoney(net(issuanceCashRows, "credit"),
        new BigNumber(loan.principalAmount).minus(loan.issuanceFee).toFixed(2)) ||
        !sameMoney(net(issuanceFeeRows, "credit"), loan.issuanceFee) ||
        issuanceCashRows.some((row) => row.depositLocation !== loan.disbursementSource ||
          (row.subLocationId ?? null) !== (loan.subLocationId ?? null)))) {
    exceptions.push("Issuance cash does not reconcile to the recorded disbursement");
  }
  let principalSettled = new BigNumber(0);
  const settlements: HistoricalRateSnapshot["settlements"] = [];
  for (const payment of activePayments) {
    const allocation = paymentPortions.get(payment.id);
    const overpayment = paymentOverpayments.get(payment.id) ?? "0";
    if (!allocation) exceptions.push(`Payment ${payment.id} has no allocation journal`);
    const rows = journalRows.filter((row) => row.referenceId === payment.id &&
      ["payment", "payment_reversal"].includes(row.referenceType ?? ""));
    const cashGroups = new Map<string, typeof rows>();
    for (const row of rows.filter((item) => item.categoryName === "Cash")) {
      const key = JSON.stringify([row.transactionDate.toISOString(),
        row.depositLocation, row.subLocationId]);
      const group = cashGroups.get(key) ?? [];
      group.push(row);
      cashGroups.set(key, group);
    }
    const uncancelledCash = [...cashGroups.values()].filter((group) =>
      !net(group, "debit").isZero());
    if (uncancelledCash.length !== 1 ||
        !sameMoney(net(uncancelledCash[0], "debit"), payment.amount) ||
        uncancelledCash[0].some((row) =>
          row.transactionDate.getTime() !== payment.paymentDate.getTime() ||
          row.depositLocation !== payment.depositLocation ||
          (row.subLocationId ?? null) !== (payment.subLocationId ?? null) ||
          (row.loanId !== null && row.loanId !== loanId))) {
      exceptions.push(`Payment ${payment.id} cash receipt does not reconcile`);
    }
    if (allocation) {
      principalSettled = principalSettled.plus(allocation.principalPortion);
      settlements.push({ id: payment.id, kind: "payment", date: payment.paymentDate,
        amount: payment.amount, oldInterest: allocation.interestPortion,
        oldPrincipal: allocation.principalPortion, oldOverpayment: overpayment });
    }
  }
  for (const waiver of activeWaivers) {
    const allocation = waiverPortions.get(waiver.id);
    if (!allocation) exceptions.push(`Waiver ${waiver.id} has no allocation journal`);
    const rows = journalRows.filter((row) => row.referenceId === waiver.id &&
      ["loan_waiver", "loan_waiver_reversal"].includes(row.referenceType ?? ""));
    if (!sameMoney(net(rows.filter((row) => row.categoryName === "Loan Losses"), "debit"),
      waiver.amount)) {
      exceptions.push(`Waiver ${waiver.id} loss journal does not reconcile`);
    }
    if (allocation) {
      principalSettled = principalSettled.plus(allocation.principalPortion);
      settlements.push({ id: waiver.id, kind: "waiver", date: waiver.waiverDate,
        amount: waiver.amount, oldInterest: allocation.interestPortion,
        oldPrincipal: allocation.principalPortion, oldOverpayment: "0" });
    }
  }
  const receivable = net(directRows.filter((row) =>
    row.categoryName === "Loans Receivable"), "debit");
  if (!loan.rolledOverFrom && !successorRows.length &&
      !sameMoney(receivable, new BigNumber(loan.principalAmount)
        .minus(principalSettled).toFixed(2))) {
    exceptions.push("Loans receivable does not reconcile to recorded settlements");
  }
  const waiverIds = new Set(waiverRows.map((row) => row.id));
  const accrualReferenceTypes = new Set([
    "interest_accrual", "penalty_interest_accrual",
    "loan_waiver_accrual_reversal", "loan_waiver_reversal",
  ]);
  const accrualRows = journalRows.filter((row) =>
    row.categoryName === "Interest Receivable" &&
    (row.loanId === loanId || row.referenceId === loanId ||
      waiverIds.has(row.referenceId ?? "")));
  for (const row of accrualRows) {
    if (!accrualReferenceTypes.has(row.referenceType ?? "")) {
      exceptions.push(`Interest Receivable journal ${row.id} has an unknown source`);
    }
  }
  const postedAccrual = net(accrualRows.filter((row) =>
    row.transactionDate <= asOf), "debit").toFixed(2);
  const correctionMarked = finalAuditValue?.rateSemantics === "correction" &&
    finalAuditValue.effectiveFrom === loan.startDate.toISOString();
  const sourceDigest = digest({
    loan, paymentRows: paymentRows.toSorted((a, b) => a.id.localeCompare(b.id)),
    waiverRows: waiverRows.toSorted((a, b) => a.id.localeCompare(b.id)),
    rateRows: rateRows.toSorted((a, b) => a.id.localeCompare(b.id)),
    rateAudits: rateAudits.toSorted((a, b) => a.id.localeCompare(b.id)),
    linkedRows: [...successorRows, ...linkedRows].sort((a, b) => a.id.localeCompare(b.id)),
    journalRows: journalRows.sort((a, b) => a.id.localeCompare(b.id)),
    relevantCategoryRows: relevantCategoryRows.sort((a, b) => a.id.localeCompare(b.id)),
  });
  return planHistoricalRateRepair({
    loan: {
      id: loan.id, principalAmount: loan.principalAmount,
      interestRate: loan.interestRate, interestRateOverride: loan.interestRateOverride,
      penaltyMultiplier: loan.penaltyMultiplier,
      penaltyWaived: loan.penaltyWaived, penaltyWaivedAt: loan.penaltyWaivedAt,
      penaltyWaivedBy: loan.penaltyWaivedBy,
      minInterestDays: loan.minInterestDays, minPeriodOverride: loan.minPeriodOverride,
      rolledOverFrom: loan.rolledOverFrom, issuanceFee: loan.issuanceFee,
      loanType: loan.loanType, termMonths: loan.termMonths,
      startDate: loan.startDate, createdAt: loan.createdAt,
    },
    correctedRate: currentRate.toFixed(4), asOf, settlements,
    sourceDigest, sourceExceptions: exceptions, correctionMarked, postedAccrual,
  }, policyVersion);
}

export async function loadHistoricalRateRepairPlan(
  loanId: string,
  asOf: Date,
  policyVersion = "v1",
): Promise<HistoricalRatePlan> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    return loadHistoricalRateRepairPlanInSnapshot(tx, loanId, asOf, policyVersion);
  });
}
