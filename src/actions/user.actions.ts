"use server"

import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { getSession } from "@/lib/action-utils"
import { ROLE_LEVELS, type UserRole } from "@/types"

const VALID_ROLES: UserRole[] = ["unassigned", "loanOfficer", "supervisor", "admin", "superAdmin"]

export async function assignRole(input: { userId: string; role: UserRole }) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  const { userId, role: targetRole } = input

  if (!userId) {
    return { error: "User ID is required" }
  }
  if (!VALID_ROLES.includes(targetRole)) {
    return { error: "Invalid role" }
  }

  if (userId === session.user.id) {
    return { error: "Cannot change your own role" }
  }

  const actorRole = (session.user.role ?? "unassigned") as UserRole
  const actorLevel = ROLE_LEVELS[actorRole] ?? 0
  const targetLevel = ROLE_LEVELS[targetRole] ?? 0

  if (targetLevel >= actorLevel) {
    return { error: "Cannot assign role at or above your own level" }
  }

  if (actorLevel < ROLE_LEVELS.admin) {
    return { error: "Insufficient permissions to assign roles" }
  }

  try {
    // Verify the target user's current role is below the actor's level
    const targetUser = await auth.api.getUser({ query: { id: userId }, headers: await headers() })
    if (targetUser) {
      const existingRole = (targetUser.role ?? "unassigned") as UserRole
      const existingLevel = ROLE_LEVELS[existingRole] ?? 0
      if (existingLevel >= actorLevel) {
        return { error: "Cannot modify a user at or above your own role level" }
      }
    }

    await auth.api.setRole({
      body: { userId, role: targetRole },
      headers: await headers(),
    })
    return { data: { role: targetRole } }
  } catch {
    return { error: "Failed to update role" }
  }
}
