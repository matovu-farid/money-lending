"use server"

import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { ROLE_LEVELS, type UserRole } from "@/types"

const VALID_ROLES: UserRole[] = ["unassigned", "loanOfficer", "admin", "superAdmin"]

export async function assignRole(input: { userId: string; role: UserRole }) {
  // Get current user session
  const session = await auth.api.getSession({
    headers: await headers(),
  })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  const { userId, role: targetRole } = input

  // Validate input at runtime (TypeScript types are erased at runtime)
  if (!userId || typeof userId !== "string") {
    return { error: "User ID is required" }
  }
  if (!VALID_ROLES.includes(targetRole)) {
    return { error: "Invalid role" }
  }

  const actorRole = (session.user.role ?? "unassigned") as UserRole
  const actorLevel = ROLE_LEVELS[actorRole] ?? 0
  const targetLevel = ROLE_LEVELS[targetRole] ?? 0

  // AUTH-05: Cannot assign role at or above own level
  if (targetLevel >= actorLevel) {
    return { error: "Cannot assign role at or above your own level" }
  }

  // Only admin+ can assign roles at all
  if (actorLevel < ROLE_LEVELS.admin) {
    return { error: "Insufficient permissions to assign roles" }
  }

  try {
    await auth.api.setRole({
      body: { userId, role: targetRole },
      headers: await headers(),
    })
    return { success: true, role: targetRole }
  } catch {
    return { error: "Failed to update role" }
  }
}
