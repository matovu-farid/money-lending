import { db } from "@/lib/db"
import { adminIpAllowlist, ipBlockLog } from "@/lib/db/schema/ip-allowlist"
import { systemSettings } from "@/lib/db/schema/settings"
import { user as userTable } from "@/lib/db/schema/auth"
import { auditLog } from "@/lib/db/schema/audit"
import { clearCaches } from "@/lib/ip-allowlist"
import { eq, desc } from "drizzle-orm"

const TOGGLE_KEY = "ip_allowlist_enabled"

export interface AllowlistEntry {
  id: string
  ip: string
  lastSeenAt: string
}

export interface AdminQueue {
  userId: string
  name: string
  email: string
  role: string
  ips: AllowlistEntry[]
}

export interface BlockEntry {
  id: string
  userId: string
  userName: string
  userEmail: string
  ip: string
  attemptedAt: string
  path: string | null
}

export interface AllowlistState {
  enabled: boolean
  queues: AdminQueue[]
  recentBlocks: BlockEntry[]
}

export async function getAllowlistState(): Promise<AllowlistState> {
  const [toggleRows, allowlistRows, blockRows] = await Promise.all([
    db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, TOGGLE_KEY))
      .limit(1),
    db
      .select({
        id: adminIpAllowlist.id,
        ip: adminIpAllowlist.ip,
        lastSeenAt: adminIpAllowlist.lastSeenAt,
        userId: adminIpAllowlist.userId,
        name: userTable.name,
        email: userTable.email,
        role: userTable.role,
      })
      .from(adminIpAllowlist)
      .innerJoin(userTable, eq(adminIpAllowlist.userId, userTable.id))
      .orderBy(desc(adminIpAllowlist.lastSeenAt)),
    db
      .select({
        id: ipBlockLog.id,
        userId: ipBlockLog.userId,
        ip: ipBlockLog.ip,
        attemptedAt: ipBlockLog.attemptedAt,
        path: ipBlockLog.path,
        name: userTable.name,
        email: userTable.email,
      })
      .from(ipBlockLog)
      .innerJoin(userTable, eq(ipBlockLog.userId, userTable.id))
      .orderBy(desc(ipBlockLog.attemptedAt))
      .limit(50),
  ])

  const enabled = toggleRows[0]?.value === "true"

  const queueMap = new Map<string, AdminQueue>()
  for (const row of allowlistRows) {
    const existing = queueMap.get(row.userId)
    const entry: AllowlistEntry = {
      id: row.id,
      ip: row.ip,
      lastSeenAt: row.lastSeenAt.toISOString(),
    }
    if (existing) {
      existing.ips.push(entry)
    } else {
      queueMap.set(row.userId, {
        userId: row.userId,
        name: row.name,
        email: row.email,
        role: row.role ?? "unassigned",
        ips: [entry],
      })
    }
  }

  return {
    enabled,
    queues: [...queueMap.values()],
    recentBlocks: blockRows.map((b) => ({
      id: b.id,
      userId: b.userId,
      userName: b.name,
      userEmail: b.email,
      ip: b.ip,
      attemptedAt: b.attemptedAt.toISOString(),
      path: b.path,
    })),
  }
}

export async function setAllowlistEnabled(enabled: boolean, actorId: string): Promise<void> {
  const beforeRows = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, TOGGLE_KEY))
    .limit(1)
  const before = beforeRows[0]?.value ?? "false"
  const after = enabled ? "true" : "false"

  await db
    .insert(systemSettings)
    .values({ key: TOGGLE_KEY, value: after, updatedBy: actorId })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: after, updatedBy: actorId, updatedAt: new Date() },
    })

  await db.insert(auditLog).values({
    actorId,
    action: "update",
    entityType: "ip_allowlist",
    entityId: TOGGLE_KEY,
    beforeValue: before,
    afterValue: after,
  })

  clearCaches()
}

export async function removeAllowlistEntry(entryId: string, actorId: string): Promise<void> {
  const deleted = await db
    .delete(adminIpAllowlist)
    .where(eq(adminIpAllowlist.id, entryId))
    .returning({ ip: adminIpAllowlist.ip, userId: adminIpAllowlist.userId })

  if (deleted[0]) {
    await db.insert(auditLog).values({
      actorId,
      action: "delete",
      entityType: "ip_allowlist_entry",
      entityId: entryId,
      beforeValue: `${deleted[0].userId}:${deleted[0].ip}`,
      afterValue: null,
    })
  }

  clearCaches()
}

/**
 * Remove all allowlist entries for a single user. Used when a user is demoted
 * out of admin/superAdmin so they no longer anchor IP trust.
 */
export async function clearAllowlistForUser(userId: string): Promise<void> {
  await db.delete(adminIpAllowlist).where(eq(adminIpAllowlist.userId, userId))
  clearCaches()
}

export async function clearAllowlist(actorId: string): Promise<void> {
  await db.delete(adminIpAllowlist)
  await db.insert(auditLog).values({
    actorId,
    action: "clear",
    entityType: "ip_allowlist",
    entityId: "*",
    beforeValue: null,
    afterValue: null,
  })
  clearCaches()
}
