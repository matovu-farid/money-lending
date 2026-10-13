/**
 * Pure preview only. The caller must load a complete, isolated source snapshot;
 * this module never reads a database and its output is not an apply authority.
 */
import { createHash } from "node:crypto";
import BigNumber from "bignumber.js";
import { buildLoanStatement } from "../loan-statement";
import { getEffectiveRate } from "./effective-rate";

export const FULLY_PAID_ALLOCATION_POLICY_VERSION = "fully-paid-allocation-v3";
const Money = BigNumber.clone({ DECIMAL_PLACES: 10, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });
const ZERO = new Money(0);
const DAY_MS = 86_400_000;
const kampalaCalendar = new Intl.DateTimeFormat("en-US", {
  timeZone: "Africa/Kampala", year: "numeric", month: "2-digit", day: "2-digit",
});

export type AllocationAmounts = { interest: string; principal: string; overpayment: string };
export type DepositLocation = "cash" | "bank" | "strong_room";
export type HistoricalPayment = AllocationAmounts & {
  id: string; loanId: string; effectiveAt: string; amount: string;
  depositLocation: DepositLocation; subLocationId: string | null;
};
export type OriginalJournalAllocation = AllocationAmounts & {
  paymentId: string; loanId: string; effectiveAt: string; cash: string;
  /** Unique IDs of the complete, independently verified original journal groups. */
  groupIds: string[];
};
export type OriginalJournalLeg = {
  id: string; groupId: string; paymentId: string; loanId: string;
  referenceType: string; effectiveAt: string; side: "debit" | "credit";
  account: string; accountType: "asset" | "revenue"; amount: string;
  depositLocation: DepositLocation | null;
  subLocationId: string | null;
};
export type CurrentLedgerAllocation = AllocationAmounts & {
  paymentId: string; loanId: string; effectiveAt: string; cash: string;
};
export type PaymentCreateAudit = {
  action: string; beforeNull: boolean;
  paymentId: string; loanId: string; effectiveAt: string; amount: string;
  depositLocation: DepositLocation; subLocationId: string | null;
};
export type LoanCreateAudit = {
  action: string; beforeNull: boolean;
  loanId: string; principal: string; monthlyRate: string; penaltyMultiplier: string;
  minInterestDays: number; startAt: string; type: string;
};
export type FullyPaidAllocationSnapshot = {
  asOf: string;
  /** Complete parent portfolio source digest, including loan/payment/audit/journal/category rows. */
  sourceDigest: string;
  loan: {
    id: string; status: string; type: string; principal: string; monthlyRate: string;
    penaltyMultiplier: string; minInterestDays: number; startAt: string;
    interestRateOverride: string | null; minPeriodOverride: number | null;
    rolledOverFrom: string | null; rolledOverTo: string | null; penaltyWaived: boolean;
  };
  /** Immutable original split from the Cash-paired payment journals, never overwritten after correction. */
  payments: HistoricalPayment[];
  journalAllocations: OriginalJournalAllocation[];
  originalJournalLegs: OriginalJournalLeg[];
  journalsComplete: boolean;
  /** Independently loaded current net allocation, including any correction journals. */
  currentLedgerAllocations: CurrentLedgerAllocation[];
  currentLedgerComplete: boolean;
  correctionProof: AppliedCorrectionProof | null;
  auditProof: { loanCreate: LoanCreateAudit; paymentCreates: PaymentCreateAudit[]; complete: boolean };
  /** Caller must explicitly enumerate exceptional source history. Omission blocks. */
  rateChanges: string[]; waivers: string[]; reversals: string[];
  extraPaymentJournals: string[]; otherRelevantAudits: string[]; sourceExceptions: string[];
};
export type JournalEffect = Readonly<{
  paymentId: string; effectiveAt: string;
  account: "Loans Receivable" | "Interest Earned" | "Overpayment Revenue";
  side: "debit" | "credit"; amount: string;
}>;
export type ReviewedCorrectionGroup = {
  paymentId: string; effectiveAt: string;
  entries: Array<Pick<JournalEffect, "account" | "side" | "amount">>;
};
/** Shape required in the persisted agent review's evidenceJson; not inferred from a run flag. */
export type ReviewedCorrectionEvidence = {
  kind: "fully-paid-allocation-repair"; loanId: string;
  reviewedAsOf: string; preapplySourceDigest: string;
  expectedGroups: ReviewedCorrectionGroup[];
};
export type AppliedCorrectionJournalLeg = {
  id: string; groupId: string; loanId: string; paymentId: string;
  referenceType: string; referenceId: string; description: string;
  effectiveAt: string; account: string; accountType: "asset" | "revenue";
  side: "debit" | "credit"; amount: string;
  depositLocation: DepositLocation | null; subLocationId: string | null;
  recordedBy: string; createdAt: string;
};
/** Caller must load these exact persisted run/review/journal facts under one consistent snapshot. */
export type AppliedCorrectionProof = {
  run: {
    id: string; loanId: string; planHash: string; inputFingerprint: string;
    policyVersion: string; agentReviewId: string; appliedByAgent: string;
    backupSha256: string; appliedAt: string;
    /** Persisted run→payment→journal-group map; never inferred from descriptions alone. */
    afterSummary: string;
  };
  review: {
    id: string; kind: string; subjectId: string; planHash: string;
    inputFingerprint: string; policyVersion: string; verdict: string;
    reviewerAgentId: string; consumedByRunId: string; consumedAt: string;
    evidenceJson: string; evidenceSha256: string;
  };
  journalLegs: AppliedCorrectionJournalLeg[];
  journalsComplete: boolean;
};
export type PaymentAllocationComparison = Readonly<{
  paymentId: string; effectiveAt: string; amount: string;
  before: Readonly<AllocationAmounts>; current: Readonly<AllocationAmounts>;
  after: Readonly<AllocationAmounts>;
}>;
export type FullyPaidAllocationPlan = Readonly<{
  policyVersion: string; sourceFingerprint: string; planHash: string;
  status: "ready" | "noop" | "blocked"; blockers: readonly string[];
  loanId: string; asOf: string; finalPrincipal: string | null;
  allocations: readonly PaymentAllocationComparison[]; effects: readonly JournalEffect[];
}>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function sourceForHash(input: FullyPaidAllocationSnapshot): unknown {
  return {
    ...input,
    originalJournalLegs: Array.isArray(input.originalJournalLegs)
      ? [...input.originalJournalLegs].sort((a, b) => String(a?.id).localeCompare(String(b?.id)))
      : input.originalJournalLegs,
    journalAllocations: Array.isArray(input.journalAllocations)
      ? input.journalAllocations.map((row) => row && typeof row === "object"
        ? { ...row, groupIds: Array.isArray(row.groupIds) ? [...row.groupIds].sort() : row.groupIds }
        : row) : input.journalAllocations,
    correctionProof: input.correctionProof && typeof input.correctionProof === "object"
      ? { ...input.correctionProof,
          journalLegs: Array.isArray(input.correctionProof.journalLegs)
            ? [...input.correctionProof.journalLegs].sort((a, b) => String(a?.id).localeCompare(String(b?.id)))
            : input.correctionProof.journalLegs }
      : input.correctionProof,
  };
}

function frozen<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}

function amount(value: string): BigNumber {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("Invalid non-negative cent-exact amount");
  }
  return new Money(value);
}

function rate(value: string): BigNumber {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(value)) {
    throw new Error("Invalid decimal rate");
  }
  return new Money(value);
}

function date(value: string): Date {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) {
    throw new Error("Date must be canonical UTC ISO");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new Error("Invalid date");
  return parsed;
}

function money(value: BigNumber): string {
  return value.toFixed(2, BigNumber.ROUND_HALF_EVEN);
}

function sameMoney(a: string, b: string): boolean {
  return amount(a).eq(amount(b));
}

function kampalaDateKey(value: Date): string {
  const parts = kampalaCalendar.formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Find the final millisecond of the receipt's Africa/Kampala calendar day. */
function kampalaEndOfDay(receipt: Date): Date {
  const key = kampalaDateKey(receipt);
  let lower = receipt.getTime();
  let upper = lower + 2 * DAY_MS;
  if (!Number.isFinite(upper) || kampalaDateKey(new Date(upper)) === key) {
    throw new Error("Africa/Kampala settlement day is ambiguous");
  }
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2);
    if (kampalaDateKey(new Date(middle)) === key) lower = middle;
    else upper = middle;
  }
  return new Date(upper - 1);
}

function requireFacts(input: FullyPaidAllocationSnapshot): void {
  const { loan, auditProof } = input;
  if (typeof input.sourceDigest !== "string" || !/^[a-f0-9]{64}$/.test(input.sourceDigest)) {
    throw new Error("Missing or malformed parent portfolio source digest");
  }
  if (!loan?.id || loan.status !== "fully_paid" || loan.type !== "perpetual" ||
      loan.interestRateOverride !== null || loan.minPeriodOverride !== null ||
      loan.rolledOverFrom !== null || loan.rolledOverTo !== null || loan.penaltyWaived !== false) {
    throw new Error("Unsupported loan terms or closure state");
  }
  if (!Number.isInteger(loan.minInterestDays) || loan.minInterestDays < 0 ||
      !Number.isInteger(auditProof?.loanCreate?.minInterestDays)) throw new Error("Invalid minimum period");
  if (![input.rateChanges, input.waivers, input.reversals, input.extraPaymentJournals,
    input.otherRelevantAudits, input.sourceExceptions].every((v) => Array.isArray(v) && v.length === 0)) {
    throw new Error("Unproved exceptional history");
  }
  if (auditProof.complete !== true || !Array.isArray(auditProof.paymentCreates) ||
      auditProof.loanCreate.action !== "loan.create" || auditProof.loanCreate.beforeNull !== true ||
      auditProof.loanCreate.loanId !== loan.id || auditProof.loanCreate.type !== loan.type ||
      auditProof.loanCreate.startAt !== loan.startAt ||
      auditProof.loanCreate.minInterestDays !== loan.minInterestDays ||
      !sameMoney(auditProof.loanCreate.principal, loan.principal) ||
      !rate(auditProof.loanCreate.penaltyMultiplier).eq(rate(loan.penaltyMultiplier)) ||
      !rate(auditProof.loanCreate.monthlyRate).eq(rate(loan.monthlyRate))) {
    throw new Error("Loan creation audit disagrees with terms");
  }
  if (amount(loan.principal).lte(0) || rate(loan.monthlyRate).lte(0) ||
      rate(loan.penaltyMultiplier).lt(0)) throw new Error("Invalid loan terms");
  const start = date(loan.startAt).getTime();
  const asOf = date(input.asOf).getTime();
  if (start > asOf || !Array.isArray(input.payments) || input.payments.length === 0 ||
      !Array.isArray(input.journalAllocations) || input.journalAllocations.length !== input.payments.length ||
      !Array.isArray(input.originalJournalLegs) || input.journalsComplete !== true ||
      !Array.isArray(input.currentLedgerAllocations) || input.currentLedgerComplete !== true ||
      input.currentLedgerAllocations.length !== input.payments.length ||
      auditProof.paymentCreates.length !== input.payments.length) throw new Error("Incomplete payment history");

  const legsByGroup = new Map<string, OriginalJournalLeg[]>();
  const seenLegs = new Set<string>();
  for (const leg of input.originalJournalLegs) {
    if (!leg?.id || seenLegs.has(leg.id) || !leg.groupId || leg.loanId !== loan.id ||
        leg.referenceType !== "payment" || !leg.paymentId ||
        (leg.side !== "debit" && leg.side !== "credit")) throw new Error("Unattributed or duplicate original journal leg");
    seenLegs.add(leg.id);
    amount(leg.amount);
    date(leg.effectiveAt);
    const group = legsByGroup.get(leg.groupId) ?? [];
    group.push(leg);
    legsByGroup.set(leg.groupId, group);
  }

  const seenPayments = new Set<string>();
  const seenGroups = new Set<string>();
  let previous = start;
  let previousDay = -1;
  let originalPrincipalPaid = ZERO;
  for (let i = 0; i < input.payments.length; i++) {
    const p = input.payments[i];
    const j = input.journalAllocations[i];
    const current = input.currentLedgerAllocations[i];
    const a = auditProof.paymentCreates[i];
    const when = date(p.effectiveAt).getTime();
    const day = Math.floor((when - start) / DAY_MS);
    if (!p.id || seenPayments.has(p.id) || p.loanId !== loan.id || when <= start || when > asOf ||
        when <= previous || day === previousDay || !j || !a || !current) throw new Error("Payment identity, effective date or order is ambiguous");
    seenPayments.add(p.id); previous = when; previousDay = day;
    if (a.action !== "payment.create" || a.beforeNull !== true ||
        a.paymentId !== p.id || a.loanId !== loan.id || a.effectiveAt !== p.effectiveAt ||
        !sameMoney(a.amount, p.amount) || a.depositLocation !== p.depositLocation ||
        a.subLocationId !== p.subLocationId ||
        !["cash", "bank", "strong_room"].includes(p.depositLocation)) throw new Error("Payment creation audit disagrees");
    if (j.paymentId !== p.id || j.loanId !== loan.id || j.effectiveAt !== p.effectiveAt ||
        !sameMoney(j.cash, p.amount) || !sameMoney(j.interest, p.interest) ||
        !sameMoney(j.principal, p.principal) || !sameMoney(j.overpayment, p.overpayment) ||
        !Array.isArray(j.groupIds) || j.groupIds.length === 0) throw new Error("Original journal allocation disagrees");
    for (const group of j.groupIds) {
      if (typeof group !== "string" || group.length === 0 || seenGroups.has(group)) throw new Error("Duplicate or missing journal group");
      seenGroups.add(group);
    }
    const expected = new Map<string, string>(([
      ["Interest Earned", p.interest], ["Loans Receivable", p.principal],
      ["Overpayment Revenue", p.overpayment],
    ] as Array<[string, string]>).filter(([, value]) => amount(value).gt(0)));
    if (j.groupIds.length !== expected.size) throw new Error("Journal group multiplicity differs from payment split");
    for (const groupId of j.groupIds) {
      const pair = legsByGroup.get(groupId);
      if (!pair || pair.length !== 2) throw new Error("Original journal group is not an exact pair");
      const cash = pair.find((leg) => leg.side === "debit" && leg.account === "Cash");
      const credit = pair.find((leg) => leg.side === "credit" && leg.account !== "Cash");
      if (!cash || !credit || !expected.has(credit.account) ||
          pair.some((leg) => leg.paymentId !== p.id || leg.effectiveAt !== p.effectiveAt) ||
          !sameMoney(cash.amount, credit.amount) || !sameMoney(credit.amount, expected.get(credit.account)!) ||
          cash.accountType !== "asset" ||
          credit.accountType !== (credit.account === "Loans Receivable" ? "asset" : "revenue") ||
          cash.depositLocation !== p.depositLocation || cash.subLocationId !== p.subLocationId ||
          credit.depositLocation !== null || credit.subLocationId !== null) {
        throw new Error("Original journal pair disagrees with payment");
      }
      expected.delete(credit.account);
    }
    if (expected.size !== 0) throw new Error("Original journal category is missing");
    const total = amount(p.interest).plus(amount(p.principal)).plus(amount(p.overpayment));
    if (!total.eq(amount(p.amount))) throw new Error("Original payment allocation does not conserve cash");
    if (current.paymentId !== p.id || current.loanId !== loan.id || current.effectiveAt !== p.effectiveAt ||
        !sameMoney(current.cash, p.amount) ||
        !amount(current.interest).plus(amount(current.principal)).plus(amount(current.overpayment))
          .eq(amount(p.amount))) throw new Error("Current ledger allocation does not conserve original Cash");
    originalPrincipalPaid = originalPrincipalPaid.plus(amount(p.principal));
    if (originalPrincipalPaid.gt(amount(loan.principal))) throw new Error("Original principal over-repaid");
  }
  if (seenGroups.size !== legsByGroup.size) throw new Error("Extra payment journal group is not attributed");
  if (!originalPrincipalPaid.eq(amount(loan.principal))) throw new Error("Recorded fully-paid principal does not close");
}

/** Replays the current server interest-first allocator, including its whole-UGX statement clamp. */
function replay(
  input: FullyPaidAllocationSnapshot,
  boundary: "UTC" | "Africa/Kampala",
): { allocations: PaymentAllocationComparison[]; finalPrincipal: string } {
  const loan = input.loan;
  const start = date(loan.startAt);
  let balance = amount(loan.principal);
  let previous = start;
  const posted: Array<{ paymentDate: Date; amount: string; interestPortion: string; principalPortion: string; recorderName: string }> = [];
  const allocations: PaymentAllocationComparison[] = [];
  for (const [index, p] of input.payments.entries()) {
    const effective = date(p.effectiveAt);
    const endOfDay = boundary === "UTC"
      ? new Date(Date.UTC(effective.getUTCFullYear(), effective.getUTCMonth(), effective.getUTCDate(), 23, 59, 59, 999))
      : kampalaEndOfDay(effective);
    const statement = buildLoanStatement({
      loan: { id: loan.id, principalAmount: loan.principal, interestRate: loan.monthlyRate,
        interestRateOverride: null, penaltyMultiplier: loan.penaltyMultiplier,
        penaltyWaived: false, penaltyWaivedAt: null, penaltyWaivedBy: null,
        minInterestDays: loan.minInterestDays, minPeriodOverride: null, rolledOverFrom: null,
        issuanceFee: "0.00", loanType: "perpetual", startDate: start, createdAt: start },
      payments: posted, today: endOfDay,
    });
    // A fractional principal created by replay must be represented exactly;
    // statement principal is whole-UGX display and is not used for settlement principal.
    const rateNow = getEffectiveRate({ interestRate: loan.monthlyRate, interestRateOverride: null,
      penaltyMultiplier: loan.penaltyMultiplier }, statement.finalState.penaltyActive);
    const elapsed = Math.floor((effective.getTime() - previous.getTime()) / DAY_MS);
    const minimum = index === 0 ? loan.minInterestDays : 0;
    const gross = balance.multipliedBy(rateNow).multipliedBy(Math.max(elapsed, minimum)).dividedBy(30);
    const cash = amount(p.amount);
    let interest = cash.lte(gross) ? cash : new Money(money(gross));
    let principal = cash.lte(gross) ? ZERO : new Money(money(Money.min(cash.minus(gross), balance)));
    const unpaidWhole = amount(statement.finalState.netUnpaidInterest);
    const cappedInterest = Money.min(cash, unpaidWhole);
    const cappedPrincipal = Money.min(cash.minus(cappedInterest), balance);
    if (!interest.eq(cappedInterest) || !principal.eq(cappedPrincipal)) {
      interest = new Money(money(cappedInterest));
      principal = new Money(money(cappedPrincipal));
    }
    const after = { interest: money(interest), principal: money(principal),
      overpayment: money(cash.minus(interest).minus(principal)) };
    if (!amount(after.interest).plus(amount(after.principal)).plus(amount(after.overpayment)).eq(cash)) {
      throw new Error("Replay did not conserve cash");
    }
    allocations.push({ paymentId: p.id, effectiveAt: p.effectiveAt, amount: p.amount,
      before: { interest: money(amount(p.interest)), principal: money(amount(p.principal)), overpayment: money(amount(p.overpayment)) },
      current: { interest: money(amount(input.currentLedgerAllocations[index].interest)),
        principal: money(amount(input.currentLedgerAllocations[index].principal)),
        overpayment: money(amount(input.currentLedgerAllocations[index].overpayment)) }, after });
    balance = balance.minus(principal);
    posted.push({ paymentDate: effective, amount: p.amount, interestPortion: after.interest,
      principalPortion: after.principal, recorderName: "historical replay" });
    previous = effective;
  }
  return { allocations, finalPrincipal: money(balance) };
}

function effectsFor(allocations: PaymentAllocationComparison[]): JournalEffect[] {
  const effects: JournalEffect[] = [];
  for (const p of allocations) {
    const deltaPrincipal = amount(p.after.principal).minus(amount(p.before.principal));
    const deltaInterest = amount(p.after.interest).minus(amount(p.before.interest));
    const deltaOverpayment = amount(p.after.overpayment).minus(amount(p.before.overpayment));
    for (const [account, delta] of [
      ["Loans Receivable", deltaPrincipal.negated()],
      ["Interest Earned", deltaInterest.negated()],
      ["Overpayment Revenue", deltaOverpayment.negated()],
    ] as const) {
      if (delta.isZero()) continue;
      effects.push({ paymentId: p.paymentId, effectiveAt: p.effectiveAt, account,
        side: delta.gt(0) ? "debit" : "credit", amount: money(delta.abs()) });
    }
    const signed = effects.filter((e) => e.paymentId === p.paymentId).reduce((sum, e) =>
      sum.plus(e.side === "debit" ? amount(e.amount) : amount(e.amount).negated()), ZERO);
    if (!signed.isZero()) throw new Error("Correction journal is unbalanced");
  }
  return effects.sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) ||
    a.paymentId.localeCompare(b.paymentId) ||
    (a.side === b.side ? 0 : a.side === "debit" ? -1 : 1) ||
    a.account.localeCompare(b.account));
}

function correctionGroupSignature(group: ReviewedCorrectionGroup): string {
  return JSON.stringify(canonical({ paymentId: group.paymentId, effectiveAt: group.effectiveAt,
    entries: [...group.entries].sort((a, b) =>
      `${a.account}|${a.side}|${a.amount}`.localeCompare(`${b.account}|${b.side}|${b.amount}`)) }));
}

function assertReviewedGroups(
  input: FullyPaidAllocationSnapshot,
  groups: ReviewedCorrectionGroup[],
  expectedEffects: JournalEffect[],
): void {
  if (!Array.isArray(groups) || groups.length === 0) throw new Error("Reviewed correction groups are missing");
  const payments = new Map(input.payments.map((p) => [p.id, p]));
  const totals = new Map<string, BigNumber>();
  for (const group of groups) {
    const payment = payments.get(group?.paymentId);
    if (!payment || group.effectiveAt !== payment.effectiveAt ||
        !Array.isArray(group.entries) || group.entries.length < 2) {
      throw new Error("Reviewed correction group is unattributed");
    }
    let signed = ZERO;
    for (const entry of group.entries) {
      if (!entry || !["Loans Receivable", "Interest Earned", "Overpayment Revenue"].includes(entry.account) ||
          (entry.side !== "debit" && entry.side !== "credit")) {
        throw new Error("Reviewed correction group has an unsupported leg");
      }
      const value = amount(entry.amount);
      if (value.lte(0)) throw new Error("Reviewed correction leg must be positive");
      signed = signed.plus(entry.side === "debit" ? value : value.negated());
      const key = `${group.paymentId}|${group.effectiveAt}|${entry.account}|${entry.side}`;
      totals.set(key, (totals.get(key) ?? ZERO).plus(value));
    }
    if (!signed.isZero()) throw new Error("Reviewed correction group is unbalanced");
  }
  const expected = new Map(expectedEffects.map((entry) =>
    [`${entry.paymentId}|${entry.effectiveAt}|${entry.account}|${entry.side}`, amount(entry.amount)]));
  if (totals.size !== expected.size || [...totals].some(([key, value]) => !value.eq(expected.get(key) ?? -1))) {
    throw new Error("Reviewed correction effects differ from the replayed plan");
  }
}

function assertAppliedCorrection(
  input: FullyPaidAllocationSnapshot,
  allocations: PaymentAllocationComparison[],
  expectedEffects: JournalEffect[],
): void {
  const proof = input.correctionProof;
  if (!proof || typeof proof !== "object" || !proof.run || !proof.review ||
      proof.journalsComplete !== true || !Array.isArray(proof.journalLegs)) {
    throw new Error("Applied correction proof is incomplete");
  }
  const { run, review } = proof;
  if (!run.id || run.loanId !== input.loan.id || !run.agentReviewId ||
      !/^[a-f0-9]{64}$/.test(run.backupSha256) ||
      !run.appliedByAgent?.startsWith("agent:") || run.appliedByAgent === "agent:" ||
      !review.reviewerAgentId?.startsWith("agent:") || review.reviewerAgentId === "agent:" ||
      run.appliedByAgent === review.reviewerAgentId ||
      review.id !== run.agentReviewId || review.kind !== "fully-paid-allocation-repair" ||
      review.subjectId !== input.loan.id || review.verdict !== "pass" ||
      review.consumedByRunId !== run.id || !review.consumedAt ||
      run.policyVersion !== FULLY_PAID_ALLOCATION_POLICY_VERSION ||
      review.policyVersion !== run.policyVersion) {
    throw new Error("Correction run and independent review are not linked");
  }
  const appliedAt = date(run.appliedAt).getTime();
  const consumedAt = date(review.consumedAt).getTime();
  // asOf bounds the effective dates of receipts and journals, not the later
  // operational timestamp at which a reviewed, backdated correction was applied.
  if (consumedAt > appliedAt) {
    throw new Error("Correction review consumption is later than application");
  }
  let evidence: ReviewedCorrectionEvidence;
  try {
    evidence = JSON.parse(review.evidenceJson) as ReviewedCorrectionEvidence;
  } catch {
    throw new Error("Reviewed correction evidence is invalid JSON");
  }
  if (!/^[a-f0-9]{64}$/.test(review.evidenceSha256) ||
      hash(evidence) !== review.evidenceSha256 ||
      evidence?.kind !== "fully-paid-allocation-repair" || evidence.loanId !== input.loan.id ||
      !/^[a-f0-9]{64}$/.test(evidence.preapplySourceDigest) ||
      date(evidence.reviewedAsOf).getTime() > appliedAt) {
    throw new Error("Reviewed correction evidence digest or identity disagrees");
  }
  const originalLedger = input.payments.map((p) => ({ paymentId: p.id, loanId: p.loanId,
    effectiveAt: p.effectiveAt, cash: p.amount, interest: p.interest,
    principal: p.principal, overpayment: p.overpayment }));
  const reviewedPlan = planFullyPaidAllocationRepair({ ...input, asOf: evidence.reviewedAsOf,
    sourceDigest: evidence.preapplySourceDigest, currentLedgerAllocations: originalLedger,
    correctionProof: null });
  if (reviewedPlan.status !== "ready" || run.planHash !== reviewedPlan.planHash ||
      review.planHash !== reviewedPlan.planHash ||
      run.inputFingerprint !== reviewedPlan.sourceFingerprint ||
      review.inputFingerprint !== reviewedPlan.sourceFingerprint) {
    throw new Error("Applied run does not match the original ready plan");
  }
  assertReviewedGroups(input, evidence.expectedGroups, expectedEffects);

  const seenLegIds = new Set<string>();
  const actualGroups = new Map<string, AppliedCorrectionJournalLeg[]>();
  const payments = new Map(input.payments.map((p) => [p.id, p]));
  for (const leg of proof.journalLegs) {
    const payment = payments.get(leg?.paymentId);
    if (!leg?.id || seenLegIds.has(leg.id) || !leg.groupId || !payment ||
        leg.loanId !== input.loan.id || leg.referenceType !== "payment" ||
        leg.referenceId !== payment.id ||
        leg.description !== `Payment allocation repair run ${run.id} payment ${payment.id}` ||
        leg.effectiveAt !== payment.effectiveAt ||
        leg.recordedBy !== run.appliedByAgent || leg.createdAt !== run.appliedAt ||
        !["Loans Receivable", "Interest Earned", "Overpayment Revenue"].includes(leg.account) ||
        leg.accountType !== (leg.account === "Loans Receivable" ? "asset" : "revenue") ||
        (leg.side !== "debit" && leg.side !== "credit") ||
        leg.depositLocation !== null || leg.subLocationId !== null || amount(leg.amount).lte(0)) {
      throw new Error("Correction journal leg lacks exact run/payment attribution");
    }
    seenLegIds.add(leg.id);
    const group = actualGroups.get(leg.groupId) ?? [];
    group.push(leg);
    actualGroups.set(leg.groupId, group);
  }
  const actualSignatures = [...actualGroups.values()].map((legs) => {
    const { paymentId, effectiveAt } = legs[0];
    if (legs.some((leg) => leg.paymentId !== paymentId || leg.effectiveAt !== effectiveAt)) {
      throw new Error("Correction journal group crosses payments or dates");
    }
    const group = { paymentId, effectiveAt,
      entries: legs.map((leg) => ({ account: leg.account as JournalEffect["account"],
        side: leg.side, amount: money(amount(leg.amount)) })) };
    return correctionGroupSignature(group);
  }).sort();
  let afterSummary: unknown;
  try {
    afterSummary = JSON.parse(run.afterSummary);
  } catch {
    throw new Error("Applied run has no valid group attribution summary");
  }
  const summary = afterSummary as { kind?: unknown; loanId?: unknown; planHash?: unknown;
    groups?: Array<{ paymentId?: unknown; groupId?: unknown }> } | null;
  if (!summary || summary.kind !== "fully-paid-allocation-repair" ||
      summary.loanId !== input.loan.id || summary.planHash !== run.planHash ||
      !Array.isArray(summary.groups) || summary.groups.length !== actualGroups.size) {
    throw new Error("Applied run group attribution is incomplete");
  }
  const mapped = new Map<string, string>();
  for (const item of summary.groups) {
    if (!item || typeof item.groupId !== "string" || !item.groupId ||
        typeof item.paymentId !== "string" || !payments.has(item.paymentId) ||
        mapped.has(item.groupId)) throw new Error("Applied run group attribution is ambiguous");
    mapped.set(item.groupId, item.paymentId);
  }
  if ([...actualGroups].some(([groupId, legs]) =>
      mapped.get(groupId) !== legs[0].paymentId)) {
    throw new Error("Applied journal group does not match its run/payment mapping");
  }
  const reviewedSignatures = evidence.expectedGroups.map(correctionGroupSignature).sort();
  if (actualSignatures.length !== reviewedSignatures.length ||
      actualSignatures.some((signature, index) => signature !== reviewedSignatures[index])) {
    throw new Error("Applied correction journal groups differ from the reviewed entries");
  }
  if (allocations.some((p) => p.current.interest !== p.after.interest ||
      p.current.principal !== p.after.principal || p.current.overpayment !== p.after.overpayment)) {
    throw new Error("Current ledger allocation differs from the reviewed correction");
  }
}

export function planFullyPaidAllocationRepair(input: FullyPaidAllocationSnapshot): FullyPaidAllocationPlan {
  const sourceFingerprint = hash({ policyVersion: FULLY_PAID_ALLOCATION_POLICY_VERSION, source: sourceForHash(input) });
  let status: FullyPaidAllocationPlan["status"] = "blocked";
  let blockers: string[] = [];
  let allocations: PaymentAllocationComparison[] = [];
  let effects: JournalEffect[] = [];
  let finalPrincipal: string | null = null;
  try {
    requireFacts(input);
    const replayed = replay(input, "UTC");
    const kampala = replay(input, "Africa/Kampala");
    if (replayed.finalPrincipal !== kampala.finalPrincipal ||
        replayed.allocations.some((row, index) =>
          row.after.interest !== kampala.allocations[index].after.interest ||
          row.after.principal !== kampala.allocations[index].after.principal ||
          row.after.overpayment !== kampala.allocations[index].after.overpayment)) {
      throw new Error("UTC and Africa/Kampala settlement allocations disagree");
    }
    allocations = replayed.allocations;
    finalPrincipal = replayed.finalPrincipal;
    if (!amount(finalPrincipal).isZero()) {
      blockers = ["Replayed principal does not close the fully-paid loan"];
    } else {
      const changed = allocations.some((p) =>
        p.before.interest !== p.after.interest || p.before.principal !== p.after.principal ||
        p.before.overpayment !== p.after.overpayment);
      if (input.correctionProof === null) {
        if (allocations.some((p) => p.before.interest !== p.current.interest ||
            p.before.principal !== p.current.principal || p.before.overpayment !== p.current.overpayment)) {
          throw new Error("Current ledger differs from original journals without reviewed correction");
        }
        status = changed ? "ready" : "noop";
        if (changed) effects = effectsFor(allocations);
      } else {
        if (!changed) throw new Error("No original allocation difference exists for an applied correction");
        assertAppliedCorrection(input, allocations, effectsFor(allocations));
        status = "noop";
      }
    }
  } catch (error) {
    blockers = [error instanceof Error ? error.message : "Unproved source facts"];
  }
  const body = { policyVersion: FULLY_PAID_ALLOCATION_POLICY_VERSION, sourceFingerprint,
    status, blockers, loanId: input?.loan?.id ?? "", asOf: input?.asOf ?? "", finalPrincipal,
    allocations, effects };
  return frozen({ ...body, planHash: hash(body) });
}
