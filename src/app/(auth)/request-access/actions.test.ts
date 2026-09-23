import { beforeEach, describe, expect, it, vi } from "vitest"

const { sendAccessRequestEmail, captureServerWarning } = vi.hoisted(() => ({
  sendAccessRequestEmail: vi.fn(),
  captureServerWarning: vi.fn(),
}))

vi.mock("@/lib/email", () => ({ sendAccessRequestEmail }))
vi.mock("@/lib/sentry", () => ({ captureServerWarning }))

import { submitAccessRequest } from "./actions"

describe("submitAccessRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("requires a full name", async () => {
    await expect(submitAccessRequest({ name: " ", email: "lead@example.com" }))
      .resolves.toEqual({ field: "name", error: "Name is required." })

    expect(sendAccessRequestEmail).not.toHaveBeenCalled()
  })

  it("requires email or phone/WhatsApp", async () => {
    await expect(submitAccessRequest({ name: "Amina Namusoke" }))
      .resolves.toEqual({
        field: "contact",
        error: "Please provide an email address or phone/WhatsApp number.",
      })

    expect(sendAccessRequestEmail).not.toHaveBeenCalled()
  })

  it("rejects an invalid email when supplied", async () => {
    await expect(submitAccessRequest({
      name: "Amina Namusoke",
      email: "not-an-email",
    })).resolves.toEqual({
      field: "email",
      error: "Please enter a valid email address.",
    })

    expect(sendAccessRequestEmail).not.toHaveBeenCalled()
  })

  it("trims values and sends the available lead details", async () => {
    sendAccessRequestEmail.mockResolvedValueOnce(undefined)

    await expect(submitAccessRequest({
      name: " Amina Namusoke ",
      phone: " +256 700 000000 ",
      organization: " Kaks Traders ",
      message: " I would like to learn more. ",
    })).resolves.toEqual({ success: true })

    expect(sendAccessRequestEmail).toHaveBeenCalledWith({
      name: "Amina Namusoke",
      phone: "+256 700 000000",
      organization: "Kaks Traders",
      message: "I would like to learn more.",
    })
  })

  it("returns a generic error when email delivery fails", async () => {
    sendAccessRequestEmail.mockRejectedValueOnce(new Error("Resend unavailable"))

    await expect(submitAccessRequest({
      name: "Amina Namusoke",
      email: "lead@example.com",
    })).resolves.toEqual({
      error: "We couldn't submit your request right now. Please try again.",
    })

    expect(captureServerWarning).toHaveBeenCalledWith(
      "Access request email delivery failed",
      { source: "email.send-access-request" },
    )
  })
})
