import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getSessionCookie } from "better-auth/cookies"
import { isIpAllowlistEnabled, isIpAllowed, recordBlock, getClientIp } from "@/lib/ip-allowlist"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { sql } from "drizzle-orm"

const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/verify-email", "/reset-password", "/accept-invite", "/access-blocked"]

// Max time to wait for a DB-backed lookup before treating the request as
// unauthenticated. Only used as a fallback when the cookie cache is missing —
// the hot path is `getSessionCookie` (no DB) and `auth.api.getSession` against
// the cookie cache (no DB).
const DB_LOOKUP_TIMEOUT_MS = 3_000

export async function proxy(request: NextRequest) {
  // Server actions are POST requests with their own auth (withAction).
  // Skip the middleware DB round-trip to avoid double session checks.
  if (request.method === "POST") {
    return NextResponse.next()
  }

  const { pathname } = request.nextUrl
  const isAuthPage = AUTH_PAGES.some((p) => pathname.startsWith(p))

  // Cheap, no-DB presence check — recommended better-auth pattern for
  // middleware. This only verifies the session token cookie is present, not
  // that it's still valid. Real validation happens at the page/server-action
  // layer; this is just for optimistic redirects.
  const sessionCookie = getSessionCookie(request)
  if (!sessionCookie) {
    if (isAuthPage) return NextResponse.next()
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
    console.error("[proxy] auth.api.getSession failed:", err)
  }

  if (!session?.user) {
    // Cookie present but invalid (tampered / expired DB session). Treat as
    // logged-out and redirect to login.
    if (isAuthPage) return NextResponse.next()
    const dest = request.cookies.has("has_account") ? "/login" : "/register"
    return NextResponse.redirect(new URL(dest, request.url))
  }

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
      // Fall through with whatever the session already has — better to send
      // the user to verify-email or pending-approval than to 500 the request.
      console.error("[proxy] user role lookup failed:", err)
    }
  }

  // Email not verified -- redirect to /verify-email (skip in test/Cypress env)
  if (!emailVerified && !isTestEnv) {
    if (pathname === "/verify-email") return NextResponse.next()
    return NextResponse.redirect(new URL("/verify-email", request.url))
  }

  // Unassigned users can ONLY access /pending-approval
  if (role === "unassigned") {
    if (pathname === "/pending-approval") return NextResponse.next()
    return NextResponse.redirect(new URL("/pending-approval", request.url))
  }

  // IP allowlist gate for lower-role users
  if (role !== "admin" && role !== "superAdmin") {
    if (await isIpAllowlistEnabled()) {
      const clientIp = getClientIp(request.headers)
      const allowed = clientIp ? await isIpAllowed(clientIp) : false
      if (!allowed) {
        // Best-effort log; never await
        void recordBlock(session.user.id, clientIp ?? "unknown", pathname)
        if (pathname === "/access-blocked") return NextResponse.next()
        return NextResponse.redirect(new URL("/access-blocked", request.url))
      }
    }
  }

  // Authenticated + assigned user visiting auth pages or /pending-approval -- redirect to dashboard
  if (isAuthPage || pathname === "/pending-approval") {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  // Authenticated user with an assigned role -- allow through
  return NextResponse.next()
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
