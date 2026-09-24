import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getSessionCookie } from "better-auth/cookies"
import { isIpAllowlistEnabled, isIpAllowed, recordBlock, getClientIp, clearCaches } from "@/lib/ip-allowlist"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { sql } from "drizzle-orm"
import { captureServerWarning } from "@/lib/sentry"
import { AUTH_COOKIE_PREFIX } from "@/lib/auth-cookie"

const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/verify-email", "/reset-password", "/accept-invite", "/access-blocked"]
const PUBLIC_PAGES = ["/home", "/request-access"]

// Max time to wait for a DB-backed lookup before treating the request as
// unauthenticated. Only used as a fallback when the cookie cache is missing —
// the hot path is `getSessionCookie` (no DB) and `auth.api.getSession` against
// the cookie cache (no DB).
const DB_LOOKUP_TIMEOUT_MS = 3_000

const LEGACY_SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "better-auth-session_token",
  "__Secure-better-auth.session_token",
  "__Secure-better-auth-session_token",
] as const
const LEGACY_DONT_REMEMBER_COOKIE_NAMES = [
  "better-auth.dont_remember",
  "better-auth-dont_remember",
  "__Secure-better-auth.dont_remember",
  "__Secure-better-auth-dont_remember",
] as const

function authCookieIsSecure(): boolean {
  return process.env.BETTER_AUTH_URL
    ? process.env.BETTER_AUTH_URL.startsWith("https://")
    : process.env.NODE_ENV === "production"
}

function clearLegacySessionCookie(response: NextResponse, name: string): void {
  response.cookies.set({
    name,
    value: "",
    httpOnly: true,
    secure: name.startsWith("__Secure-") || authCookieIsSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
}

function legacySessionCookies(request: NextRequest): Array<{ name: string; token: string }> {
  const names = authCookieIsSecure()
    ? [...LEGACY_SESSION_COOKIE_NAMES].reverse()
    : LEGACY_SESSION_COOKIE_NAMES
  return names.flatMap((name) => {
    const token = request.cookies.get(name)?.value
    return token ? [{ name, token }] : []
  })
}

function hasLegacyDontRememberCookie(request: NextRequest): boolean {
  return LEGACY_DONT_REMEMBER_COOKIE_NAMES.some((name) => request.cookies.has(name))
}

async function validateLegacySession(request: NextRequest, token: string) {
  const secure = authCookieIsSecure()
  const cookieName = `${secure ? "__Secure-" : ""}${AUTH_COOKIE_PREFIX}.session_token`
  const headers = new Headers(request.headers)
  headers.set("cookie", `${cookieName}=${token}`)
  return auth.api.getSession({ headers })
}

async function clearValidLegacySessions(request: NextRequest, response: NextResponse): Promise<NextResponse> {
  for (const { name, token } of legacySessionCookies(request)) {
    try {
      if (await validateLegacySession(request, token)) clearLegacySessionCookie(response, name)
    } catch (err) {
      captureServerWarning("Legacy session cleanup failed", {
        source: "proxy.legacy-session-cleanup",
      })
      console.error("[proxy] legacy session cleanup failed:", err)
    }
  }
  return response
}

async function migrateLegacySession(request: NextRequest): Promise<NextResponse | null> {
  const secure = authCookieIsSecure()
  const sessionCookieName = `${secure ? "__Secure-" : ""}${AUTH_COOKIE_PREFIX}.session_token`

  // Better Auth's signed token is independent of its cookie name. Validate it
  // with this app's current auth configuration before copying it; a cookie
  // from another localhost app must never become a session here.
  for (const { name, token } of legacySessionCookies(request)) {
    try {
      const session = await validateLegacySession(request, token)
      if (!session?.user) continue

      const response = NextResponse.redirect(request.url)
      response.cookies.set({
        name: sessionCookieName,
        value: token,
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
        ...(!hasLegacyDontRememberCookie(request)
          ? { expires: new Date(session.session.expiresAt) }
          : {}),
      })
      clearLegacySessionCookie(response, name)
      return response
    } catch (err) {
      captureServerWarning("Legacy session migration failed", {
        source: "proxy.legacy-session-migration",
      })
      console.error("[proxy] legacy session migration failed:", err)
    }
  }
  return null
}

export async function proxy(request: NextRequest) {
  // Test-only: clear in-process IP caches from the middleware's own module
  // instance. The route-handler-based /api/test/clear-ip-cache endpoint runs
  // in a different module context and cannot reach the middleware cache.
  if (
    process.env.CYPRESS === "true" &&
    request.method === "POST" &&
    request.nextUrl.pathname === "/_test/clear-ip-middleware-cache"
  ) {
    clearCaches()
    return NextResponse.json({ ok: true })
  }

  // Server actions are POST requests with their own auth (withAction).
  // Skip the middleware DB round-trip to avoid double session checks.
  if (request.method === "POST") {
    return NextResponse.next()
  }

  const { pathname } = request.nextUrl
  const isAuthPage = AUTH_PAGES.some((p) => pathname.startsWith(p))
  const isPublicPage = PUBLIC_PAGES.includes(pathname)

  if (isPublicPage) return NextResponse.next()

  // Cheap, no-DB presence check — recommended better-auth pattern for
  // middleware. This only verifies the session token cookie is present, not
  // that it's still valid. Real validation happens at the page/server-action
  // layer; this is just for optimistic redirects.
  const sessionCookie = getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX })
  if (!sessionCookie) {
    const migrated = await migrateLegacySession(request)
    if (migrated) return migrated
    if (isAuthPage) return NextResponse.next()
    if (pathname === "/") {
      const dest = request.cookies.has("has_account") ? "/login" : "/home"
      return NextResponse.redirect(new URL(dest, request.url))
    }
    const dest = request.cookies.has("has_account") ? "/login" : "/register"
    return NextResponse.redirect(new URL(dest, request.url))
  }

  // We have a session token cookie — pull the full session from better-auth.
  // With cookieCache enabled this is cryptographic verification of a signed
  // cookie, not a DB query. Only the (rare) cache miss falls through to the DB.
  let session: Awaited<ReturnType<typeof auth.api.getSession>> = null
  try {
    session = await auth.api.getSession({ headers: request.headers })
  } catch (err) {
    captureServerWarning("Proxy session lookup failed; treating request as unauthenticated", {
      source: "proxy.session-lookup",
    })
    console.error("[proxy] auth.api.getSession failed:", err)
  }

  if (!session?.user) {
    // Cookie present but invalid (tampered / expired DB session). Treat as
    // logged-out and redirect to login.
    if (isAuthPage) return NextResponse.next()
    const dest = request.cookies.has("has_account") ? "/login" : "/register"
    return NextResponse.redirect(new URL(dest, request.url))
  }

  const finish = (response: NextResponse) => clearValidLegacySessions(request, response)

  const isTestEnv = process.env.NODE_ENV === "test" || process.env.CYPRESS === "true"
  let emailVerified = session.user.emailVerified
  let role = (session.user as Record<string, unknown>).role as string | undefined

  // Re-check the DB when the session holds potentially stale values.
  // The cookie cache is also stale-by-design (refreshes every cookieCache
  // maxAge), so this fallback covers the case where a user just verified
  // email or had a role assigned but their cached session predates that.
  if ((!emailVerified && !isTestEnv) || role === "unassigned") {
    try {
      const rows = await Promise.race([
        db.execute(
          sql`SELECT "role", "email_verified" FROM "user" WHERE "id" = ${session.user.id}`
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("user lookup timed out")), DB_LOOKUP_TIMEOUT_MS)
        ),
      ])
      const dbUser = (rows as unknown as Array<{ role: string; email_verified: boolean }>)[0]
      if (dbUser) {
        if (dbUser.email_verified) emailVerified = true
        if (dbUser.role && dbUser.role !== "unassigned") role = dbUser.role
      }
    } catch (err) {
      captureServerWarning("Proxy user role lookup failed; using cached session values", {
        source: "proxy.user-lookup",
      })
      // Fall through with whatever the session already has — better to send
      // the user to verify-email or pending-approval than to 500 the request.
      console.error("[proxy] user role lookup failed:", err)
    }
  }

  // Email not verified -- redirect to /verify-email (skip in test/Cypress env)
  if (!emailVerified && !isTestEnv) {
    if (pathname === "/verify-email") return finish(NextResponse.next())
    return finish(NextResponse.redirect(new URL("/verify-email", request.url)))
  }

  // Unassigned users can ONLY access /pending-approval
  if (role === "unassigned") {
    if (pathname === "/pending-approval") return finish(NextResponse.next())
    return finish(NextResponse.redirect(new URL("/pending-approval", request.url)))
  }

  // IP allowlist gate for lower-role users
  if (role !== "admin" && role !== "superAdmin") {
    if (await isIpAllowlistEnabled()) {
      const clientIp = getClientIp(request.headers)
      const allowed = clientIp ? await isIpAllowed(clientIp) : false
      if (!allowed) {
        // Best-effort log; never await
        void recordBlock(session.user.id, clientIp ?? "unknown", pathname)
        if (pathname === "/access-blocked") return finish(NextResponse.next())
        return finish(NextResponse.redirect(new URL("/access-blocked", request.url)))
      }
    }
  }

  // Authenticated + assigned user visiting auth pages or /pending-approval -- redirect to dashboard
  if (isAuthPage || pathname === "/pending-approval") {
    return finish(NextResponse.redirect(new URL("/dashboard", request.url)))
  }

  // Authenticated user with an assigned role -- allow through
  return finish(NextResponse.next())
}

export const config = {
  // Static / PWA assets that the browser fetches without credentials and that
  // never need session-gated content. Auth-redirecting these would cause the
  // browser to follow the 307 to /register, generating phantom /register hits
  // (manifest.json was the offender) and breaking PWA install / icon discovery.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.json|manifest.webmanifest|robots.txt|sitemap.xml|apple-touch-icon.*\\.png|icon-.*\\.png).*)",
  ],
}
