import { beforeEach, describe, expect, it, vi } from "vitest"

const { dbExecute, captureServerWarning } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  captureServerWarning: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  db: { execute: dbExecute, select: vi.fn() },
}))
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: vi.fn() }
  },
}))
vi.mock("@/lib/sentry", () => ({ captureServerWarning }))
vi.mock("@/lib/emails", () => ({
  AdminNotificationTemplate: vi.fn(() => null),
}))

import { notifyAdmin, sendAdminNotification } from "@/lib/email"

const payload = {
  actorName: "Operator",
  actorEmail: "operator@example.com",
  timestamp: new Date("2026-01-01T00:00:00.000Z"),
  amount: "1000",
  entityRef: "LOAN-TEST",
  deepLinkPath: "/loans/test",
} as const

describe("email operational reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reports notification delivery failures without throwing", async () => {
    dbExecute.mockRejectedValueOnce(new Error("database unavailable"))

    await expect(sendAdminNotification("loan.disbursed", payload)).resolves.toBeUndefined()

    expect(captureServerWarning).toHaveBeenCalledWith(
      "Admin notification delivery failed",
      { source: "email.send-admin-notification" },
    )
  })

  it("reports fire-and-forget notification preparation failures", async () => {
    const error = new Error("context lookup failed")
    notifyAdmin({
      eventType: "loan.disbursed",
      context: Promise.reject(error),
      session: { user: { name: "Operator", email: "operator@example.com" } },
      amount: "1000",
      entityRef: "LOAN-TEST",
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(captureServerWarning).toHaveBeenCalledWith(
      "Admin notification preparation failed",
      { source: "email.notify-admin" },
    )
  })
})
