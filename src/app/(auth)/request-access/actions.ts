"use server"

import { sendAccessRequestEmail } from "@/lib/email"
import { captureServerWarning } from "@/lib/sentry"

export type AccessRequestInput = {
  name?: string
  email?: string
  phone?: string
  organization?: string
  message?: string
}

export type AccessRequestResult =
  | { success: true }
  | { error: string; field?: "name" | "email" | "contact" }

const CONTACT_ERROR = "Please provide an email address or phone/WhatsApp number."
const DELIVERY_ERROR = "We couldn't submit your request right now. Please try again."
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function trimValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export async function submitAccessRequest(
  input: AccessRequestInput,
): Promise<AccessRequestResult> {
  const name = trimValue(input.name)
  const email = trimValue(input.email)
  const phone = trimValue(input.phone)
  const organization = trimValue(input.organization)
  const message = trimValue(input.message)

  if (!name) {
    return { field: "name", error: "Name is required." }
  }
  if (name.length > 100) {
    return { field: "name", error: "Name must be 100 characters or fewer." }
  }
  if (!email && !phone) {
    return { field: "contact", error: CONTACT_ERROR }
  }
  if (email && email.length > 254) {
    return { field: "email", error: "Email must be 254 characters or fewer." }
  }
  if (email && !EMAIL_PATTERN.test(email)) {
    return { field: "email", error: "Please enter a valid email address." }
  }
  if (phone && phone.length > 50) {
    return { field: "contact", error: "Phone / WhatsApp must be 50 characters or fewer." }
  }
  if (organization && organization.length > 200) {
    return { error: "Business or organization must be 200 characters or fewer." }
  }
  if (message && message.length > 1000) {
    return { error: "Message must be 1000 characters or fewer." }
  }

  try {
    await sendAccessRequestEmail({
      name,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(organization ? { organization } : {}),
      ...(message ? { message } : {}),
    })
    return { success: true }
  } catch (error) {
    captureServerWarning("Access request email delivery failed", {
      source: "email.send-access-request",
    })
    console.error("[submitAccessRequest] Failed to send access request email:", error)
    return { error: DELIVERY_ERROR }
  }
}
