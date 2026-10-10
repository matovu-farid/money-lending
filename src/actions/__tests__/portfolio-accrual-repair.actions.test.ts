import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }))
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/services/portfolio-accrual-repair.service", () => ({
  loadPortfolioAccrualPlan: vi.fn(),
}))
vi.mock("@/services/portfolio-accrual-repair-apply.service", () => ({
  approvePortfolioAccrualRepair: vi.fn(),
}))

import { auth } from "@/lib/auth"
import { loadPortfolioAccrualPlan } from "@/services/portfolio-accrual-repair.service"
import { approvePortfolioAccrualRepair } from "@/services/portfolio-accrual-repair-apply.service"
import { approvePortfolioAccrualRepairAction } from "../portfolio-accrual-repair.actions"

const input = {
  loanId: "10b5f8b9-42eb-44bd-aac3-d9d6e6657022",
  asOf: "2026-10-10T15:44:00.000Z",
  policyVersion: "portfolio-accrual-v1",
  planHash: "a".repeat(64), inputFingerprint: "b".repeat(64),
  reviewNote: "Checked period dates and non-cash amounts",
}
const plan = { ...input, classification: "ready", asOf: new Date(input.asOf) }

describe("approvePortfolioAccrualRepairAction", () => {
  beforeEach(() => vi.clearAllMocks())

  it("requires a signed-in administrator", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never)
    expect(await approvePortfolioAccrualRepairAction(input)).toEqual({ error: "Unauthorized" })
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "officer-1", role: "loanOfficer" },
    } as never)
    expect(await approvePortfolioAccrualRepairAction(input)).toEqual({ error: "Forbidden" })
    expect(approvePortfolioAccrualRepair).not.toHaveBeenCalled()
  })

  it("rejects a changed source before approval", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "admin" },
    } as never)
    vi.mocked(loadPortfolioAccrualPlan).mockResolvedValue({
      ...plan, planHash: "c".repeat(64),
    } as never)
    expect(await approvePortfolioAccrualRepairAction(input)).toEqual({
      error: "Reviewed plan changed; generate a new preview",
    })
    expect(approvePortfolioAccrualRepair).not.toHaveBeenCalled()
  })

  it("records the authenticated actor for only the matching plan", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "admin" },
    } as never)
    vi.mocked(loadPortfolioAccrualPlan).mockResolvedValue(plan as never)
    vi.mocked(approvePortfolioAccrualRepair).mockResolvedValue("approval-1")
    expect(await approvePortfolioAccrualRepairAction(input)).toEqual({
      data: { approvalId: "approval-1", planHash: input.planHash },
    })
    expect(approvePortfolioAccrualRepair).toHaveBeenCalledWith(
      plan, "admin-1", input.reviewNote,
    )
  })
})
