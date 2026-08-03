// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { AdminRateAdjustmentDialog } from "./admin-rate-adjustment-dialog"

describe("AdminRateAdjustmentDialog", () => {
  it("submits a percentage as a normalized decimal", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <AdminRateAdjustmentDialog
        open
        currentRate="0.10"
        isPending={false}
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    )

    const input = screen.getByLabelText("New Rate (% per month)")
    await user.clear(input)
    await user.type(input, "12")
    await user.click(screen.getByRole("button", { name: "Save Rate" }))

    expect(onSubmit).toHaveBeenCalledWith("0.1200")
  })

  it("disables save and input while pending", () => {
    const onSubmit = vi.fn()
    render(
      <AdminRateAdjustmentDialog
        open
        currentRate="0.10"
        isPending
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled()
    expect(screen.getByLabelText("New Rate (% per month)")).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("rejects an invalid rate", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <AdminRateAdjustmentDialog
        open
        currentRate="0.10"
        isPending={false}
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    )
    const input = screen.getByLabelText("New Rate (% per month)")
    await user.clear(input)
    await user.type(input, "0")
    await user.click(screen.getByRole("button", { name: "Save Rate" }))
    expect(screen.getByText("Rate must be between 0% and 100%.")).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
