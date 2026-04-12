import { describe, it, expect, vi, beforeEach } from "vitest"
import { queryKeys } from "../query-keys"

let lastQueryOptions: Record<string, unknown> | null = null

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: Record<string, unknown>) => {
    lastQueryOptions = opts
    return { data: undefined, isLoading: true }
  },
}))

vi.mock("@/actions/customer.actions", () => ({
  searchCustomersAction: vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } }),
}))

import { useCustomers } from "../use-customers"
import { searchCustomersAction } from "@/actions/customer.actions"

describe("useCustomers", () => {
  beforeEach(() => {
    lastQueryOptions = null
    vi.clearAllMocks()
  })

  it("passes correct query key with params and page", () => {
    const params = { name: "Alice" }
    useCustomers(params, 1)
    expect(lastQueryOptions?.queryKey).toEqual(
      queryKeys.customers.search(params, 1),
    )
  })

  it("provides a queryFn", () => {
    useCustomers({}, 1)
    expect(typeof lastQueryOptions?.queryFn).toBe("function")
  })

  it("queryFn calls searchCustomersAction with page and pageSize", async () => {
    const params = { name: "Bob", status: ["active" as const] }
    useCustomers(params, 2)

    const mockResult = { rows: [{ id: "c-1", name: "Bob" }], total: 1 }
    vi.mocked(searchCustomersAction).mockResolvedValueOnce({
      data: mockResult,
    })

    const result = await (lastQueryOptions?.queryFn as () => Promise<unknown>)()
    expect(searchCustomersAction).toHaveBeenCalledWith({
      name: "Bob",
      status: ["active"],
      page: 2,
      pageSize: 20,
    })
    expect(result).toEqual(mockResult)
  })

  it("queryFn throws when action returns error", async () => {
    useCustomers({}, 1)
    vi.mocked(searchCustomersAction).mockResolvedValueOnce({
      error: "Unauthorized",
    })

    const fn = lastQueryOptions?.queryFn as () => Promise<unknown>
    await expect(fn()).rejects.toThrow("Unauthorized")
  })
})
