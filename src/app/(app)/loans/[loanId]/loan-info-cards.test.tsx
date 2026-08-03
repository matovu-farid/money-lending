// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { LoanInfoCards } from "./loan-info-cards"

const { mockHas } = vi.hoisted(() => ({ mockHas: vi.fn() }))

vi.mock("@/hooks/use-permissions", () => ({ usePermissions: () => ({ has: mockHas }) }))
vi.mock("@/components/ui/info-popover", () => ({ InfoPopover: () => null }))
vi.mock("@/components/ui/permission-info", () => ({ PermissionInfo: () => null }))

const loan = {
  id: "loan-1",
  principalAmount: "1000000",
  interestRate: "0.10",
  interestRateOverride: null,
  penaltyMultiplier: "0.05",
  penaltyWaived: false,
  penaltyWaivedAt: null,
  penaltyWaivedBy: null,
  minInterestDays: 30,
  issuanceFee: "0",
  loanType: "perpetual",
  startDate: new Date("2026-01-01"),
  backdatedFrom: null,
  backdatedBy: null,
  backdateNote: null,
  status: "active",
} as any

const callbacks = {
  onWaivePenalty: vi.fn(),
  onOpenPenaltyAdjust: vi.fn(),
  onClosePenaltyAdjust: vi.fn(),
  onPenaltyMultiplierInputChange: vi.fn(),
  onAdjustPenaltySave: vi.fn(),
  onOpenRateChange: vi.fn(),
  onOpenRateHistory: vi.fn(),
  onOpenAdminRateAdjustment: vi.fn(),
}

function renderCards(history: any[] = []) {
  return render(
    <LoanInfoCards
      loan={loan}
      penaltyActive={false}
      userRole={"admin" as any}
      userNameMap={{}}
      pendingRateRequest={undefined}
      isWaivingPenalty={false}
      adjustingPenalty={false}
      penaltyMultiplierInput=""
      isAdjustingPenalty={false}
      rateHistory={history}
      {...callbacks}
    />,
  )
}

describe("LoanInfoCards rate controls", () => {
  it("shows history only when an applied change exists", () => {
    mockHas.mockReturnValue(false)
    const { rerender } = renderCards()
    expect(screen.queryByRole("button", { name: "View rate history" })).not.toBeInTheDocument()

    rerender(
      <LoanInfoCards
        loan={loan}
        penaltyActive={false}
        userRole={"admin" as any}
        userNameMap={{}}
        pendingRateRequest={undefined}
        isWaivingPenalty={false}
        adjustingPenalty={false}
        penaltyMultiplierInput=""
        isAdjustingPenalty={false}
        rateHistory={[{ id: "audit-1", fromRate: "0.10", toRate: "0.12", actorId: "admin-1", actorName: "Admin", changedAt: new Date() }]}
        {...callbacks}
      />,
    )
    expect(screen.getByRole("button", { name: "View rate history" })).toBeInTheDocument()
  })

  it("shows adjustment control only to users with the admin permission", () => {
    mockHas.mockImplementation((permission: string) => permission === "loan:rate-adjust")
    renderCards()
    expect(screen.getByRole("button", { name: "Adjust Interest Rate" })).toBeInTheDocument()

    cleanup()
    mockHas.mockReturnValue(false)
    renderCards()
    expect(screen.queryByRole("button", { name: "Adjust Interest Rate" })).not.toBeInTheDocument()
  })
})
