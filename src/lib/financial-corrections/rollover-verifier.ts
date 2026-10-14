import BigNumber from "bignumber.js";
import { PENALTY_THRESHOLD_DAYS } from "@/lib/interest/effective-rate";
import type { ChainLoan, ChainSnapshot, CorrectionPlan, SettlementChange } from
  "@/lib/interest/rollover-correction";
import { paymentAfterRollover, rolloverPaymentCutoff } from
  "@/lib/interest/rollover-payment-boundary";

const money = (value: BigNumber.Value) => new BigNumber(value).toFixed(2);
const whole = (value: BigNumber.Value) => new BigNumber(value).toFixed(0);
const Decimal = BigNumber.clone({ DECIMAL_PLACES: 10,
  ROUNDING_MODE: BigNumber.ROUND_HALF_UP });
const DAY_MS = 86_400_000;

type Replayed = { payments: ChainLoan["payments"]; waivers: ChainLoan["waivers"];
  changes: SettlementChange[] };

export type RolloverSourceJournal = {
  loanId: string | null; referenceType: string | null; referenceId: string | null;
  categoryName: string; type: "debit" | "credit"; amount: string;
  journalGroupId: string | null;
  transactionDate: Date; depositLocation: string | null; subLocationId: string | null;
};

function sourceRowsForChain(snapshot: ChainSnapshot,
  journals: RolloverSourceJournal[]): RolloverSourceJournal[] {
  const ids = new Set(snapshot.loans.map((loan) => loan.id));
  const direct = journals.filter((row) => row.loanId && ids.has(row.loanId));
  const paymentIds = new Set(snapshot.loans.flatMap((loan) =>
    loan.payments.map((payment) => payment.id)));
  const discovered = journals.filter((row) =>
    row.loanId && ids.has(row.loanId) ||
    ["payment", "payment_reversal"].includes(row.referenceType ?? "") &&
      paymentIds.has(row.referenceId ?? ""));
  if (!direct.length || discovered.some((row) => !row.journalGroupId)) {
    throw new Error("Rollover source journals are missing or ungrouped");
  }
  const groups = new Set(discovered.map((row) => row.journalGroupId));
  const rows = journals.filter((row) => row.journalGroupId && groups.has(row.journalGroupId));
  for (const group of groups) {
    const members = rows.filter((row) => row.journalGroupId === group);
    const balance = members.reduce((sum, row) =>
      row.type === "debit" ? sum.plus(row.amount) : sum.minus(row.amount),
    new BigNumber(0));
    if (members.length < 2 || balance.abs().gte(0.01) ||
        members.some((row) => !new BigNumber(row.amount).isFinite() ||
          new BigNumber(row.amount).lte(0))) {
      throw new Error(`Rollover source journal group ${group} is missing or unbalanced`);
    }
  }
  return rows;
}

function journalNet(rows: RolloverSourceJournal[], category: string,
  positive: "debit" | "credit", referenceType: string, referenceId: string,
  loanId?: string): BigNumber {
  return rows.filter((row) => row.categoryName === category &&
    row.referenceType === referenceType && row.referenceId === referenceId &&
    (loanId === undefined || row.loanId === loanId))
    .reduce((sum, row) => row.type === positive
      ? sum.plus(row.amount) : sum.minus(row.amount), new BigNumber(0));
}

function matchesCashLocation(row: RolloverSourceJournal, location: unknown,
  subLocationId: unknown): boolean {
  return typeof location === "string" && row.depositLocation === location &&
    (row.subLocationId ?? null) === (subLocationId ?? null);
}

function assertDatedSettlement(rows: RolloverSourceJournal[], referenceId: string,
  kinds: string[], date: Date, label: string): RolloverSourceJournal[] {
  const matching = rows.filter((row) => row.referenceId === referenceId &&
    kinds.includes(row.referenceType ?? ""));
  const oldDatedNets = new Map<string, BigNumber>();
  for (const row of matching) {
    if (!(row.transactionDate instanceof Date) ||
        !Number.isFinite(row.transactionDate.getTime())) {
      throw new Error(`Rollover source ${label} journal date is missing or invalid`);
    }
    if (row.transactionDate.getTime() === date.getTime()) continue;
    // Earlier receipt edits can leave original and reversal groups at the old date.
    // They are harmless only when each account and cash location nets to zero there.
    const key = JSON.stringify([row.transactionDate.toISOString(), row.loanId,
      row.categoryName, row.depositLocation, row.subLocationId]);
    const previous = oldDatedNets.get(key) ?? new BigNumber(0);
    oldDatedNets.set(key, row.type === "debit"
      ? previous.plus(row.amount) : previous.minus(row.amount));
  }
  if ([...oldDatedNets.values()].some((amount) => !amount.isZero())) {
    throw new Error(`Rollover source ${label} journal date differs from its event`);
  }
  return matching.filter((row) => row.transactionDate.getTime() === date.getTime());
}

function assertSourceReconciles(snapshot: ChainSnapshot, rows: RolloverSourceJournal[]): void {
  const successors = new Set(snapshot.loans.map((loan) => loan.rolledOverFrom)
    .filter((id): id is string => !!id));
  const knownPayments = new Set(snapshot.loans.flatMap((loan) =>
    loan.payments.map((row) => row.id)));
  const knownWaivers = new Set(snapshot.loans.flatMap((loan) =>
    loan.waivers.map((row) => row.id)));
  const ids = new Set(snapshot.loans.map((loan) => loan.id));
  const allowedCategories: Record<string, string[]> = {
    loan: ["Loans Receivable", "Cash", "Issuance Fees"],
    rollover: ["Loans Receivable", "Interest Earned"],
    payment: ["Cash", "Loans Receivable", "Interest Earned", "Overpayment Revenue"],
    payment_reversal: ["Cash", "Loans Receivable", "Interest Earned", "Overpayment Revenue"],
    loan_waiver: ["Loan Losses", "Loans Receivable", "Interest Earned"],
    loan_waiver_reversal: ["Loan Losses", "Loans Receivable", "Interest Earned"],
  };
  if (rows.some((row) => row.loanId && ids.has(row.loanId) &&
      !allowedCategories[row.referenceType ?? ""]?.includes(row.categoryName))) {
    throw new Error("Rollover source has an unexplained loan journal category or reference");
  }
  if (rows.some((row) => row.loanId && ids.has(row.loanId) &&
      ((["payment", "payment_reversal"].includes(row.referenceType ?? "") &&
        !knownPayments.has(row.referenceId ?? "")) ||
       (["loan_waiver", "loan_waiver_reversal"].includes(row.referenceType ?? "") &&
        !knownWaivers.has(row.referenceId ?? ""))))) {
    throw new Error("Rollover source contains an orphan settlement journal");
  }
  for (const loan of snapshot.loans) {
    const fresh = new BigNumber(loan.principalAmount).minus(loan.rolloverAmount ?? "0");
    const loanRows = rows.filter((row) => row.referenceType === "loan" &&
      row.referenceId === loan.id);
    const disbursementGroups = new Set(loanRows.filter((row) =>
      row.loanId === loan.id && row.categoryName === "Loans Receivable" &&
      row.type === "debit").map((row) => row.journalGroupId));
    const feeGroups = new Set(loanRows.filter((row) =>
      row.loanId === loan.id && row.categoryName === "Issuance Fees" &&
      row.type === "credit").map((row) => row.journalGroupId));
    const issueRows = loanRows.filter((row) => disbursementGroups.has(row.journalGroupId));
    const feeRows = loanRows.filter((row) => feeGroups.has(row.journalGroupId));
    const source = loan as ChainLoan & {
      disbursementSource?: string; subLocationId?: string | null;
    };
    if ([...disbursementGroups].some((group) => feeGroups.has(group)) ||
        loanRows.length !== issueRows.length + feeRows.length ||
        issueRows.some((row) =>
          !(row.categoryName === "Loans Receivable" && row.type === "debit" &&
            row.loanId === loan.id || row.categoryName === "Cash" && row.type === "credit") ||
          !(row.transactionDate instanceof Date) ||
          row.transactionDate.getTime() !== loan.startDate.getTime() ||
          (row.categoryName === "Cash" && !matchesCashLocation(row,
            source.disbursementSource, source.subLocationId))) ||
        feeRows.some((row) =>
          !(row.categoryName === "Cash" && row.type === "debit" ||
            row.categoryName === "Issuance Fees" && row.type === "credit" &&
            row.loanId === loan.id) ||
          !(row.transactionDate instanceof Date) ||
          row.transactionDate.getTime() !== loan.startDate.getTime() ||
          (row.categoryName === "Cash" && !matchesCashLocation(row,
            source.disbursementSource, source.subLocationId)))) {
      throw new Error(`Rollover source loan journal date, category, or cash location differs: ${loan.id}`);
    }
    if (!journalNet(issueRows, "Loans Receivable", "debit", "loan", loan.id, loan.id)
      .eq(loan.rolledOverFrom ? fresh : loan.principalAmount) ||
        !journalNet(issueRows, "Cash", "credit", "loan", loan.id).eq(
          loan.rolledOverFrom ? fresh : loan.principalAmount)) {
      throw new Error(`Rollover source disbursement does not reconcile: ${loan.id}`);
    }
    if (!journalNet(feeRows, "Issuance Fees", "credit", "loan", loan.id, loan.id)
      .eq(loan.issuanceFee) ||
        !journalNet(feeRows, "Cash", "debit", "loan", loan.id).eq(loan.issuanceFee)) {
      throw new Error(`Rollover source issuance fee does not reconcile: ${loan.id}`);
    }
    if (loan.rolledOverFrom) {
      const carried = new BigNumber(loan.rolloverAmount ?? "0");
      const incoming = journalNet(rows, "Loans Receivable", "debit", "rollover",
        loan.rolledOverFrom, loan.id);
      const interest = journalNet(rows, "Interest Earned", "credit", "rollover",
        loan.rolledOverFrom, loan.id);
      const principal = journalNet(rows, "Loans Receivable", "credit", "rollover",
        loan.id, loan.rolledOverFrom);
      // The loan stores whole UGX while the original journal may retain cents.
      // Only the stored-vs-journal comparison is rounded; journal legs must
      // still reconcile to each other exactly.
      if (!carried.isFinite() || !carried.isInteger() ||
          !incoming.isFinite() || !principal.plus(interest).eq(incoming) ||
          !new BigNumber(incoming.toFixed(0, BigNumber.ROUND_HALF_UP)).eq(carried)) {
        throw new Error(`Rollover source transfer does not reconcile: ${loan.id}`);
      }
      const rolloverRows = rows.filter((row) => row.referenceType === "rollover" &&
        (row.referenceId === loan.id || row.referenceId === loan.rolledOverFrom) &&
        (row.loanId === loan.id || row.loanId === loan.rolledOverFrom));
      if (rolloverRows.some((row) => !(row.transactionDate instanceof Date) ||
          row.transactionDate.getTime() !== loan.startDate.getTime())) {
        throw new Error(`Rollover source transfer journal date differs: ${loan.id}`);
      }
    }
    for (const payment of loan.payments) {
      const currentRows = assertDatedSettlement(rows, payment.id,
        ["payment", "payment_reversal"], payment.paymentDate, `payment ${payment.id}`);
      const successor = snapshot.loans.find((candidate) => candidate.rolledOverFrom === loan.id);
      if (successor && payment.paymentDate >= successor.startDate &&
          payment.paymentDate <= rolloverPaymentCutoff(loan.startDate, successor.startDate) &&
          currentRows.some((row) => row.loanId !== loan.id)) {
        throw new Error(`Same-day predecessor payment ${payment.id} has another loan's journal leg`);
      }
      const sourcePayment = payment as typeof payment & {
        depositLocation?: string; subLocationId?: string | null;
      };
      const cashRows = currentRows.filter((row) => row.categoryName === "Cash");
      const cashByLocation = new Map<string, BigNumber>();
      for (const row of cashRows) {
        const key = JSON.stringify([row.depositLocation, row.subLocationId ?? null]);
        const previous = cashByLocation.get(key) ?? new BigNumber(0);
        cashByLocation.set(key, row.type === "debit"
          ? previous.plus(row.amount) : previous.minus(row.amount));
      }
      if (!sourcePayment.depositLocation || [...cashByLocation.entries()].some(([key, amount]) =>
          !amount.eq(JSON.stringify([sourcePayment.depositLocation,
            sourcePayment.subLocationId ?? null]) === key ? payment.amount : 0))) {
        throw new Error(`Rollover source payment cash location differs: ${payment.id}`);
      }
      const cash = ["payment", "payment_reversal"].reduce((sum, kind) =>
        sum.plus(journalNet(rows, "Cash", "debit", kind, payment.id)),
      new BigNumber(0));
      const allocation = (category: string) => ["payment", "payment_reversal"]
        .reduce((sum, kind) => sum.plus(journalNet(rows, category, "credit", kind,
          payment.id, loan.id)), new BigNumber(0));
      if (!cash.eq(payment.amount) ||
          !allocation("Interest Earned").eq(payment.interestPortion) ||
          !allocation("Loans Receivable").eq(payment.principalPortion) ||
          !allocation("Overpayment Revenue").eq(payment.overpaymentPortion ?? "0")) {
        throw new Error(`Rollover source payment does not reconcile: ${payment.id}`);
      }
    }
    for (const waiver of loan.waivers) {
      if (waiver.id) assertDatedSettlement(rows, waiver.id,
        ["loan_waiver", "loan_waiver_reversal"], waiver.waiverDate, `waiver ${waiver.id}`);
      if (!waiver.id || !journalNet(rows, "Loan Losses", "debit", "loan_waiver",
        waiver.id).eq(waiver.amount) ||
          !journalNet(rows, "Interest Earned", "credit", "loan_waiver",
            waiver.id, loan.id).eq(waiver.interestPortion) ||
          !journalNet(rows, "Loans Receivable", "credit", "loan_waiver",
            waiver.id, loan.id).eq(waiver.principalPortion)) {
        throw new Error(`Rollover source waiver does not reconcile: ${waiver.id ?? "unknown"}`);
      }
    }
    const receivable = rows.filter((row) => row.loanId === loan.id &&
      row.categoryName === "Loans Receivable").reduce((sum, row) =>
      row.type === "debit" ? sum.plus(row.amount) : sum.minus(row.amount),
    new BigNumber(0));
    const settledPrincipal = [...loan.payments, ...loan.waivers]
      .reduce((sum, row) => sum.plus(row.principalPortion), new BigNumber(0));
    const expected = successors.has(loan.id) ? new BigNumber(0)
      : new BigNumber(loan.principalAmount).minus(settledPrincipal);
    if (receivable.minus(expected).abs().gte(1)) {
      throw new Error(`Rollover source receivable does not reconcile: ${loan.id}`);
    }
  }
}

/** Day-by-day source calculation; deliberately does not call the statement or carry planner. */
function independentlyDue(loan: ChainLoan, principal: string, until: Date,
  payments: ChainLoan["payments"], waivers: ChainLoan["waivers"]): {
    principal: BigNumber; interest: BigNumber;
  } {
  if (loan.loanType !== "perpetual" || until < loan.startDate) {
    throw new Error("Rollover source date or loan type is invalid");
  }
  const sortedPayments = [...payments].sort((a, b) =>
    a.paymentDate.getTime() - b.paymentDate.getTime());
  const sortedWaivers = [...waivers].sort((a, b) =>
    a.waiverDate.getTime() - b.waiverDate.getTime());
  const rates = [...loan.rateChanges].sort((a, b) =>
    a.effectiveDate.getTime() - b.effectiveDate.getTime());
  const opening = new Decimal(principal);
  let balance = opening;
  let baseRate = new Decimal(rates.length
    ? rates[0].fromRate : loan.interestRateOverride ?? loan.interestRate);
  let paid = new Decimal(0);
  let waived = new Decimal(0);
  let accrued = new Decimal(0);
  let nextPayment = 0;
  let nextWaiver = 0;
  let nextRate = 0;
  const elapsedDay = (date: Date) =>
    Math.floor((date.getTime() - loan.startDate.getTime()) / DAY_MS);
  while (nextRate < rates.length && elapsedDay(rates[nextRate].effectiveDate) <= 0) {
    baseRate = new Decimal(rates[nextRate++].toRate);
  }
  const days = Math.max(0, elapsedDay(until));
  let penaltyActive = false;
  const multiplier = new Decimal(loan.penaltyMultiplier ?? "0.1000");
  for (let day = 1; day <= days; day++) {
    const date = new Date(loan.startDate.getTime() + day * DAY_MS);
    const dailyBase = balance.times(baseRate).div(30);
    const unpaidBefore = Decimal.max(accrued.minus(paid).minus(waived), 0);
    const overdueDays = dailyBase.isZero() ? 0
      : Math.floor(unpaidBefore.div(dailyBase).toNumber());
    const penaltyWaived = loan.penaltyWaived &&
      (!loan.penaltyWaivedAt || loan.penaltyWaivedAt <= date);
    penaltyActive = overdueDays >= PENALTY_THRESHOLD_DAYS && !penaltyWaived;
    const effectiveRate = penaltyActive ? baseRate.times(new Decimal(1).plus(multiplier))
      : baseRate;
    accrued = accrued.plus(balance.times(effectiveRate).div(30));
    while (nextRate < rates.length && elapsedDay(rates[nextRate].effectiveDate) <= day) {
      baseRate = new Decimal(rates[nextRate++].toRate);
    }
    while (nextPayment < sortedPayments.length &&
        elapsedDay(sortedPayments[nextPayment].paymentDate) <= day) {
      const row = sortedPayments[nextPayment++];
      balance = Decimal.max(balance.minus(row.principalPortion), 0);
      paid = paid.plus(row.interestPortion);
    }
    while (nextWaiver < sortedWaivers.length &&
        elapsedDay(sortedWaivers[nextWaiver].waiverDate) <= day) {
      const row = sortedWaivers[nextWaiver++];
      balance = Decimal.max(balance.minus(row.principalPortion), 0);
      waived = waived.plus(row.interestPortion);
    }
  }
  const settled = paid.plus(waived);
  const actualUnpaid = Decimal.max(accrued.minus(settled), 0);
  const minDays = loan.rolledOverFrom ? 0
    : loan.minPeriodOverride ?? loan.minInterestDays;
  const closingRate = penaltyActive ? baseRate.times(new Decimal(1).plus(multiplier))
    : baseRate;
  const minimum = Decimal.max(opening.times(closingRate)
    .times(Math.max(minDays, 0)).div(30).minus(settled), 0);
  return { principal: new BigNumber(whole(balance)),
    interest: new BigNumber(whole(Decimal.max(actualUnpaid, minimum))) };
}

function replay(loan: ChainLoan, principal: string, before?: Date): Replayed {
  const payments: ChainLoan["payments"] = [];
  const waivers: ChainLoan["waivers"] = [];
  const changes: SettlementChange[] = [];
  const events = [
    ...loan.payments.map((row) => ({ kind: "payment" as const, date: row.paymentDate, row })),
    ...loan.waivers.map((row) => ({ kind: "waiver" as const, date: row.waiverDate, row })),
  ].filter((event) => !before || event.date <= before)
    .sort((a, b) => a.date.getTime() - b.date.getTime() ||
      a.kind.localeCompare(b.kind) || (a.row.id ?? "").localeCompare(b.row.id ?? ""));
  for (const [index, event] of events.entries()) {
    if (!event.row.id || event.date <= loan.startDate ||
        (index > 0 && events[index - 1].date.getTime() === event.date.getTime())) {
      throw new Error("Rollover settlement has ambiguous identity or effective date");
    }
    const state = independentlyDue(
      { ...loan,
        interestRate: loan.rateChanges[0]?.fromRate ?? loan.interestRate,
        interestRateOverride: loan.rateChanges.length ? null : loan.interestRateOverride,
        penaltyWaived: loan.penaltyWaived && !!loan.penaltyWaivedAt &&
          loan.penaltyWaivedAt <= event.date,
        penaltyWaivedAt: loan.penaltyWaivedAt && loan.penaltyWaivedAt <= event.date
          ? loan.penaltyWaivedAt : null,
        rateChanges: loan.rateChanges.filter((rate) => rate.effectiveDate <= event.date) },
      principal, event.date, payments, waivers);
    const amount = new BigNumber(event.row.amount);
    if (!amount.isFinite() || amount.lt(0)) throw new Error("Invalid rollover settlement amount");
    const interest = BigNumber.min(amount, state.interest);
    const principalPart = BigNumber.min(amount.minus(interest), state.principal);
    const overpayment = event.kind === "payment"
      ? amount.minus(interest).minus(principalPart) : new BigNumber(0);
    if (amount.minus(interest).minus(principalPart).minus(overpayment).abs().gte(0.01)) {
      throw new Error("Rollover settlement exceeds corrected amount due");
    }
    const change: SettlementChange = {
      id: event.row.id, loanId: loan.id, kind: event.kind, date: event.date,
      amount: money(amount), oldInterest: event.row.interestPortion,
      oldPrincipal: event.row.principalPortion,
      oldOverpayment: event.kind === "payment" ? event.row.overpaymentPortion ?? "0" : "0",
      newInterest: money(interest), newPrincipal: money(principalPart),
      newOverpayment: money(overpayment),
    };
    changes.push(change);
    if (event.kind === "payment") payments.push({ ...event.row,
      interestPortion: change.newInterest, principalPortion: change.newPrincipal,
      overpaymentPortion: change.newOverpayment });
    else waivers.push({ ...event.row, interestPortion: change.newInterest,
      principalPortion: change.newPrincipal });
  }
  return { payments, waivers, changes };
}

export type RolloverEvidence = {
  chainRootId: string;
  sourceDigests: Array<{ loanId: string; digest: string }>;
  sourceJournalGroups: number;
  edges: Array<{ predecessorId: string; successorId: string; freshCash: string;
    carriedPrincipal: string; carriedInterest: string; proposedPrincipal: string }>;
  settlements: Array<{ id: string; loanId: string; interest: string;
    principal: string; overpayment: string }>;
  projectedJournalGroups: Array<{ referenceId: string; kind: string;
    legs: Array<{ category: string; type: "debit" | "credit"; amount: string }> }>;
};

function projectedJournals(plan: CorrectionPlan,
  rows: RolloverSourceJournal[]): RolloverEvidence["projectedJournalGroups"] {
  const groups: RolloverEvidence["projectedJournalGroups"] = [];
  const add = (referenceId: string, kind: string,
    legs: Array<{ category: string; type: "debit" | "credit"; amount: BigNumber }>) => {
    const nonzero = legs.filter((leg) => !leg.amount.isZero());
    if (!nonzero.length) return;
    const balance = nonzero.reduce((sum, leg) => leg.type === "debit"
      ? sum.plus(leg.amount) : sum.minus(leg.amount), new BigNumber(0));
    if (!balance.isZero() || nonzero.some((leg) =>
      leg.amount.lte(0) || !leg.amount.isFinite() ||
      ["Cash", "Loan Losses"].includes(leg.category))) {
      throw new Error("Proposed rollover journal group is unbalanced or touches cash/loss");
    }
    groups.push({ referenceId, kind, legs: nonzero.map((leg) => ({
      category: leg.category, type: leg.type, amount: money(leg.amount),
    })) });
  };
  for (const change of plan.settlementChanges) {
    const deltas = [
      { category: "Loans Receivable", value: new BigNumber(change.newPrincipal)
        .minus(change.oldPrincipal) },
      { category: "Interest Earned", value: new BigNumber(change.newInterest)
        .minus(change.oldInterest) },
      { category: "Overpayment Revenue", value: new BigNumber(change.newOverpayment)
        .minus(change.oldOverpayment) },
    ];
    add(change.id, "settlement reclassification", deltas.map(({ category, value }) => ({
      category, type: value.gt(0) ? "credit" as const : "debit" as const,
      amount: value.abs(),
    })));
  }
  for (const edge of plan.edges) {
    const oldInterest = journalNet(rows, "Interest Earned", "credit", "rollover",
      edge.predecessorId, edge.successorId);
    const oldPrincipal = journalNet(rows, "Loans Receivable", "credit", "rollover",
      edge.successorId, edge.predecessorId);
    const interestDelta = new BigNumber(edge.carriedInterest!).minus(oldInterest);
    const principalDelta = new BigNumber(edge.carriedPrincipal!).minus(oldPrincipal);
    add(edge.predecessorId, "interest carry", [
      { category: "Loans Receivable", type: interestDelta.gt(0)
        ? "debit" : "credit", amount: interestDelta.abs() },
      { category: "Interest Earned", type: interestDelta.gt(0)
        ? "credit" : "debit", amount: interestDelta.abs() },
    ]);
    add(edge.predecessorId, "principal transfer", [
      { category: "Loans Receivable", type: principalDelta.gt(0)
        ? "debit" : "credit", amount: principalDelta.abs() },
      { category: "Loans Receivable", type: principalDelta.gt(0)
        ? "credit" : "debit", amount: principalDelta.abs() },
    ]);
  }
  return groups;
}

/** Rebuild dated carry and allocations from source chain facts, without reading proposal totals. */
export function verifyRolloverCorrectionEvidence(
  snapshot: ChainSnapshot, plan: CorrectionPlan, journals: RolloverSourceJournal[],
): RolloverEvidence {
  if (plan.classification === "blocked" || !plan.edges.length ||
      snapshot.loans.length !== plan.edges.length + 1 ||
      snapshot.loans.some((loan) => !loan.sourceDigest || loan.sourceExceptions?.length ||
        !loan.sourceExceptions || loan.deletedAt)) {
    throw new Error("Rollover source chain is incomplete or unreconciled");
  }
  if (snapshot.loans.some((loan) => loan.rateChanges.length || loan.penaltyWaived)) {
    throw new Error("Rollover rate-change or penalty-waiver history needs separate source verification");
  }
  const byId = new Map(snapshot.loans.map((loan) => [loan.id, loan]));
  if (byId.size !== snapshot.loans.length) throw new Error("Duplicate rollover loan source");
  const sourceRows = sourceRowsForChain(snapshot, journals);
  assertSourceReconciles(snapshot, sourceRows);
  const corrected = new Map<string, string>();
  const allChanges: SettlementChange[] = [];
  const edges: RolloverEvidence["edges"] = [];
  for (const edge of plan.edges) {
    const predecessor = byId.get(edge.predecessorId);
    const successor = byId.get(edge.successorId);
    if (!predecessor || !successor || successor.rolledOverFrom !== predecessor.id ||
        successor.startDate <= predecessor.startDate || predecessor.loanType !== "perpetual") {
      throw new Error("Rollover source path or effective dates changed");
    }
    const principal = corrected.get(predecessor.id) ?? predecessor.principalAmount;
    const paymentCutoff = rolloverPaymentCutoff(predecessor.startDate, successor.startDate);
    if (predecessor.payments.some((p) => paymentAfterRollover(
      predecessor.startDate, successor.startDate, p.paymentDate)) ||
        predecessor.waivers.some((w) => w.waiverDate >= successor.startDate) ||
        predecessor.rateChanges.some((r) => r.effectiveDate >= successor.startDate) ||
        (predecessor.penaltyWaivedAt && predecessor.penaltyWaivedAt >= successor.startDate)) {
      throw new Error("Rollover predecessor has an event on or after effective date");
    }
    const replayed = replay(predecessor, principal, paymentCutoff);
    allChanges.push(...replayed.changes);
    const state = independentlyDue(
      { ...predecessor,
        interestRate: predecessor.rateChanges[0]?.fromRate ?? predecessor.interestRate,
        interestRateOverride: predecessor.rateChanges.length ? null
          : predecessor.interestRateOverride },
      principal, paymentCutoff, replayed.payments, replayed.waivers);
    const freshCash = new BigNumber(successor.principalAmount)
      .minus(successor.rolloverAmount ?? "0");
    const carriedPrincipal = state.principal;
    const carriedInterest = state.interest;
    const proposedPrincipal = freshCash.plus(carriedPrincipal).plus(carriedInterest);
    if (!freshCash.isFinite() || freshCash.lt(0) ||
        !new BigNumber(edge.freshCash).eq(freshCash) ||
        !new BigNumber(edge.carriedPrincipal ?? NaN).eq(carriedPrincipal) ||
        !new BigNumber(edge.carriedInterest ?? NaN).eq(carriedInterest) ||
        !new BigNumber(edge.proposedRolloverAmount).eq(whole(carriedPrincipal.plus(carriedInterest))) ||
        !new BigNumber(edge.proposedPrincipal).eq(whole(proposedPrincipal)) ||
        !new BigNumber(edge.deltaPrincipal).eq(new BigNumber(edge.proposedPrincipal)
          .minus(successor.principalAmount))) {
      throw new Error(`Rollover carry or proposed journal effect differs from source: ${successor.id}`);
    }
    corrected.set(successor.id, edge.proposedPrincipal);
    edges.push({ predecessorId: predecessor.id, successorId: successor.id,
      freshCash: money(freshCash), carriedPrincipal: money(carriedPrincipal),
      carriedInterest: money(carriedInterest), proposedPrincipal: money(proposedPrincipal) });
  }
  const last = byId.get(plan.edges.at(-1)!.successorId)!;
  allChanges.push(...replay(last, corrected.get(last.id) ?? last.principalAmount).changes);
  const changeKey = (change: SettlementChange) => `${change.loanId}:${change.kind}:${change.id}`;
  const proposed = new Map(plan.settlementChanges.map((change) => [changeKey(change), change]));
  if (proposed.size !== allChanges.length ||
      allChanges.some((change) => {
        const actual = proposed.get(changeKey(change));
        return !actual || actual.date.getTime() !== change.date.getTime() ||
          !["amount", "oldInterest", "oldPrincipal", "oldOverpayment", "newInterest",
            "newPrincipal", "newOverpayment"].every((key) =>
            new BigNumber(actual[key as keyof SettlementChange] as string)
              .eq(change[key as keyof SettlementChange] as string));
      })) {
    throw new Error("Rollover settlement allocation differs from source replay");
  }
  return { chainRootId: plan.edges[0].predecessorId,
    sourceDigests: snapshot.loans.map((loan) => ({ loanId: loan.id,
      digest: loan.sourceDigest! })).sort((a, b) => a.loanId.localeCompare(b.loanId)),
    sourceJournalGroups: new Set(sourceRows.map((row) => row.journalGroupId)).size,
    edges, settlements: allChanges.map((change) => ({ id: change.id, loanId: change.loanId,
      interest: change.newInterest, principal: change.newPrincipal,
      overpayment: change.newOverpayment })),
    projectedJournalGroups: projectedJournals(plan, sourceRows) };
}
