import { describe, expect, it } from "vitest"
import { filterLoansByCustomerName, filterLoansForExport } from "@/lib/loan-filters"

const loans = [
  { customerName: "Alice Nakato" },
  { customerName: "Bob Ssemakula" },
  { customerName: "ALICE KATO" },
]

describe("filterLoansByCustomerName", () => {
  it("matches case-insensitive customer-name substrings", () => {
    expect(filterLoansByCustomerName(loans, "lic")).toEqual([loans[0], loans[2]])
  })

  it("trims the query and returns all loans for whitespace or empty input", () => {
    expect(filterLoansByCustomerName(loans, "  ")).toEqual(loans)
    expect(filterLoansByCustomerName(loans, "")).toEqual(loans)
  })

  it("returns an empty list when no customer name matches", () => {
    expect(filterLoansByCustomerName(loans, "carol")).toEqual([])
  })

  it("composes customer-name and risk filters for exports", () => {
    const exportRows = [
      { customerName: "Alice Nakato", daysOverdue: 30 },
      { customerName: "Alice Kato", daysOverdue: 0 },
      { customerName: "Bob Ssemakula", daysOverdue: 30 },
    ]

    expect(
      filterLoansForExport(exportRows, { filter: "critical", customerName: "alice" }),
    ).toEqual([exportRows[0]])
  })
})
