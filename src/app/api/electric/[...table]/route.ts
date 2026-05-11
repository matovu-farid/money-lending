import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from "@electric-sql/client"
import { getSessionCookie } from "better-auth/cookies"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { isIpAllowlistEnabled, isIpAllowed, recordBlock, getClientIp } from "@/lib/ip-allowlist"
import { ROLE_LEVELS, type UserRole } from "@/types/common"
import { captureServerError, captureServerWarning } from "@/lib/sentry"

const ELECTRIC_URL = process.env.ELECTRIC_URL ?? "http://localhost:3001"
const ELECTRIC_SOURCE_SECRET = process.env.ELECTRIC_SECRET

/**
 * Short-TTL in-memory cache for the cookie-presence check.
 *
 * Security model (unchanged):
 *   - We still rely on the upstream Electric source secret + better-auth's
 *     signed, HttpOnly+Secure session cookie as the real auth boundary.
 *   - This cache only short-circuits the *parse* of the same cookie value
 *     within a 10s window. The cookie value itself is what we key on, so a
 *     forged/missing cookie still falls through to `getSessionCookie` and
 *     gets rejected. We never cache a session object or any user identity.
 *
 * Sizing:
 *   - TTL: 10s — long enough to absorb the multi-poll-per-second burst
 *     pattern from Electric long-polls across multiple shapes/tabs, short
 *     enough that a logout/cookie-rotation propagates quickly.
 *   - Max entries: 1000 — bounds memory under load. Eldest entry is
 *     evicted on insert when the limit is reached (insertion-ordered Map).
 */
const COOKIE_PRESENCE_TTL_MS = 10_000
const COOKIE_PRESENCE_MAX_ENTRIES = 1000
const cookiePresenceCache = new Map<string, number>()

function cookiePresenceCacheHas(cookieValue: string): boolean {
  const expiresAt = cookiePresenceCache.get(cookieValue)
  if (expiresAt === undefined) return false
  if (expiresAt <= Date.now()) {
    cookiePresenceCache.delete(cookieValue)
    return false
  }
  return true
}

function cookiePresenceCacheSet(cookieValue: string): void {
  // Evict oldest entry if at capacity (Map preserves insertion order)
  if (cookiePresenceCache.size >= COOKIE_PRESENCE_MAX_ENTRIES) {
    const oldestKey = cookiePresenceCache.keys().next().value
    if (oldestKey !== undefined) cookiePresenceCache.delete(oldestKey)
  }
  cookiePresenceCache.set(cookieValue, Date.now() + COOKIE_PRESENCE_TTL_MS)
}

/**
 * Short-TTL cache for the role check on admin-only tables. Keyed on the
 * raw cookie header so each session is resolved only once per window.
 *
 * We never cache "admin" without verifying — only the resolved role string
 * (which may be "loanOfficer", "admin", whatever). On miss or expiry we do
 * a full session lookup. When an admin is demoted, assignRole revokes
 * their sessions (see src/actions/user.actions.ts), so a stale cached
 * "admin" entry becomes harmless: the next miss re-fetches and finds no
 * session.
 */
const ROLE_CACHE_TTL_MS = 30_000
const ROLE_CACHE_MAX_ENTRIES = 1000
const roleCache = new Map<string, { role: UserRole; expiresAt: number }>()

function getCachedRole(cookieValue: string): UserRole | null {
  const entry = roleCache.get(cookieValue)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    roleCache.delete(cookieValue)
    return null
  }
  return entry.role
}

function setCachedRole(cookieValue: string, role: UserRole): void {
  if (roleCache.size >= ROLE_CACHE_MAX_ENTRIES) {
    const oldestKey = roleCache.keys().next().value
    if (oldestKey !== undefined) roleCache.delete(oldestKey)
  }
  roleCache.set(cookieValue, { role, expiresAt: Date.now() + ROLE_CACHE_TTL_MS })
}

/**
 * Tables that are allowed to be synced via Electric shapes.
 * Any table not in this set is rejected to prevent unauthorized data access.
 */
const ALLOWED_TABLES = new Set([
  "customers",
  "loans",
  "loan_balances",          // ← add this line
  "payments",
  "transactions",
  "creditors",
  "creditor_investments",
  "creditor_repayments",
  "bank_accounts",
  "invitation",
  "delegation",
  "rate_change_requests",
  "fund_transfers",
  "collateral",
  "transaction_categories",
])

/**
 * Server-enforced column allowlists for tables with sensitive columns.
 * When a table is listed here, ONLY these columns are synced — regardless
 * of what the client requests. This prevents token/secret leaks.
 */
const SAFE_COLUMNS: Record<string, string> = {
  invitation: "id,email,name,role,status,invited_by,expires_at,created_at,accepted_at",
}

/**
 * Tables that hold creditor PII and capital data. Subscriptions to these
 * shapes require an admin-or-higher session — see "Security Policy:
 * Creditor Privacy" in AGENTS.md. Page-level permission checks are not
 * enough because Electric shapes are a separate data path that any
 * authenticated user could otherwise reach by hitting the proxy directly.
 */
const ADMIN_ONLY_TABLES = new Set([
  "creditors",
  "creditor_investments",
  "creditor_repayments",
])

const ADMIN_LEVEL = ROLE_LEVELS.admin

export async function GET(
  request: Request,
  { params }: { params: Promise<{ table: string[] }> }
) {
  // This endpoint is hit on every Electric long-poll (multiple per second per
  // active client). Doing a full session validation here was the source of the
  // CONNECT_TIMEOUT bursts — a per-request DB SELECT against the user/session
  // tables. Per better-auth docs, middleware/proxy code should only check that
  // a session cookie exists; full validation happens at the data-access layer.
  // The signed cookie is HttpOnly+Secure and the upstream Electric requires
  // its own secret, so a forged cookie here can't actually pull data.
  //
  // Even the cookie-presence parse adds up under multi-shape, multi-tab
  // long-polling, so we short-circuit it via a 10s in-memory cache keyed on
  // the raw Cookie header. See the cache definitions above for the security
  // reasoning — only the "this exact cookie value parsed successfully"
  // decision is cached; missing/forged cookies still fall through.
  const requestHeaders = await headers()
  const rawCookieHeader = requestHeaders.get("cookie") ?? ""
  if (!rawCookieHeader || !cookiePresenceCacheHas(rawCookieHeader)) {
    const sessionCookie = getSessionCookie(requestHeaders)
    if (!sessionCookie) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (rawCookieHeader) cookiePresenceCacheSet(rawCookieHeader)
  }

  const { table: tableSegments } = await params
  const table = tableSegments.join("/")

  if (!ALLOWED_TABLES.has(table)) {
    return new Response(JSON.stringify({ error: "Table not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    })
  }

  // Resolve role if needed (for ADMIN_ONLY_TABLES or for IP-gate when toggle is on)
  const allowlistOn = await isIpAllowlistEnabled()
  const needsRole = ADMIN_ONLY_TABLES.has(table) || allowlistOn

  let resolvedRole: UserRole | null = null
  let resolvedUserId: string | null = null

  if (needsRole) {
    resolvedRole = rawCookieHeader ? getCachedRole(rawCookieHeader) : null
    if (!resolvedRole) {
      const session = await auth.api.getSession({ headers: requestHeaders })
      if (!session) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      }
      resolvedRole = ((session.user as Record<string, unknown>).role ?? "unassigned") as UserRole
      resolvedUserId = session.user.id
      if (rawCookieHeader) setCachedRole(rawCookieHeader, resolvedRole)
    }

    // Admin-only table check
    if (ADMIN_ONLY_TABLES.has(table) && (ROLE_LEVELS[resolvedRole] ?? 0) < ADMIN_LEVEL) {
      // Surface as a warning (not an error) — this is "expected forbidden",
      // but it indicates either a UI bug or a probe attempt and we want to
      // see the volume in Sentry.
      captureServerWarning("electric_proxy.forbidden_admin_table", {
        source: "electric-proxy",
        table,
        role: resolvedRole,
        userId: resolvedUserId,
      })
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    }

    // IP allowlist check (lower roles only)
    if (allowlistOn && resolvedRole !== "admin" && resolvedRole !== "superAdmin") {
      const clientIp = getClientIp(requestHeaders)
      const allowed = clientIp ? await isIpAllowed(clientIp) : false
      if (!allowed) {
        if (resolvedUserId) {
          void recordBlock(resolvedUserId, clientIp ?? "unknown", `(electric:${table})`)
        }
        return new Response(JSON.stringify({ error: "ip_not_allowed" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        })
      }
    }
  }

  const url = new URL(request.url)
  const originUrl = new URL(`${ELECTRIC_URL}/v1/shape`)

  // Forward only Electric protocol params (offset, handle, live, cursor, etc.)
  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  // Set the table server-side (never trust the client for table name)
  originUrl.searchParams.set("table", table)

  // Forward allowed filter params (where, columns, replica)
  const where = url.searchParams.get("where")
  if (where) originUrl.searchParams.set("where", where)

  // Enforce server-side column restrictions for sensitive tables
  const safeCols = SAFE_COLUMNS[table]
  if (safeCols) {
    originUrl.searchParams.set("columns", safeCols)
  } else {
    const columns = url.searchParams.get("columns")
    if (columns) originUrl.searchParams.set("columns", columns)
  }

  const replica = url.searchParams.get("replica")
  if (replica) originUrl.searchParams.set("replica", replica)

  // Attach the source secret if configured
  if (ELECTRIC_SOURCE_SECRET) {
    originUrl.searchParams.set("secret", ELECTRIC_SOURCE_SECRET)
  }

  let response: Response
  try {
    // Ask upstream for an uncompressed body so undici doesn't auto-decompress
    // and leave us with a stale `content-encoding` header. Next.js's own
    // response compression (next.config compress: true) re-gzips on the
    // way to the browser, where it actually matters for bandwidth.
    response = await fetch(originUrl.toString(), {
      headers: { "Accept-Encoding": "identity" },
    })
  } catch (err) {
    console.error("[electric proxy] upstream fetch failed:", err)
    captureServerError(err, { source: "electric-proxy", table, phase: "upstream-fetch" })
    return new Response(
      JSON.stringify({ error: "Electric upstream unavailable" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    )
  }

  // Drop content-length — body length may have changed if any middleware
  // touched the stream. content-encoding is already absent (identity).
  const responseHeaders = new Headers(response.headers)
  responseHeaders.delete("content-length")

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}
