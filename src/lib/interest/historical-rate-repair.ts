import { createHash } from "node:crypto";
import BigNumber from "bignumber.js";
import { buildLoanStatement, type BuildStatementInput } from "@/lib/loan-statement";
import { allocatePayment, clampAllocationToUnpaidInterest } from "./engine";
import { toLoanType } from "@/types";

const DAY_MS = 24 * 60 * 60 * 1000;

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
  for (let i = 0; i < settlements.length; i++) {
    const settlement = settlements[i];
    if (!Number.isFinite(settlement.date.getTime()) ||
        settlement.date < snapshot.loan.startDate || settlement.date > snapshot.asOf) {
      exceptions.push(`Settlement ${settlement.id} has an invalid effective date`);
    }
    if (i > 0 && settlement.date.getTime() === settlements[i - 1].date.getTime()) {
      exceptions.push(`Settlement ${settlement.id} has an ambiguous same-time order`);
    }
    if (![settlement.amount, settlement.oldInterest, settlement.oldPrincipal,
      settlement.oldOverpayment].every(validMoney)) {
      exceptions.push(`Settlement ${settlement.id} has invalid monetary values`);
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
    let previousSettlementDate = correctedLoan.startDate;
    let paymentCount = 0;

    for (const event of settlements) {
      const statement = buildLoanStatement({ loan: correctedLoan,
        payments: replayedPayments, waivers: replayedWaivers, today: event.date });
      const amount = new BigNumber(event.amount);
      const unpaid = new BigNumber(statement.finalState.netUnpaidInterest);
      const principalBalance = new BigNumber(statement.finalState.principalBalance);
      const interest = BigNumber.min(amount, unpaid);
      const principal = BigNumber.min(amount.minus(interest), principalBalance);
      const overpayment = amount.minus(interest).minus(principal);
      const effectiveRate = statement.finalState.penaltyActive
        ? correctedRate.multipliedBy(new BigNumber(1).plus(correctedLoan.penaltyMultiplier))
        : correctedRate;
      const rawQuote = allocatePayment({
        paymentAmount: event.amount,
        principalBalanceBefore: money(principalBalance),
        monthlyRateDecimal: effectiveRate.toFixed(4),
        daysElapsed: Math.floor((event.date.getTime() - previousSettlementDate.getTime()) / DAY_MS),
        minInterestDays: correctedLoan.minPeriodOverride ?? correctedLoan.minInterestDays,
        rolledOverFrom: correctedLoan.rolledOverFrom,
        loanType: toLoanType(correctedLoan.loanType),
        originalPrincipal: correctedLoan.principalAmount,
        termMonths: correctedLoan.termMonths ?? undefined,
        paymentNumber: event.kind === "payment" ? paymentCount + 1 : Math.max(paymentCount, 1),
      });
      const quote = clampAllocationToUnpaidInterest(rawQuote,
        event.amount, money(unpaid), money(principalBalance), effectiveRate.toFixed(4));
      if (!new BigNumber(quote.interestPortion).eq(interest) ||
          !new BigNumber(quote.principalPortion).eq(principal)) {
        exceptions.push(`Settlement ${event.id} differs from today's payment calculator`);
        break;
      }
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
        paymentCount += 1;
      } else {
        replayedWaivers.push({
          waiverDate: event.date,
          amount: event.amount,
          interestPortion: change.newInterest,
          principalPortion: change.newPrincipal,
          reason: "historical rate repair",
        });
      }
      previousSettlementDate = event.date;
    }
    if (exceptions.length === 0) {
      const finalStatement = buildLoanStatement({ loan: correctedLoan,
        payments: replayedPayments, waivers: replayedWaivers, today: snapshot.asOf });
      accruedInterest = finalStatement.finalState.cumulativeInterestAccrued;
      endingPrincipal = finalStatement.finalState.principalBalance;
    }
  }

  const hasAllocationDelta = changes.some((change) =>
    !new BigNumber(change.newInterest).eq(change.oldInterest) ||
    !new BigNumber(change.newPrincipal).eq(change.oldPrincipal) ||
    !new BigNumber(change.newOverpayment).eq(change.oldOverpayment));
  const accrualDelta = accruedInterest !== null && snapshot.postedAccrual !== undefined &&
    !new BigNumber(accruedInterest).eq(snapshot.postedAccrual);
  const classification: HistoricalRatePlan["classification"] = exceptions.length ? "blocked" :
    hasAllocationDelta || accrualDelta || !snapshot.correctionMarked ? "review" : "noop";
  const planBody = { loanId: snapshot.loan.id, asOf: snapshot.asOf,
    policyVersion, inputFingerprint,
    classification, exceptions, changes, correctedRate: snapshot.correctedRate,
    accruedInterest, endingPrincipal };
  return { ...planBody, planHash: hash(planBody) };
}
