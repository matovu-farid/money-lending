// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { LoanInterestRateCell } from "./loan-interest-rate-cell"

describe("LoanInterestRateCell", () => {
  it("shows the current rate and changed marker only for overridden rates", () => {
    const { rerender } = render(
      <LoanInterestRateCell rate="0.12" rateChanged />,
    )
    expect(screen.getByText("12.0% / month")).toBeVisible()
    expect(screen.getByText("Rate changed")).toBeVisible()

    rerender(<LoanInterestRateCell rate="0.10" rateChanged={false} />)
    expect(screen.getByText("10.0% / month")).toBeVisible()
    expect(screen.queryByText("Rate changed")).not.toBeInTheDocument()
  })
})
