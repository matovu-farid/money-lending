// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { WeeklyReportToolbar } from "./weekly-report-toolbar"

const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }))

describe("WeeklyReportToolbar", () => {
  beforeEach(() => replace.mockClear())

  it("navigates by week and normalizes a chosen date to Monday", () => {
    render(<WeeklyReportToolbar week="2026-09-21" basePath="/reports/weekly-payments" />)

    fireEvent.click(screen.getByRole("button", { name: /previous week/i }))
    expect(replace).toHaveBeenLastCalledWith("/reports/weekly-payments?week=2026-09-14")

    fireEvent.click(screen.getByRole("button", { name: /next week/i }))
    expect(replace).toHaveBeenLastCalledWith("/reports/weekly-payments?week=2026-09-28")

    fireEvent.change(screen.getByLabelText(/week starting/i), { target: { value: "2026-09-23" } })
    expect(replace).toHaveBeenLastCalledWith("/reports/weekly-payments?week=2026-09-21")
  })
})
