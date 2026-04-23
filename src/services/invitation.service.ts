// src/services/invitation.service.ts
import crypto from "crypto"
import { db } from "@/lib/db"
import { invitations } from "@/lib/db/schema/invitations"
import { user } from "@/lib/db/schema/auth"
import { eq, and, desc } from "drizzle-orm"
import { Resend } from "resend"
import { InviteUserTemplate } from "@/lib/emails"
import type { UserRole } from "@/types"

const resend = new Resend(process.env.RESEND_API_KEY)
const emailFrom = process.env.EMAIL_FROM || "Lending Manager <noreply@fidexa.org>"
const isTest = process.env.NODE_ENV === "test" || process.env.CYPRESS === "true"

// In-memory store for test mode (same pattern as pendingVerifications in auth.ts)
export const pendingInviteUrls = new Map<string, string>()

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex")
}

function generateToken(): { raw: string; hashed: string } {
  const raw = crypto.randomBytes(32).toString("hex")
  return { raw, hashed: hashToken(raw) }
}

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000"
}

export async function createInvitation(input: {
  email: string
  name: string
  role: UserRole
  invitedById: string
  inviterName: string
}) {
  // Check if email is already registered
  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, input.email))
    .limit(1)

  if (existingUser) {
    throw new Error("This user already has an account")
  }

  // Check for existing pending invitation
  const [existingInvite] = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(eq(invitations.email, input.email), eq(invitations.status, "pending")))
    .limit(1)

  if (existingInvite) {
    throw new Error("A pending invite already exists for this email — use resend instead")
  }

  const { raw, hashed } = generateToken()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  const [row] = await db
    .insert(invitations)
    .values({
      email: input.email,
      name: input.name,
      role: input.role,
      invitedBy: input.invitedById,
      token: hashed,
      status: "pending",
      expiresAt,
    })
    .returning()

  const inviteUrl = `${getBaseUrl()}/accept-invite?token=${raw}`

  if (isTest) {
    pendingInviteUrls.set(input.email, inviteUrl)
  } else {
    await resend.emails.send({
      from: emailFrom,
      to: input.email,
      subject: `${input.inviterName} invited you to join Lending Manager`,
      react: InviteUserTemplate({
        url: inviteUrl,
        inviterName: input.inviterName,
        role: input.role,
        inviteeName: input.name,
      }),
    })
  }

  return row
}

export async function revokeInvitation(invitationId: string) {
  const [row] = await db
    .update(invitations)
    .set({ status: "revoked" })
    .where(and(eq(invitations.id, invitationId), eq(invitations.status, "pending")))
    .returning()

  if (!row) {
    throw new Error("Pending invitation not found")
  }

  return row
}

export async function resendInvitation(invitationId: string, inviterName: string) {
  // Get the existing invitation
  const [existing] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.id, invitationId))
    .limit(1)

  if (!existing) {
    throw new Error("Invitation not found")
  }

  if (existing.status !== "pending" && existing.status !== "expired") {
    throw new Error("Can only resend pending or expired invitations")
  }

  const { raw, hashed } = generateToken()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  const [row] = await db
    .update(invitations)
    .set({ token: hashed, expiresAt, status: "pending" })
    .where(eq(invitations.id, invitationId))
    .returning()

  const inviteUrl = `${getBaseUrl()}/accept-invite?token=${raw}`

  if (isTest) {
    pendingInviteUrls.set(existing.email, inviteUrl)
  } else {
    await resend.emails.send({
      from: emailFrom,
      to: existing.email,
      subject: `${inviterName} invited you to join Lending Manager`,
      react: InviteUserTemplate({
        url: inviteUrl,
        inviterName,
        role: existing.role,
        inviteeName: existing.name,
      }),
    })
  }

  return row
}

export async function validateInviteToken(rawToken: string) {
  const hashed = hashToken(rawToken)

  const [invitation] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.token, hashed))
    .limit(1)

  if (!invitation) {
    return { valid: false as const, error: "Invalid invitation link" }
  }

  if (invitation.status === "revoked") {
    return { valid: false as const, error: "This invitation has been revoked" }
  }

  if (invitation.status === "accepted") {
    return { valid: false as const, error: "This invitation has already been used" }
  }

  if (invitation.expiresAt < new Date()) {
    // Mark as expired
    await db
      .update(invitations)
      .set({ status: "expired" })
      .where(eq(invitations.id, invitation.id))

    return { valid: false as const, error: "This invitation has expired" }
  }

  if (invitation.status !== "pending") {
    return { valid: false as const, error: "This invitation is no longer valid" }
  }

  return { valid: true as const, invitation }
}

export async function acceptInvitation(rawToken: string) {
  const result = await validateInviteToken(rawToken)

  if (!result.valid) {
    throw new Error(result.error)
  }

  const { invitation } = result

  // Mark invitation as accepted
  await db
    .update(invitations)
    .set({ status: "accepted", acceptedAt: new Date() })
    .where(eq(invitations.id, invitation.id))

  return {
    email: invitation.email,
    name: invitation.name,
    role: invitation.role as UserRole,
  }
}

export async function listInvitations(statusFilter?: string) {
  const baseQuery = db
    .select({
      id: invitations.id,
      email: invitations.email,
      name: invitations.name,
      role: invitations.role,
      status: invitations.status,
      invitedBy: invitations.invitedBy,
      inviterName: user.name,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
      acceptedAt: invitations.acceptedAt,
    })
    .from(invitations)
    .leftJoin(user, eq(invitations.invitedBy, user.id))
    .orderBy(desc(invitations.createdAt))
    .limit(200)

  if (statusFilter && statusFilter !== "all") {
    return baseQuery.where(eq(invitations.status, statusFilter))
  }

  return baseQuery
}
