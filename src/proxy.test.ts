import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { AUTH_COOKIE_PREFIX } from "@/lib/auth-cookie"

const getSessionCookie = vi.hoisted(() => vi.fn(
  (request: NextRequest, config?: { cookiePrefix?: string }): string | null => {
    void request
    void config
    return null
  },
))
const getSession = vi.hoisted(() => vi.fn())
vi.mock("better-auth/cookies", () => ({ getSessionCookie }))
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }))
vi.mock("@/lib/db", () => ({ db: {} }))
vi.mock("@/lib/ip-allowlist", () => ({
  isIpAllowlistEnabled: vi.fn(),
  isIpAllowed: vi.fn(),
  recordBlock: vi.fn(),
  getClientIp: vi.fn(),
  clearCaches: vi.fn(),
}))
vi.mock("@/lib/sentry", () => ({ captureServerWarning: vi.fn() }))

import { proxy } from "./proxy"

beforeEach(() => {
  getSessionCookie.mockImplementation(() => null)
  getSession.mockReset()
})
afterEach(() => vi.unstubAllEnvs())

describe("public request-access route", () => {
  it("lets a signed-out visitor open the form", async () => {
    const response = await proxy(new NextRequest("http://localhost/request-access"))

    expect(response.status).toBe(200)
    expect(response.headers.get("location")).toBeNull()
  })
})

describe("app-specific session cookie", () => {
  it("looks for this app's cookie namespace", async () => {
    await proxy(new NextRequest("http://localhost/dashboard"))

    expect(getSessionCookie).toHaveBeenCalledWith(
      expect.any(NextRequest),
      { cookiePrefix: AUTH_COOKIE_PREFIX },
    )
  })

  it("migrates a valid legacy session without sending the user to login", async () => {
    getSessionCookie.mockImplementation((_request, config) => config ? null : "signed-legacy-token")
    getSession.mockResolvedValue({
      user: { id: "user-1", emailVerified: true, role: "superAdmin" },
      session: { expiresAt: new Date(Date.now() + 60_000) },
    })

    const response = await proxy(new NextRequest("http://localhost:3482/reports/weekly-payments?week=2026-09-21", {
      headers: { cookie: "better-auth.session_token=signed-legacy-token; has_account=1" },
    }))

    expect(response.headers.get("location")).toBe("http://localhost:3482/reports/weekly-payments?week=2026-09-21")
    expect(response.headers.get("set-cookie")).toContain("kaks-credit.session_token=signed-legacy-token")
    expect(response.cookies.get("better-auth.session_token")?.value).toBe("")
    expect(getSession).toHaveBeenCalledWith(expect.objectContaining({ headers: expect.any(Headers) }))
    expect((getSession.mock.calls[0][0].headers as Headers).get("cookie"))
      .toContain("kaks-credit.session_token=signed-legacy-token")
  })

  it("uses secure cookie names while migrating an HTTPS session", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://credit.example.com")
    getSessionCookie.mockImplementation((_request, config) => config ? null : "signed-legacy-token")
    getSession.mockResolvedValue({
      user: { id: "user-1", emailVerified: true, role: "superAdmin" },
      session: { expiresAt: new Date(Date.now() + 60_000) },
    })

    const response = await proxy(new NextRequest("https://credit.example.com/dashboard", {
      headers: { cookie: "__Secure-better-auth.session_token=signed-legacy-token; has_account=1" },
    }))

    expect((getSession.mock.calls[0][0].headers as Headers).get("cookie"))
      .toContain("__Secure-kaks-credit.session_token=signed-legacy-token")
    expect(response.cookies.get("__Secure-kaks-credit.session_token")?.value).toBe("signed-legacy-token")
    expect(response.cookies.get("__Secure-better-auth.session_token")?.value).toBe("")
  })

  it("removes a leftover legacy cookie when the new session is already valid", async () => {
    getSessionCookie.mockImplementation((_request, config) => config ? "new-token" : "old-token")
    getSession.mockResolvedValue({
      user: { id: "user-1", emailVerified: true, role: "superAdmin" },
      session: { expiresAt: new Date(Date.now() + 60_000) },
    })

    const response = await proxy(new NextRequest("http://localhost:3482/dashboard", {
      headers: { cookie: "kaks-credit.session_token=new-token; better-auth.session_token=old-token" },
    }))

    expect(response.status).toBe(200)
    expect(response.cookies.get("better-auth.session_token")?.value).toBe("")
  })

  it("preserves another localhost app's cookie while this app's session is valid", async () => {
    getSessionCookie.mockImplementation((_request, config) => config ? "new-token" : "other-app-token")
    getSession
      .mockResolvedValueOnce({
        user: { id: "user-1", emailVerified: true, role: "superAdmin" },
        session: { expiresAt: new Date(Date.now() + 60_000) },
      })
      .mockResolvedValueOnce(null)

    const response = await proxy(new NextRequest("http://localhost:3482/dashboard", {
      headers: { cookie: "kaks-credit.session_token=new-token; better-auth.session_token=other-app-token" },
    }))

    expect(response.status).toBe(200)
    expect(response.cookies.get("better-auth.session_token")).toBeUndefined()
  })

  it("rejects a legacy cookie that is not a session in this app", async () => {
    getSessionCookie.mockImplementation((_request, config) => config ? null : "other-app-token")
    getSession.mockResolvedValue(null)

    const response = await proxy(new NextRequest("http://localhost:3482/dashboard", {
      headers: { cookie: "better-auth.session_token=other-app-token; has_account=1" },
    }))

    expect(response.headers.get("location")).toBe("http://localhost:3482/login")
    expect(response.headers.get("set-cookie")).toBeNull()
  })
})
