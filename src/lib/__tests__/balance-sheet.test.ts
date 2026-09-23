import { describe, expect, it } from "vitest"
import { isBalanceSheetBalanced } from "@/lib/balance-sheet"

describe("isBalanceSheetBalanced", () => {
  it("treats amounts that display to the same whole UGX as balanced", () => {
    expect(isBalanceSheetBalanced("520672007.00", "520672006.99")).toBe(true)
  })

  it("detects a one-UGX displayed difference", () => {
    expect(isBalanceSheetBalanced("520672007.00", "520672006.00")).toBe(false)
  })
})
