import { db } from "@/lib/db"
import { adminIpAllowlist, ipBlockLog } from "@/lib/db/schema/ip-allowlist"
import { systemSettings } from "@/lib/db/schema/settings"
import { eq, sql } from "drizzle-orm"

const TOGGLE_KEY = "ip_allowlist_enabled"

const TOGGLE_TTL_MS = 30_000
const IP_TTL_MS = 30_000
const IP_CACHE_MAX = 1000

interface Deps {
  readSetting: (key: string) => Promise<string | null>
  ipExists: (ip: string) => Promise<boolean>
  upsertAllowlist: (userId: string, ip: string) => Promise<{ inserted: boolean }>
  trimAllowlist: (userId: string, cap: number) => Promise<void>
  insertBlock: (userId: string, ip: string, path: string) => Promise<void>
}

const defaultDeps: Deps = {
  async readSetting(key) {
    const rows = await db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, key))
      .limit(1)
    return rows[0]?.value ?? null
  },
  async ipExists(ip) {
    const rows = await db
      .select({ id: adminIpAllowlist.id })
      .from(adminIpAllowlist)
      .where(eq(adminIpAllowlist.ip, ip))
      .limit(1)
    return rows.length > 0
  },
  async upsertAllowlist(userId, ip) {
    const result = await db.execute(sql`
      INSERT INTO admin_ip_allowlist ("user_id", "ip", "last_seen_at")
      VALUES (${userId}, ${ip}, now())
      ON CONFLICT ("user_id", "ip") DO UPDATE SET "last_seen_at" = now()
      RETURNING (xmax = 0) AS inserted
    `)
    const row = (result as unknown as Array<{ inserted: boolean }>)[0]
    return { inserted: !!row?.inserted }
  },
  async trimAllowlist(userId, cap) {
    await db.execute(sql`
      DELETE FROM admin_ip_allowlist
      WHERE "id" IN (
        SELECT "id" FROM admin_ip_allowlist
        WHERE "user_id" = ${userId}
        ORDER BY "last_seen_at" ASC
        OFFSET ${cap}
      )
    `)
  },
  async insertBlock(userId, ip, path) {
    await db.insert(ipBlockLog).values({ userId, ip, path })
  },
}

let deps: Deps = defaultDeps

/** Test-only seam — replace selected dep methods. */
export function __setIpAllowlistDepsForTests(overrides: Partial<Deps>): void {
  deps = { ...defaultDeps, ...overrides }
}

// ─── Caches ───────────────────────────────────────────────────────────────

let toggleCache: { value: boolean; expiresAt: number } | null = null
const ipCache = new Map<string, { value: boolean; expiresAt: number }>()

export function clearCaches(): void {
  toggleCache = null
  ipCache.clear()
}

function ipCacheSet(ip: string, value: boolean): void {
  if (ipCache.size >= IP_CACHE_MAX) {
    const oldest = ipCache.keys().next().value
    if (oldest !== undefined) ipCache.delete(oldest)
  }
  ipCache.set(ip, { value, expiresAt: Date.now() + IP_TTL_MS })
}

// ─── Public API ───────────────────────────────────────────────────────────

export function getClientIp(headers: Headers): string | null {
  const fwd = headers.get("x-forwarded-for")
  if (fwd) {
    const first = fwd.split(",")[0]?.trim()
    if (first) return first
  }
  const real = headers.get("x-real-ip")
  return real?.trim() || null
}

export async function isIpAllowlistEnabled(): Promise<boolean> {
  if (toggleCache && toggleCache.expiresAt > Date.now()) return toggleCache.value
  try {
    const raw = await deps.readSetting(TOGGLE_KEY)
    const value = raw === "true"
    toggleCache = { value, expiresAt: Date.now() + TOGGLE_TTL_MS }
    return value
  } catch (err) {
    console.warn("[ip-allowlist] toggle read failed; failing open", err)
    return false
  }
}

export async function isIpAllowed(ip: string): Promise<boolean> {
  const hit = ipCache.get(ip)
  if (hit && hit.expiresAt > Date.now()) return hit.value
  try {
    const value = await deps.ipExists(ip)
    ipCacheSet(ip, value)
    return value
  } catch (err) {
    console.warn("[ip-allowlist] ip lookup failed; failing closed", err)
    return false
  }
}

export async function recordAdminLoginIp(userId: string, ip: string): Promise<void> {
  try {
    const { inserted } = await deps.upsertAllowlist(userId, ip)
    if (inserted) {
      ipCache.delete(ip)
      await deps.trimAllowlist(userId, 100)
    }
  } catch (err) {
    console.warn("[ip-allowlist] record login ip failed", { userId, ip, err })
  }
}

export async function recordBlock(userId: string, ip: string, path: string): Promise<void> {
  try {
    await deps.insertBlock(userId, ip, path)
  } catch (err) {
    console.warn("[ip-allowlist] block log insert failed", err)
  }
}
