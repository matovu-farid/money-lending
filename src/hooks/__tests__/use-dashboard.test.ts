import { describe, it, expect, vi, beforeEach } from "vitest"
import { queryKeys } from "../query-keys"

let lastQueryOptions: Record<string, unknown> | null = null

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: Record<string, unknown>) => {
    lastQueryOptions = opts
    return { data: undefined, isLoading: true }
  },
}))

vi.mock("@/actions/dashboard.actions", () => ({
  getDashboardAction: vi.fn().mockResolvedValue({ data: { kpis: {} } }),
}))

import { useDashboard } from "../use-dashboard"
import { getDashboardAction } from "@/actions/dashboard.actions"

describe("useDashboard", () => {
  beforeEach(() => {
    lastQueryOptions = null
    vi.clearAllMocks()
  })

  it("is exported as a function", () => {
    expect(typeof useDashboard).toBe("function")
  })

  it("passes the dashboard.kpis query key", () => {
    useDashboard()
    expect(lastQueryOptions?.queryKey).toEqual(queryKeys.dashboard.kpis())
  })

  it("provides a queryFn", () => {
    useDashboard()
    expect(typeof lastQueryOptions?.queryFn).toBe("function")
  })

  it("queryFn calls getDashboardAction and unwraps", async () => {
    const mockData = { kpis: { totalLoans: 5 } }
    vi.mocked(getDashboardAction).mockResolvedValueOnce({ data: mockData })

    useDashboard()
    const result = await (lastQueryOptions?.queryFn as () => Promise<unknown>)()
    expect(getDashboardAction).toHaveBeenCalled()
    expect(result).toEqual(mockData)
  })

  it("queryFn throws when action returns error", async () => {
    vi.mocked(getDashboardAction).mockResolvedValueOnce({
      error: "Server error",
    })

    useDashboard()
    const fn = lastQueryOptions?.queryFn as () => Promise<unknown>
    await expect(fn()).rejects.toThrow("Server error")
  })
})
