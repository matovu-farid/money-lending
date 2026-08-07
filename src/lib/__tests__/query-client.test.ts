import { beforeEach, describe, expect, it, vi } from "vitest"

const captureClientError = vi.fn()
const isTechnicalClientError = vi.fn()

vi.mock("@/lib/sentry", () => ({
  captureClientError,
  isTechnicalClientError,
}))

describe("global React Query error reporting", () => {
  beforeEach(() => {
    vi.resetModules()
    captureClientError.mockReset()
    isTechnicalClientError.mockReset()
  })

  it("reports technical query failures", async () => {
    isTechnicalClientError.mockReturnValue(true)
    const { getQueryClient } = await import("@/lib/query-client")
    const client = getQueryClient()
    const error = new Error("database unavailable")

    await expect(
      client.fetchQuery({
        queryKey: ["test", "technical"],
        queryFn: () => Promise.reject(error),
        retry: false,
      }),
    ).rejects.toBe(error)

    expect(captureClientError).toHaveBeenCalledWith(error, {
      source: "react-query.query",
    })
  })

  it("does not report expected query failures", async () => {
    isTechnicalClientError.mockReturnValue(false)
    const { getQueryClient } = await import("@/lib/query-client")
    const client = getQueryClient()
    const error = { _tag: "ValidationError", message: "Invalid input" }

    await expect(
      client.fetchQuery({
        queryKey: ["test", "expected"],
        queryFn: () => Promise.reject(error),
        retry: false,
      }),
    ).rejects.toBe(error)

    expect(captureClientError).not.toHaveBeenCalled()
  })

  it("reports technical mutation failures", async () => {
    isTechnicalClientError.mockReturnValue(true)
    const { getQueryClient } = await import("@/lib/query-client")
    const client = getQueryClient()
    const error = new Error("mutation failed")

    await expect(
      client
        .getMutationCache()
        .build(client, {
          mutationFn: () => Promise.reject(error),
          retry: false,
        })
        .execute(undefined),
    ).rejects.toBe(error)

    expect(captureClientError).toHaveBeenCalledWith(error, {
      source: "react-query.mutation",
    })
  })
})
