// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { RecordPaymentForm } from "./record-payment-form"

const { mockInsertPaymentWithInput, mockToastSuccess } = vi.hoisted(() => ({
  mockInsertPaymentWithInput: vi.fn(),
  mockToastSuccess: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: mockToastSuccess, error: vi.fn() } }))
vi.mock("@/collections/payments", () => ({ insertPaymentWithInput: mockInsertPaymentWithInput }))
vi.mock("@/lib/client-id", () => ({ generateClientId: () => "payment-1" }))
vi.mock("@/lib/receipt-number", () => ({ generateReceiptNumber: () => "R-1" }))
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { name: "Officer" } } }) }))
vi.mock("@/lib/interest/engine", () => ({ allocateLoanPayment: vi.fn().mockResolvedValue({
  interestPortion: "0", principalPortion: "100", principalBalanceAfter: "900",
}) }))
vi.mock("@/components/receipts/pos-receipt-modal", () => ({
  PosReceiptModal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock("@/components/receipts/pos-receipt-repayment", () => ({ PosReceiptRepayment: () => null }))
vi.mock("@/components/ui/drawer-dialog", () => ({
  DrawerDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  DrawerDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/components/ui/dialog", () => ({
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/components/ui/date-picker", () => ({
  DatePicker: ({ id, value, onChange }: { id?: string; value: string; onChange: (value: string) => void }) => (
    <input id={id} aria-label={id} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))
vi.mock("@/components/ui/money-input", () => ({
  MoneyInput: ({ id, label, control, name }: { id?: string; label?: string; control: any; name: string }) => {
    const { useController } = require("react-hook-form") as typeof import("react-hook-form")
    const { field } = useController({ name, control })
    return <input id={id} aria-label={label} value={field.value ?? ""} onChange={field.onChange} />
  },
}))
vi.mock("@/components/ui/deposit-location-select", () => ({
  DepositLocationSelect: () => <div>Deposit Location</div>,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const props = {
  loanId: "loan-1",
  customerId: "customer-1",
  customerName: "Jane Doe",
  loanReference: "LOAN-1",
  loanStartDate: "2026-01-01",
  balanceData: { outstandingPrincipal: "1000", accruedInterest: "100", totalBalance: "1100" },
}

describe("RecordPaymentForm", () => {
  it("disables Confirm & Record and prevents a second insert until persistence settles", async () => {
    const user = userEvent.setup()
    const pending = deferred<unknown>()
    mockInsertPaymentWithInput.mockReturnValueOnce({ isPersisted: { promise: pending.promise } })
    render(<RecordPaymentForm {...props} />)

    await user.type(screen.getByLabelText("Amount (UGX)"), "100")
    await user.click(screen.getByRole("button", { name: "Record Payment" }))
    const confirm = screen.getByRole("button", { name: "Confirm & Record" })
    await user.click(confirm)

    expect(confirm).toBeDisabled()
    await user.click(confirm)
    expect(mockInsertPaymentWithInput).toHaveBeenCalledOnce()

    pending.resolve(undefined)
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith("Payment recorded successfully"))
  })

  it("re-enables confirmation after persistence fails", async () => {
    const user = userEvent.setup()
    const pending = deferred<unknown>()
    mockInsertPaymentWithInput.mockReturnValueOnce({ isPersisted: { promise: pending.promise } })
    render(<RecordPaymentForm {...props} />)

    await user.type(screen.getByLabelText("Amount (UGX)"), "100")
    await user.click(screen.getByRole("button", { name: "Record Payment" }))
    const confirm = screen.getByRole("button", { name: "Confirm & Record" })
    await user.click(confirm)
    pending.reject(new Error("Failed to record payment"))

    await screen.findByText("Confirm Payment")
    expect(screen.getByRole("button", { name: "Confirm & Record" })).not.toBeDisabled()
  })
})
