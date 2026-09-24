// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { WeeklyReportToolbar } from "./weekly-report-toolbar"

const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }))

describe("WeeklyReportToolbar", () => {
  beforeEach(() => replace.mockClear())

  it("navigates by week and normalizes a chosen date to Monday", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-24T12:00:00.000Z"))
    render(<WeeklyReportToolbar week="2026-09-14" basePath="/reports/weekly-payments" />)

    fireEvent.click(screen.getByRole("button", { name: /previous week/i }))
    expect(replace).toHaveBeenLastCalledWith("/reports/weekly-payments?week=2026-09-07")

    fireEvent.click(screen.getByRole("button", { name: /next week/i }))
    expect(replace).toHaveBeenLastCalledWith("/reports/weekly-payments?week=2026-09-21")

    fireEvent.change(screen.getByLabelText(/week starting/i), { target: { value: "2026-09-23" } })
    expect(replace).toHaveBeenLastCalledWith("/reports/weekly-payments?week=2026-09-21")
    vi.useRealTimers()
  })

  it("disables next on the current week and caps date selection at its Sunday", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-24T12:00:00.000Z"))
    render(<WeeklyReportToolbar week="2026-09-21" basePath="/reports/weekly-payments" />)
    expect(screen.getByRole("button", { name: /next week/i }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByLabelText(/week starting/i).getAttribute("max")).toBe("2026-09-27")
    fireEvent.click(screen.getByRole("button", { name: /next week/i }))
    fireEvent.change(screen.getByLabelText(/week starting/i), { target: { value: "2026-09-28" } })
    expect(replace).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it("blocks navigation forward from a direct future week", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-24T12:00:00.000Z"))
    render(<WeeklyReportToolbar week="2026-11-02" basePath="/reports/weekly-payments" />)
    expect(screen.getByRole("button", { name: /next week/i }).hasAttribute("disabled")).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: /next week/i }))
    expect(replace).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it("updates the next-week control and date limit when Kampala enters Monday", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-27T20:59:30.000Z"))
    render(<WeeklyReportToolbar week="2026-09-21" basePath="/reports/weekly-payments" />)

    expect(screen.getByRole("button", { name: /next week/i }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByLabelText(/week starting/i).getAttribute("max")).toBe("2026-09-27")

    act(() => vi.advanceTimersByTime(30_000))

    expect(screen.getByRole("button", { name: /next week/i }).hasAttribute("disabled")).toBe(false)
    expect(screen.getByLabelText(/week starting/i).getAttribute("max")).toBe("2026-10-04")
    vi.useRealTimers()
  })
})
