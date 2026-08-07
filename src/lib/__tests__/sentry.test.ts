import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { DatabaseError } from "@/lib/errors"

const sdk = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  scopeSetTag: vi.fn(),
  scopeSetUser: vi.fn(),
  scopeSetContext: vi.fn(),
  withScope: vi.fn(),
}))

vi.mock("@sentry/nextjs", () => ({
  captureException: sdk.captureException,
  captureMessage: sdk.captureMessage,
  withScope: sdk.withScope,
}))

describe("application Sentry reporter", () => {
  let reporter: typeof import("../sentry")

  beforeAll(async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1")
    vi.resetModules()
    reporter = await import("../sentry")
  })

  beforeEach(() => {
    vi.clearAllMocks()
    sdk.withScope.mockImplementation((callback: (scope: unknown) => void) =>
      callback({
        setTag: sdk.scopeSetTag,
        setUser: sdk.scopeSetUser,
        setContext: sdk.scopeSetContext,
      }),
    )
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it("captures the underlying Error from a DatabaseError", () => {
    const cause = new Error("connection refused")

    reporter.captureServerError(new DatabaseError({ cause }), { source: "test" })

    expect(sdk.captureException).toHaveBeenCalledWith(cause)
    expect(sdk.captureMessage).not.toHaveBeenCalled()
  })

  it("captures typed non-Error failures with safe scalar context", () => {
    reporter.captureServerError(
      { _tag: "UnexpectedFailure", detail: "safe diagnostic" },
      { source: "test", userId: "user-1", requestId: "req-1" },
    )

    expect(sdk.captureMessage).toHaveBeenCalledWith("Typed error: UnexpectedFailure", "error")
    expect(sdk.scopeSetUser).toHaveBeenCalledWith({ id: "user-1" })
    expect(sdk.scopeSetTag).toHaveBeenCalledWith("source", "test")
    expect(sdk.scopeSetContext).not.toHaveBeenCalled()
  })

  it("does not forward nested private values from typed errors or context", () => {
    reporter.captureServerError(
      {
        _tag: "UnexpectedFailure",
        email: "person@example.com",
        amount: "90000",
        nested: { token: "secret", customerName: "Private Person" },
      },
      { source: "test", email: "person@example.com", amount: "90000" },
    )

    expect(sdk.scopeSetContext).not.toHaveBeenCalled()
    for (const call of sdk.scopeSetTag.mock.calls) {
      expect(JSON.stringify(call)).not.toMatch(/person@example|90000|secret|Private Person/)
    }
  })

  it("captures operational warnings separately", () => {
    reporter.captureServerWarning("IP lookup failed", { source: "ip-allowlist" })

    expect(sdk.captureMessage).toHaveBeenCalledWith("IP lookup failed", "warning")
  })

  it("classifies expected domain tags and keeps technical tags reportable", () => {
    expect(reporter.isExpectedDomainError({ _tag: "ValidationError" })).toBe(true)
    expect(reporter.isExpectedDomainError({ _tag: "LoanNotFound" })).toBe(true)
    expect(reporter.isExpectedDomainError({ _tag: "ConversationNotFound" })).toBe(true)
    expect(reporter.isExpectedDomainError({ _tag: "DatabaseError" })).toBe(false)
    expect(reporter.isExpectedDomainError({ _tag: "UnexpectedFailure" })).toBe(false)
  })

  it("does not report the same object twice", () => {
    const error = new Error("same failure")

    reporter.captureServerError(error, { source: "inner" })
    reporter.captureServerError(error, { source: "outer" })

    expect(sdk.captureException).toHaveBeenCalledTimes(1)
  })

  it("classifies client transport failures without classifying user-facing errors", () => {
    expect(reporter.isTechnicalClientError(new TypeError("Failed to fetch"))).toBe(true)
    expect(reporter.isTechnicalClientError({ status: 503, message: "unavailable" })).toBe(true)
    expect(reporter.isTechnicalClientError(new Error("Unauthorized"))).toBe(false)
    expect(reporter.isTechnicalClientError(new Error("Invalid amount"))).toBe(false)
  })

  it("never throws when the Sentry SDK throws", () => {
    sdk.captureException.mockImplementationOnce(() => {
      throw new Error("SDK down")
    })

    expect(() => reporter.captureServerError(new Error("application failure"))).not.toThrow()
  })
})
