import BigNumber from "bignumber.js"

export function isBalanceSheetBalanced(
  assets: string,
  liabilitiesPlusEquity: string,
): boolean {
  return (
    new BigNumber(assets).toFixed(0) ===
    new BigNumber(liabilitiesPlusEquity).toFixed(0)
  )
}
