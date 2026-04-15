import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { sql } from "drizzle-orm"

const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/verify-email", "/reset-password"]

export async function proxy(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: request.headers,
  })

  const { pathname } = request.nextUrl
  const isAuthPage = AUTH_PAGES.some((p) => pathname.startsWith(p))

  // No valid session -- redirect to auth page
  if (!session?.user) {
    if (isAuthPage) return NextResponse.next()
    // Returning user (has_account cookie) → login, new visitor → register
    const dest = request.cookies.has("has_account") ? "/login" : "/register"
    return NextResponse.redirect(new URL(dest, request.url))
  }

  // Email not verified -- redirect to /verify-email (skip in test/Cypress env)
  const isTestEnv = process.env.NODE_ENV === "test" || process.env.CYPRESS === "true"
  if (!session.user.emailVerified && !isTestEnv) {
    if (pathname === "/verify-email") return NextResponse.next()
    return NextResponse.redirect(new URL("/verify-email", request.url))
  }

  // Unassigned users can ONLY access /pending-approval -- redirect everywhere else.
  // Re-check the DB directly because the session may hold a stale role (e.g. the
  // first-user databaseHook promoted to superAdmin after the session was created).
  let role = (session.user as Record<string, unknown>).role as string | undefined
  if (role === "unassigned") {
    const rows = await db.execute(
      sql`SELECT "role" FROM "user" WHERE "id" = ${session.user.id}`
    )
    const dbRole = (rows as unknown as Array<{ role: string }>)[0]?.role
    if (dbRole && dbRole !== "unassigned") {
      role = dbRole
    }
  }
  if (role === "unassigned") {
    if (pathname === "/pending-approval") return NextResponse.next()
    return NextResponse.redirect(new URL("/pending-approval", request.url))
  }

  // Authenticated + assigned user visiting auth pages or /pending-approval -- redirect to dashboard
  if (isAuthPage || pathname === "/pending-approval") {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  // Authenticated user with an assigned role -- allow through
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
