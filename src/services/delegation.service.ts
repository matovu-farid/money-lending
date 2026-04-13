import { db } from "@/lib/db"
import { delegations } from "@/lib/db/schema/delegations"
import { user } from "@/lib/db/schema/auth"
import { eq, isNull, and, desc } from "drizzle-orm"

export async function createDelegation(userId: string, delegatedBy: string) {
  // Check for existing active delegation
  const [existing] = await db
    .select({ id: delegations.id })
    .from(delegations)
    .where(and(eq(delegations.userId, userId), isNull(delegations.revokedAt)))
    .limit(1)

  if (existing) {
    throw new Error("User already has an active delegation")
  }

  // Verify user is a supervisor
  const [targetUser] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId))

  if (!targetUser || targetUser.role !== "supervisor") {
    throw new Error("Only supervisors can receive delegations")
  }

  const [row] = await db
    .insert(delegations)
    .values({ userId, delegatedBy })
    .returning()

  return row
}

export async function revokeDelegation(delegationId: string, revokedBy: string) {
  const [row] = await db
    .update(delegations)
    .set({ revokedAt: new Date(), revokedBy })
    .where(and(eq(delegations.id, delegationId), isNull(delegations.revokedAt)))
    .returning()

  if (!row) {
    throw new Error("Active delegation not found")
  }

  return row
}

export async function getActiveDelegation(userId: string) {
  const [row] = await db
    .select()
    .from(delegations)
    .where(and(eq(delegations.userId, userId), isNull(delegations.revokedAt)))
    .limit(1)

  return row ?? null
}

export async function listDelegations() {
  const rows = await db
    .select({
      id: delegations.id,
      userId: delegations.userId,
      userName: user.name,
      delegatedBy: delegations.delegatedBy,
      createdAt: delegations.createdAt,
      revokedAt: delegations.revokedAt,
      revokedBy: delegations.revokedBy,
    })
    .from(delegations)
    .leftJoin(user, eq(delegations.userId, user.id))
    .orderBy(desc(delegations.createdAt))

  return rows
}
