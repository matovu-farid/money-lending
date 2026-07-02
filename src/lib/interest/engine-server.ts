"use server";

import BigNumber from "bignumber.js";
import { computeSingleLoanBalanceData } from "./loanBalanceData";
import { formatAmount } from "./engine";

export async function allocateLoanPaymentServerSide(params: {
  paymentAmount: string;
  asOf: Date;
  loanId: string;

  /** Interest already collected from earlier payments within the same min-interest period */
  interestAlreadyPaidInPeriod?: string;
}) {
  const { paymentAmount, asOf, loanId } = params;

  const info = await computeSingleLoanBalanceData(loanId, asOf);

  const payment = new BigNumber(paymentAmount);

  const interestOwed = info.unpaidInterest;

  if (payment.isLessThanOrEqualTo(interestOwed)) {
    return {
      interestPortion: formatAmount(payment),
      principalPortion: "0.00",
      principalBalanceBefore: info.remainingPrincipalAmount,
      principalBalanceAfter: info.remainingPrincipalAmount,
      totalBalanceOwedAfter: formatAmount(
        BigNumber(info.totalBalanceOwed).minus(payment),
      ),
      loanFullyPaid: false,
      ...info,
    };
  }

  const principalBalanceBefore = BigNumber(info.remainingPrincipalAmount);
  const principalPortion = BigNumber.min(
    payment.minus(interestOwed),
    principalBalanceBefore,
  );
  const principalBalanceAfter = principalBalanceBefore.minus(principalPortion);
  

  return {
    interestPortion: interestOwed,
    principalPortion: formatAmount(principalPortion),
    principalBalanceBefore: formatAmount(principalBalanceBefore),
    principalBalanceAfter: formatAmount(principalBalanceAfter),
    totalBalanceOwedAfter: formatAmount(principalBalanceAfter),
    loanFullyPaid: principalBalanceAfter.isZero(),
    ...info,
  };
}
