import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { dbExecute, emailSend, captureServerWarning } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  emailSend: vi.fn(),
  captureServerWarning: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  db: { execute: dbExecute, select: vi.fn() },
}))
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: emailSend }
  },
}))
vi.mock("@/lib/sentry", () => ({ captureServerWarning }))
vi.mock("@/lib/emails", () => ({
  AdminNotificationTemplate: vi.fn(() => null),
  AccessRequestTemplate: vi.fn(() => "mock-access-request-template"),
}))

import {
  notifyAdmin,
  sendAccessRequestEmail,
  sendAdminNotification,
} from "@/lib/email"

const payload = {
  actorName: "Operator",
  actorEmail: "operator@example.com",
  timestamp: new Date("2026-01-01T00:00:00.000Z"),
  amount: "1000",
  entityRef: "LOAN-TEST",
  deepLinkPath: "/loans/test",
} as const

describe("email operational reporting", () => {
  const originalRequestAccessEmail = process.env.REQUEST_ACCESS_EMAIL

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (originalRequestAccessEmail === undefined) {
      delete process.env.REQUEST_ACCESS_EMAIL
    } else {
      process.env.REQUEST_ACCESS_EMAIL = originalRequestAccessEmail
    }
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

  it("sends access requests to the configured recipient", async () => {
    process.env.REQUEST_ACCESS_EMAIL = "matovu90@gmail.com"
    emailSend.mockResolvedValueOnce({ data: { id: "email-id" }, error: null })

    await sendAccessRequestEmail({
      name: "Amina Namusoke",
      email: "lead@example.com",
      phone: "+256 700 000000",
    })

    expect(emailSend).toHaveBeenCalledWith(expect.objectContaining({
      to: "matovu90@gmail.com",
      subject: "New request for access from Amina Namusoke",
      react: expect.anything(),
    }))
  })

  it("rejects when the access-request recipient is not configured", async () => {
    delete process.env.REQUEST_ACCESS_EMAIL

    await expect(sendAccessRequestEmail({
      name: "Amina Namusoke",
      email: "lead@example.com",
    })).rejects.toThrow("REQUEST_ACCESS_EMAIL is not configured")

    expect(emailSend).not.toHaveBeenCalled()
  })
})
