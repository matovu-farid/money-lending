import { createHash } from "node:crypto";
import BigNumber from "bignumber.js";
import { buildLoanStatement, type BuildStatementInput } from "@/lib/loan-statement";

export type HistoricalSettlement = {
  id: string;
  kind: "payment" | "waiver";
  date: Date;
  amount: string;
  oldInterest: string;
  oldPrincipal: string;
  oldOverpayment: string;
};

export type HistoricalRateSnapshot = {
  loan: BuildStatementInput["loan"] & { termMonths?: number | null };
  correctedRate: string;
  asOf: Date;
  settlements: HistoricalSettlement[];
  sourceDigest: string;
  sourceExceptions: string[];
  correctionMarked?: boolean;
  postedAccrual?: string;
};

export type HistoricalSettlementChange = HistoricalSettlement & {
  newInterest: string;
  newPrincipal: string;
  newOverpayment: string;
};

export type HistoricalRatePlan = {
  loanId: string;
  asOf: Date;
  policyVersion: string;
  inputFingerprint: string;
  planHash: string;
  classification: "noop" | "review" | "blocked";
  exceptions: string[];
  changes: HistoricalSettlementChange[];
  correctedRate: string;
  accruedInterest: string | null;
  accrualJournalTarget: string | null;
  accrualJournalDelta: string | null;
  endingPrincipal: string | null;
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function money(value: BigNumber): string {
  return value.toFixed(2);
}

function validMoney(value: string): boolean {
  const amount = new BigNumber(value);
  return amount.isFinite() && amount.gte(0) && (amount.decimalPlaces() ?? Infinity) <= 2;
}

/** Pure preview. The caller must supply a reconciled, fingerprinted snapshot. */
export function planHistoricalRateRepair(
  snapshot: HistoricalRateSnapshot,
  policyVersion = "v1",
): HistoricalRatePlan {
  const settlements = [...snapshot.settlements].sort((a, b) =>
    a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
  const normalized = { ...snapshot, settlements,
    sourceExceptions: [...snapshot.sourceExceptions].sort() };
  const inputFingerprint = hash({ policyVersion, snapshot: normalized });
  const exceptions = [...normalized.sourceExceptions];
  if (!/^[a-f0-9]{64}$/.test(snapshot.sourceDigest)) {
    exceptions.push("Source digest is missing or invalid");
  }
  if (!Number.isFinite(snapshot.loan.startDate.getTime()) ||
      !Number.isFinite(snapshot.asOf.getTime()) ||
      snapshot.asOf < snapshot.loan.startDate) {
    exceptions.push("Loan start or as-of date is invalid");
  }
  const correctedRate = new BigNumber(snapshot.correctedRate);
  if (!correctedRate.isFinite() || correctedRate.lte(0)) {
    exceptions.push("Corrected rate is invalid");
  }
  const openingPrincipal = new BigNumber(snapshot.loan.principalAmount);
  if (!openingPrincipal.isFinite() || !openingPrincipal.isInteger()) {
    exceptions.push("Fractional UGX opening principal requires a cent-precise replay");
  }
  for (let i = 0; i < settlements.length; i++) {
    const settlement = settlements[i];
    if (!Number.isFinite(settlement.date.getTime()) ||
        settlement.date < snapshot.loan.startDate || settlement.date > snapshot.asOf) {
      exceptions.push(`Settlement ${settlement.id} has an invalid effective date`);
    }
    if (settlement.date.getTime() === snapshot.loan.startDate.getTime()) {
      exceptions.push(`Settlement ${settlement.id} is a start-day settlement requiring statement support`);
    }
    if (i > 0 && settlement.date.getTime() === settlements[i - 1].date.getTime()) {
      exceptions.push(`Settlement ${settlement.id} has an ambiguous same-time order`);
    }
    if (![settlement.amount, settlement.oldInterest, settlement.oldPrincipal,
      settlement.oldOverpayment].every(validMoney)) {
      exceptions.push(`Settlement ${settlement.id} has invalid monetary values`);
    } else if ([settlement.amount, settlement.oldInterest,
      settlement.oldPrincipal, settlement.oldOverpayment]
      .some((value) => !new BigNumber(value).isInteger())) {
      exceptions.push(`Settlement ${settlement.id} contains fractional UGX`);
    } else if (!new BigNumber(settlement.oldInterest)
      .plus(settlement.oldPrincipal).plus(settlement.oldOverpayment)
      .eq(settlement.amount)) {
      exceptions.push(`Settlement ${settlement.id} old allocation does not match its amount`);
    }
  }

  const changes: HistoricalSettlementChange[] = [];
  let accruedInterest: string | null = null;
  let endingPrincipal: string | null = null;
  if (exceptions.length === 0) {
    const correctedLoan = { ...snapshot.loan,
      interestRate: correctedRate.toFixed(4), interestRateOverride: null };
    const replayedPayments: BuildStatementInput["payments"] = [];
    const replayedWaivers: NonNullable<BuildStatementInput["waivers"]> = [];

    for (const event of settlements) {
      const statement = buildLoanStatement({ loan: correctedLoan,
        payments: replayedPayments, waivers: replayedWaivers, today: event.date });
      const amount = new BigNumber(event.amount);
      const unpaid = new BigNumber(statement.finalState.netUnpaidInterest);
      const principalBalance = new BigNumber(statement.finalState.principalBalance);
      const interest = BigNumber.min(amount, unpaid);
      const principal = BigNumber.min(amount.minus(interest), principalBalance);
      const overpayment = amount.minus(interest).minus(principal);
      if (event.kind === "waiver" && !overpayment.isZero()) {
        exceptions.push(`Waiver ${event.id} exceeds corrected amount due`);
        break;
      }
      const change: HistoricalSettlementChange = {
        ...event,
        newInterest: money(interest),
        newPrincipal: money(principal),
        newOverpayment: money(overpayment),
      };
      changes.push(change);
      if (event.kind === "payment") {
        replayedPayments.push({
          paymentDate: event.date,
          amount: event.amount,
          interestPortion: change.newInterest,
          principalPortion: change.newPrincipal,
          recorderName: "",
        });
      } else {
        replayedWaivers.push({
          waiverDate: event.date,
          amount: event.amount,
          interestPortion: change.newInterest,
          principalPortion: change.newPrincipal,
          reason: "historical rate repair",
        });
      }
    }
    if (exceptions.length === 0) {
      const finalStatement = buildLoanStatement({ loan: correctedLoan,
        payments: replayedPayments, waivers: replayedWaivers, today: snapshot.asOf });
      accruedInterest = finalStatement.finalState.cumulativeInterestAccrued;
      endingPrincipal = finalStatement.finalState.principalBalance;
      const expectedPrincipal = openingPrincipal.minus(changes.reduce((sum, change) =>
        sum.plus(change.newPrincipal), new BigNumber(0)));
      if (!new BigNumber(endingPrincipal).eq(expectedPrincipal)) {
        exceptions.push("Final statement principal does not match replayed settlements");
      }
    }
  }

  const hasAllocationDelta = changes.some((change) =>
    !new BigNumber(change.newInterest).eq(change.oldInterest) ||
    !new BigNumber(change.newPrincipal).eq(change.oldPrincipal) ||
    !new BigNumber(change.newOverpayment).eq(change.oldOverpayment));
  const accrualJournalTarget = accruedInterest === null ? null : BigNumber.max(
    new BigNumber(accruedInterest).minus(changes.reduce((sum, change) =>
      sum.plus(change.newInterest), new BigNumber(0))), 0).toFixed(2);
  const accrualJournalDelta = accrualJournalTarget === null ||
    snapshot.postedAccrual === undefined ? null :
    new BigNumber(accrualJournalTarget).minus(snapshot.postedAccrual).toFixed(2);
  const accrualDelta = accrualJournalDelta !== null &&
    !new BigNumber(accrualJournalDelta).isZero();
  const classification: HistoricalRatePlan["classification"] = exceptions.length ? "blocked" :
    hasAllocationDelta || accrualDelta || !snapshot.correctionMarked ? "review" : "noop";
  const planBody = { loanId: snapshot.loan.id, asOf: snapshot.asOf,
    policyVersion, inputFingerprint,
    classification, exceptions, changes, correctedRate: snapshot.correctedRate,
    accruedInterest, accrualJournalTarget, accrualJournalDelta, endingPrincipal };
  return { ...planBody, planHash: hash(planBody) };
}
