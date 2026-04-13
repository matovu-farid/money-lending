"use server"

import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { getSession, getUserRole, getEffectivePermissions } from "@/lib/action-utils"
import { ROLE_LEVELS, type UserRole, type Permission } from "@/types"

const VALID_ROLES: UserRole[] = ["unassigned", "loanOfficer", "supervisor", "admin", "superAdmin"]

/** Map each assignable role to the permission required to assign it. */
const ROLE_ASSIGN_PERMISSION: Record<string, Permission> = {
  loanOfficer: "role:assign-loan-officer",
  supervisor: "role:assign-supervisor",
  admin: "role:assign-admin",
  superAdmin: "role:assign-super-admin",
}

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

  const actorRole = getUserRole(session)
  const actorLevel = ROLE_LEVELS[actorRole] ?? 0
  const targetLevel = ROLE_LEVELS[targetRole] ?? 0

  // Keep hierarchy guard: can't assign at or above your own level
  if (targetLevel >= actorLevel) {
    return { error: "Cannot assign role at or above your own level" }
  }

  // Check permission for the specific role being assigned
  const requiredPermission = ROLE_ASSIGN_PERMISSION[targetRole]
  if (!requiredPermission) {
    return { error: "Cannot assign this role" }
  }

  const perms = await getEffectivePermissions(session.user.id, actorRole)
  if (!perms.has(requiredPermission)) {
    return { error: "Insufficient permissions to assign roles" }
  }

  try {
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

export async function getEffectivePermissionsAction(): Promise<string[]> {
  const session = await getSession()
  if (!session) return []
  const role = getUserRole(session)
  const perms = await getEffectivePermissions(session.user.id, role)
  return [...perms]
}
