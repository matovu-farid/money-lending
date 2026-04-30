"use server"

import { db } from "@/lib/db"
import { adminIpAllowlist, ipBlockLog } from "@/lib/db/schema/ip-allowlist"
import { systemSettings } from "@/lib/db/schema/settings"
import { user as userTable } from "@/lib/db/schema/auth"
import { auditLog } from "@/lib/db/schema/audit"
import { withAction } from "@/lib/with-action"
import { clearCaches } from "@/lib/ip-allowlist"
import { eq, desc } from "drizzle-orm"

const TOGGLE_KEY = "ip_allowlist_enabled"

interface AllowlistEntry {
  id: string
  ip: string
  lastSeenAt: string
}

interface AdminQueue {
  userId: string
  name: string
  email: string
  role: string
  ips: AllowlistEntry[]
}

interface BlockEntry {
  id: string
  userId: string
  userName: string
  userEmail: string
  ip: string
  attemptedAt: string
  path: string | null
}

interface AllowlistState {
  enabled: boolean
  queues: AdminQueue[]
  recentBlocks: BlockEntry[]
}

export const getIpAllowlistStateAction = withAction({
  permission: "ip-allowlist:manage",
  action: async (): Promise<{ data: AllowlistState }> => {
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
      data: {
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
      },
    }
  },
})

interface ToggleInput {
  enabled: boolean
}

export const setIpAllowlistEnabledAction = withAction<ToggleInput, { data: { ok: true } }>({
  permission: "ip-allowlist:manage",
  action: async (session, input) => {
    const beforeRows = await db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, TOGGLE_KEY))
      .limit(1)
    const before = beforeRows[0]?.value ?? "false"
    const after = input.enabled ? "true" : "false"

    await db
      .insert(systemSettings)
      .values({ key: TOGGLE_KEY, value: after, updatedBy: session.user.id })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: after, updatedBy: session.user.id, updatedAt: new Date() },
      })

    await db.insert(auditLog).values({
      actorId: session.user.id,
      action: "update",
      entityType: "ip_allowlist",
      entityId: TOGGLE_KEY,
      beforeValue: before,
      afterValue: after,
    })

    clearCaches()
    return { data: { ok: true as const } }
  },
})

interface RemoveInput {
  entryId: string
}

export const removeAllowlistEntryAction = withAction<RemoveInput, { data: { ok: true } }>({
  permission: "ip-allowlist:manage",
  action: async (session, input) => {
    const deleted = await db
      .delete(adminIpAllowlist)
      .where(eq(adminIpAllowlist.id, input.entryId))
      .returning({ ip: adminIpAllowlist.ip, userId: adminIpAllowlist.userId })

    if (deleted[0]) {
      await db.insert(auditLog).values({
        actorId: session.user.id,
        action: "delete",
        entityType: "ip_allowlist_entry",
        entityId: input.entryId,
        beforeValue: `${deleted[0].userId}:${deleted[0].ip}`,
        afterValue: null,
      })
    }

    clearCaches()
    return { data: { ok: true as const } }
  },
})

export const clearAllowlistAction = withAction({
  permission: "ip-allowlist:manage",
  action: async (session): Promise<{ data: { ok: true } }> => {
    await db.delete(adminIpAllowlist)
    await db.insert(auditLog).values({
      actorId: session.user.id,
      action: "clear",
      entityType: "ip_allowlist",
      entityId: "*",
      beforeValue: null,
      afterValue: null,
    })
    clearCaches()
    return { data: { ok: true as const } }
  },
})
