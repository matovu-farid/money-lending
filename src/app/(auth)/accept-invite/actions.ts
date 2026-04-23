"use server"

import { validateInviteToken, acceptInvitation } from "@/services/invitation.service"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db } from "@/lib/db"
import { eq } from "drizzle-orm"
import { user } from "@/lib/db/schema/auth"

export async function getInviteDetails(token: string) {
  if (!token) return { error: "No invitation token provided" }

  const result = await validateInviteToken(token)
  if (!result.valid) {
    return { error: result.error }
  }

  return {
    data: {
      name: result.invitation.name,
      email: result.invitation.email,
      role: result.invitation.role,
    },
  }
}

export async function acceptInviteAndCreateAccount(token: string, password: string) {
  if (!token) return { error: "No invitation token provided" }
  if (!password || password.length < 8) return { error: "Password must be at least 8 characters" }

  try {
    const { email, name, role } = await acceptInvitation(token)

    // Create account via Better Auth with emailVerified: true
    const signUpResult = await auth.api.signUpEmail({
      body: { email, password, name },
      headers: await headers(),
    })

    if (!signUpResult?.user?.id) {
      return { error: "Failed to create account" }
    }

    // Set role and mark email as verified
    await db
      .update(user)
      .set({ role, emailVerified: true })
      .where(eq(user.id, signUpResult.user.id))

    return { data: { success: true } }
  } catch (e: any) {
    return { error: e.message ?? "Failed to accept invitation" }
  }
}
