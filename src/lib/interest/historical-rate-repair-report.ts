import BigNumber from "bignumber.js";
import type { HistoricalRatePlan } from "./historical-rate-repair";

/** An exact instant avoids silently excluding receipts later on a date. */
export function parseHistoricalRateAsOf(value: string | undefined, now = new Date()): Date {
  if (!value ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error("An explicit --as-of ISO instant with timezone is required");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("Invalid --as-of instant");
  }
  if (parsed > now) {
    throw new Error("Historical repair as-of instant cannot be in the future");
  }
  return parsed;
}

export function buildHistoricalRateRepairReport(input: {
  databaseHost: string;
  databaseName: string;
  plan: HistoricalRatePlan;
}) {
  const { plan } = input;
  const totals = plan.changes.reduce((sum, change) => ({
    cash: change.kind === "payment" ? sum.cash.plus(change.amount) : sum.cash,
    waived: change.kind === "waiver" ? sum.waived.plus(change.amount) : sum.waived,
    interestDelta: sum.interestDelta.plus(change.newInterest).minus(change.oldInterest),
    principalDelta: sum.principalDelta.plus(change.newPrincipal).minus(change.oldPrincipal),
    overpaymentDelta: sum.overpaymentDelta.plus(change.newOverpayment)
      .minus(change.oldOverpayment),
  }), {
    cash: new BigNumber(0),
    waived: new BigNumber(0),
    interestDelta: new BigNumber(0),
    principalDelta: new BigNumber(0),
    overpaymentDelta: new BigNumber(0),
  });
  return {
    summary: {
      databaseHost: input.databaseHost,
      databaseName: input.databaseName,
      loanId: plan.loanId,
      asOf: plan.asOf.toISOString(),
      policyVersion: plan.policyVersion,
      classification: plan.classification,
      reviewable: plan.classification === "review",
      inputFingerprint: plan.inputFingerprint,
      planHash: plan.planHash,
      correctedRate: plan.correctedRate,
      settlementCount: plan.changes.length,
      unchangedCashTotal: totals.cash.toFixed(2),
      waivedTotal: totals.waived.toFixed(2),
      interestReclassification: totals.interestDelta.toFixed(2),
      principalReclassification: totals.principalDelta.toFixed(2),
      overpaymentReclassification: totals.overpaymentDelta.toFixed(2),
      accruedInterestAfter: plan.accruedInterest,
      accrualJournalTarget: plan.accrualJournalTarget,
      accrualJournalDelta: plan.accrualJournalDelta,
      endingPrincipalAfter: plan.endingPrincipal,
    },
    settlements: plan.changes.map((change) => ({
      id: change.id,
      kind: change.kind,
      date: change.date.toISOString(),
      amount: change.amount,
      oldInterest: change.oldInterest,
      oldPrincipal: change.oldPrincipal,
      oldOverpayment: change.oldOverpayment,
      newInterest: change.newInterest,
      newPrincipal: change.newPrincipal,
      newOverpayment: change.newOverpayment,
    })),
    exceptions: plan.exceptions,
  };
}
