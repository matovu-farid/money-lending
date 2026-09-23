import { describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("better-auth/cookies", () => ({ getSessionCookie: () => null }))
vi.mock("@/lib/auth", () => ({ auth: {} }))
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

describe("public request-access route", () => {
  it("lets a signed-out visitor open the form", async () => {
    const response = await proxy(new NextRequest("http://localhost/request-access"))

    expect(response.status).toBe(200)
    expect(response.headers.get("location")).toBeNull()
  })
})
