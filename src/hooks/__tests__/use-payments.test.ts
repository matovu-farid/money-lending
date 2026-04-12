import { describe, it, expect, vi, beforeEach } from "vitest"
import { queryKeys } from "../query-keys"

let lastQueryOptions: Record<string, unknown> | null = null
const queryCallLog: Record<string, unknown>[] = []

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: Record<string, unknown>) => {
    lastQueryOptions = opts
    queryCallLog.push(opts)
    return { data: undefined, isLoading: true }
  },
}))

vi.mock("@/actions/payment.actions", () => ({
  listPaymentsAction: vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } }),
  getPaymentsByLoanAction: vi.fn().mockResolvedValue({ data: [] }),
}))

import { usePayments, useLoanPayments } from "../use-payments"
import {
  listPaymentsAction,
  getPaymentsByLoanAction,
} from "@/actions/payment.actions"

describe("usePayments", () => {
  beforeEach(() => {
    lastQueryOptions = null
    queryCallLog.length = 0
    vi.clearAllMocks()
  })

  it("passes correct query key with params and page", () => {
    const params = { dateFrom: "2026-01-01" }
    usePayments(params, 2)
    expect(lastQueryOptions?.queryKey).toEqual(
      queryKeys.payments.list(params, 2),
    )
  })

  it("sets staleTime to 30 seconds", () => {
    usePayments({}, 1)
    expect(lastQueryOptions?.staleTime).toBe(30_000)
  })

  it("respects the enabled flag", () => {
    usePayments({}, 1, false)
    expect(lastQueryOptions?.enabled).toBe(false)
  })

  it("defaults enabled to true", () => {
    usePayments({}, 1)
    expect(lastQueryOptions?.enabled).toBe(true)
  })

  it("queryFn calls listPaymentsAction with page and pageSize", async () => {
    const params = { dateFrom: "2026-01-01" }
    usePayments(params, 3)

    const mockRows = [{ id: "p-1" }]
    vi.mocked(listPaymentsAction).mockResolvedValueOnce({
      data: { rows: mockRows, total: 1 },
    })

    const result = await (lastQueryOptions?.queryFn as () => Promise<unknown>)()
    expect(listPaymentsAction).toHaveBeenCalledWith({
      dateFrom: "2026-01-01",
      page: 3,
      pageSize: 25,
    })
    expect(result).toEqual({ rows: mockRows, total: 1 })
  })

  it("queryFn throws when action returns error", async () => {
    usePayments({}, 1)
    vi.mocked(listPaymentsAction).mockResolvedValueOnce({
      error: "Failed",
    })

    const fn = lastQueryOptions?.queryFn as () => Promise<unknown>
    await expect(fn()).rejects.toThrow("Failed")
  })
})

describe("useLoanPayments", () => {
  beforeEach(() => {
    lastQueryOptions = null
    vi.clearAllMocks()
  })

  it("passes correct query key for loan", () => {
    useLoanPayments("l-99")
    expect(lastQueryOptions?.queryKey).toEqual(
      queryKeys.payments.byLoan("l-99"),
    )
  })

  it("sets staleTime to 30 seconds", () => {
    useLoanPayments("l-1")
    expect(lastQueryOptions?.staleTime).toBe(30_000)
  })

  it("respects the enabled flag", () => {
    useLoanPayments("l-1", false)
    expect(lastQueryOptions?.enabled).toBe(false)
  })

  it("passes initialData when provided", () => {
    const initial = [{ id: "p-1" }] as never[]
    useLoanPayments("l-1", true, initial)
    expect(lastQueryOptions?.initialData).toEqual(initial)
    expect(typeof lastQueryOptions?.initialDataUpdatedAt).toBe("number")
  })

  it("queryFn calls getPaymentsByLoanAction with loan id", async () => {
    const mockPayments = [{ id: "p-1", amount: "1000" }]
    vi.mocked(getPaymentsByLoanAction).mockResolvedValueOnce({
      data: mockPayments,
    })

    useLoanPayments("l-42")
    const result = await (lastQueryOptions?.queryFn as () => Promise<unknown>)()
    expect(getPaymentsByLoanAction).toHaveBeenCalledWith("l-42")
    expect(result).toEqual(mockPayments)
  })
})
