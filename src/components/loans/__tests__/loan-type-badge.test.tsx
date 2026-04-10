// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import "@testing-library/jest-dom/vitest"
import { render, screen } from "@testing-library/react"
import { LoanTypeBadge } from "../loan-type-badge"

describe("LoanTypeBadge", () => {
  it("renders 'Fixed Rate' for fixed_rate type", () => {
    render(<LoanTypeBadge loanType="fixed_rate" />)
    expect(screen.getByText("Fixed Rate")).toBeInTheDocument()
  })

  it("renders 'Reducing Bal.' for reducing_balance type", () => {
    render(<LoanTypeBadge loanType="reducing_balance" />)
    expect(screen.getByText("Reducing Bal.")).toBeInTheDocument()
  })

  it("renders 'Perpetual' for unknown type", () => {
    render(<LoanTypeBadge loanType="something_else" />)
    expect(screen.getByText("Perpetual")).toBeInTheDocument()
  })

  it("renders as an inline badge element", () => {
    render(<LoanTypeBadge loanType="fixed_rate" />)
    const badge = screen.getByText("Fixed Rate")
    expect(badge).toBeVisible()
    expect(badge.tagName).toBe("SPAN")
  })
})
