// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { LoanRateHistoryDialog } from "./loan-rate-history-dialog"

const history = [
  {
    id: "audit-1",
    fromRate: "0.10",
    toRate: "0.12",
    actorId: "admin-1",
    actorName: "Admin User",
    changedAt: new Date("2026-08-03T12:00:00Z"),
  },
]

describe("LoanRateHistoryDialog", () => {
  it("renders old rate, new rate, actor, and timestamp", () => {
    render(<LoanRateHistoryDialog open history={history} onClose={vi.fn()} />)

    expect(screen.getByRole("heading", { name: "Interest Rate History" })).toBeVisible()
    expect(screen.getByText("10.0% → 12.0%")).toBeVisible()
    expect(screen.getByText("Admin User")).toBeVisible()
    expect(screen.getByText(/Aug 3, 2026/)).toBeVisible()
  })

  it("closes when the close button is clicked", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<LoanRateHistoryDialog open history={history} onClose={onClose} />)

    await user.click(screen.getByRole("button", { name: "Close" }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
