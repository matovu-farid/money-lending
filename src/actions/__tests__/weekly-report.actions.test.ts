import { beforeEach, describe, expect, it, vi } from "vitest"
import { Effect } from "effect"

vi.mock("@/lib/action-utils", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/action-utils")>(),
  getSession: vi.fn(),
  checkPermission: vi.fn().mockResolvedValue(null),
}))
vi.mock("@/services/weekly-report.service", () => ({
  getWeeklyPaymentsData: vi.fn(),
  getWeeklyLoansData: vi.fn(),
}))

import { checkPermission, getSession } from "@/lib/action-utils"
import { getWeeklyLoansData, getWeeklyPaymentsData } from "@/services/weekly-report.service"
import { getWeeklyLoansReportAction, getWeeklyPaymentsReportAction } from "../report.actions"

const session = { user: { id: "admin-1", role: "admin" } } as unknown as NonNullable<Awaited<ReturnType<typeof getSession>>>
const paymentDto = { week: "2026-09-21", calculatedAt: "2026-09-23T00:00:00.000Z", count: 1, total: "12.00", rows: [] }
const loanDto = { week: "2026-09-21", calculatedAt: "2026-09-23T00:00:00.000Z", count: 1, total: "20.00", rows: [] }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(session)
  vi.mocked(checkPermission).mockResolvedValue(null)
})

describe("weekly report actions", () => {
  it("checks reports and payment permissions before returning payment data", async () => {
    vi.mocked(getWeeklyPaymentsData).mockReturnValue(Effect.succeed(paymentDto) as ReturnType<typeof getWeeklyPaymentsData>)
    await expect(getWeeklyPaymentsReportAction({ week: "2026-09-21" })).resolves.toEqual({ data: paymentDto })
    expect(vi.mocked(checkPermission).mock.calls.map(([, permission]) => permission)).toEqual(["reports:read", "payment:read"])
    expect(getWeeklyPaymentsData).toHaveBeenCalledWith("2026-09-21")
  })

  it("does not call the payment service when payment permission is denied", async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce(null).mockResolvedValueOnce("Forbidden")
    await expect(getWeeklyPaymentsReportAction({ week: "2026-09-21" })).resolves.toEqual({ error: "Forbidden" })
    expect(getWeeklyPaymentsData).not.toHaveBeenCalled()
  })

  it("checks loan permission and returns loan data", async () => {
    vi.mocked(getWeeklyLoansData).mockReturnValue(Effect.succeed(loanDto) as ReturnType<typeof getWeeklyLoansData>)
    await expect(getWeeklyLoansReportAction({ week: "2026-09-21" })).resolves.toEqual({ data: loanDto })
    expect(vi.mocked(checkPermission).mock.calls.map(([, permission]) => permission)).toEqual(["reports:read", "loan:read"])
    expect(getWeeklyLoansData).toHaveBeenCalledWith("2026-09-21")
  })

  it("does not call either service for an invalid week", async () => {
    await expect(getWeeklyPaymentsReportAction({ week: "2026-09-22" })).resolves.toEqual({ error: "Invalid week" })
    await expect(getWeeklyLoansReportAction({ week: "2026-02-30" })).resolves.toEqual({ error: "Invalid week" })
    expect(getWeeklyPaymentsData).not.toHaveBeenCalled()
    expect(getWeeklyLoansData).not.toHaveBeenCalled()
  })

  it("does not query either service for a future week", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-24T12:00:00.000Z"))
    await expect(getWeeklyPaymentsReportAction({ week: "2026-09-28" })).resolves.toEqual({ error: "Invalid week" })
    await expect(getWeeklyLoansReportAction({ week: "2026-09-28" })).resolves.toEqual({ error: "Invalid week" })
    expect(getWeeklyPaymentsData).not.toHaveBeenCalled()
    expect(getWeeklyLoansData).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it("maps service failures to a stable database error", async () => {
    const { DatabaseError } = await import("@/lib/errors")
    vi.mocked(getWeeklyPaymentsData).mockReturnValue(Effect.fail(new DatabaseError({ cause: new Error("private db details") })) as ReturnType<typeof getWeeklyPaymentsData>)
    await expect(getWeeklyPaymentsReportAction({ week: "2026-09-21" })).resolves.toEqual({ error: "Database error" })
  })
})
