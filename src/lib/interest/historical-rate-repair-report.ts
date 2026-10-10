import BigNumber from "bignumber.js";
import type { HistoricalRatePlan } from "./historical-rate-repair";

export function buildHistoricalRateRepairReport(input: {
  databaseHost: string;
  databaseName: string;
  plan: HistoricalRatePlan;
}) {
  const { plan } = input;
  const totals = plan.changes.reduce((sum, change) => ({
    cash: sum.cash.plus(change.amount),
    interestDelta: sum.interestDelta.plus(change.newInterest).minus(change.oldInterest),
    principalDelta: sum.principalDelta.plus(change.newPrincipal).minus(change.oldPrincipal),
    overpaymentDelta: sum.overpaymentDelta.plus(change.newOverpayment)
      .minus(change.oldOverpayment),
  }), {
    cash: new BigNumber(0),
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
      interestReclassification: totals.interestDelta.toFixed(2),
      principalReclassification: totals.principalDelta.toFixed(2),
      overpaymentReclassification: totals.overpaymentDelta.toFixed(2),
      accruedInterestAfter: plan.accruedInterest,
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
