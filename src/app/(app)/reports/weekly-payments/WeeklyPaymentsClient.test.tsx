// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const useWeeklyPaymentsReport = vi.fn()
vi.mock("@/hooks/use-weekly-reports", () => ({ useWeeklyPaymentsReport: (...args: unknown[]) => useWeeklyPaymentsReport(...args) }))
vi.mock("@/components/reports/weekly-report-toolbar", () => ({ WeeklyReportToolbar: () => <div /> }))

import { WeeklyPaymentsClient } from "./WeeklyPaymentsClient"

describe("WeeklyPaymentsClient", () => {
  beforeEach(() => useWeeklyPaymentsReport.mockReset())

  it("shows action errors without showing stale rows", () => {
    const retry = vi.fn()
    useWeeklyPaymentsReport.mockReturnValue({ data: undefined, isLoading: false, error: "Database error", retry })
    render(<WeeklyPaymentsClient week="2026-09-21" />)

    expect(screen.getByRole("alert").textContent).toContain("Could not load weekly payments")
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(retry).toHaveBeenCalledOnce()
    expect(screen.queryByText("Previous week customer")).toBeNull()
    expect(screen.queryByText("No payments for this week.")).toBeNull()
  })

  it("shows a valid empty result as loaded, not loading", () => {
    useWeeklyPaymentsReport.mockReturnValue({
      data: { week: "2026-09-21", calculatedAt: "2026-09-23T00:00:00.000Z", count: 0, total: "0.00", rows: [] },
      isLoading: false,
      error: undefined,
    })
    render(<WeeklyPaymentsClient week="2026-09-21" />)

    expect(screen.getByText("No payments for this week.")).toBeTruthy()
    expect(screen.queryByRole("status")).toBeNull()
  })
})
