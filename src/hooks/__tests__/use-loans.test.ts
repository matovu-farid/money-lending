import { describe, it, expect, vi, beforeEach } from "vitest"
import { queryKeys } from "../query-keys"

// Capture what useQuery receives
let lastQueryOptions: Record<string, unknown> | null = null

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: Record<string, unknown>) => {
    lastQueryOptions = opts
    return { data: undefined, isLoading: true }
  },
}))

vi.mock("@/actions/loan.actions", () => ({
  listLoansWithOverdueAction: vi.fn().mockResolvedValue({ data: [] }),
}))

import { useLoans } from "../use-loans"
import { listLoansWithOverdueAction } from "@/actions/loan.actions"

describe("useLoans", () => {
  beforeEach(() => {
    lastQueryOptions = null
    vi.clearAllMocks()
  })

  it("passes the correct query key", () => {
    useLoans()
    expect(lastQueryOptions?.queryKey).toEqual(queryKeys.loans.all)
  })

  it("provides a queryFn", () => {
    useLoans()
    expect(typeof lastQueryOptions?.queryFn).toBe("function")
  })

  it("queryFn calls listLoansWithOverdueAction and unwraps", async () => {
    const mockData = [{ id: "l-1", customerName: "Test" }]
    vi.mocked(listLoansWithOverdueAction).mockResolvedValueOnce({
      data: mockData,
    })

    useLoans()
    const result = await (lastQueryOptions?.queryFn as () => Promise<unknown>)()
    expect(listLoansWithOverdueAction).toHaveBeenCalled()
    expect(result).toEqual(mockData)
  })

  it("queryFn throws when action returns error", async () => {
    vi.mocked(listLoansWithOverdueAction).mockResolvedValueOnce({
      error: "Not authorized",
    })

    useLoans()
    const fn = lastQueryOptions?.queryFn as () => Promise<unknown>
    await expect(fn()).rejects.toThrow("Not authorized")
  })
})
