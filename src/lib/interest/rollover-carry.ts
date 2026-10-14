import { buildLoanStatement, type BuildStatementInput } from "@/lib/loan-statement";
import { paymentAfterRollover, rolloverPaymentCutoff } from "./rollover-payment-boundary";

/** A non-cash transfer quote at the successor's effective date. */
export function quoteRolloverCarry(input: {
  loan: BuildStatementInput["loan"];
  asOf: Date;
  payments: BuildStatementInput["payments"];
  waivers: NonNullable<BuildStatementInput["waivers"]>;
  rateChanges?: BuildStatementInput["rateChanges"];
  openingInterestSettled?: string;
}): { carriedPrincipal: string; carriedInterest: string } {
  if (input.loan.loanType !== "perpetual") {
    throw new Error("Scheduled loan rollovers require a separate amortization review");
  }
  if (input.loan.penaltyWaivedAt && input.loan.penaltyWaivedAt >= input.asOf) {
    throw new Error("Predecessor penalty waiver was recorded on or after the rollover effective date");
  }
  if (input.asOf.getTime() < input.loan.startDate.getTime()) {
    throw new Error("Rollover date precedes the predecessor's start date");
  }
  const paymentCutoff = rolloverPaymentCutoff(input.loan.startDate, input.asOf);
  if (
    input.payments.some((p) => paymentAfterRollover(
      input.loan.startDate, input.asOf, p.paymentDate)) ||
    input.waivers.some((w) => w.waiverDate >= input.asOf) ||
    input.rateChanges?.some((r) => r.effectiveDate >= input.asOf)
  ) {
    throw new Error("Predecessor has an event on or after the rollover effective date");
  }
  const statement = buildLoanStatement({
    ...input,
    today: paymentCutoff,
  });
  return {
    carriedPrincipal: statement.finalState.principalBalance,
    carriedInterest: statement.finalState.netUnpaidInterest,
  };
}
