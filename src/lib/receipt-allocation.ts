import BigNumber from "bignumber.js"

/**
 * Balance data used for client-side receipt allocation.
 * These values come from the loan balance query before the payment is recorded.
 */
export interface ReceiptBalanceData {
  accruedInterest: string
  totalBalance: string
}

/**
 * Computed receipt allocation breakdown for display on the receipt.
 * This is a client-side approximation used for the receipt UI only --
 * the authoritative allocation is computed server-side by the interest engine.
 */
export interface ReceiptAllocation {
  interestPortion: string
  principalPortion: string
  principalBalanceAfter: string
  outstandingBalanceAfter: string
}

/**
 * Computes the receipt allocation breakdown from a payment amount and
 * pre-payment balance data.
 *
 * Interest-first allocation:
 * 1. Interest portion = min(paymentAmount, accruedInterest)
 * 2. Principal portion = paymentAmount - interestPortion
 * 3. Balance after = max(totalBalance - paymentAmount, 0)
 *
 * Key invariant: outstandingBalanceAfter === balanceAfter (post-payment),
 * NOT the pre-payment totalBalance.
 */
export function computeReceiptAllocation(
  paymentAmount: string,
  balanceData: ReceiptBalanceData | null
): ReceiptAllocation {
  const paidAmt = new BigNumber(paymentAmount)
  const accrued = new BigNumber(balanceData?.accruedInterest ?? "0")
  const totalBefore = new BigNumber(balanceData?.totalBalance ?? "0")

  const interestPaid = BigNumber.min(paidAmt, accrued)
  const principalPaid = paidAmt.minus(interestPaid)
  const balanceAfter = BigNumber.max(totalBefore.minus(paidAmt), new BigNumber(0))

  return {
    interestPortion: interestPaid.toFixed(0),
    principalPortion: principalPaid.toFixed(0),
    principalBalanceAfter: balanceAfter.toFixed(0),
    outstandingBalanceAfter: balanceAfter.toFixed(0),
  }
}
