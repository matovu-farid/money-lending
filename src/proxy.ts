import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { auth } from "@/lib/auth"

const AUTH_PAGES = ["/login", "/register", "/forgot-password"]

export async function proxy(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: request.headers,
  })

  const { pathname } = request.nextUrl
  const isAuthPage = AUTH_PAGES.some((p) => pathname.startsWith(p))

  // No valid session -- redirect to login unless on auth page
  if (!session?.user) {
    if (isAuthPage) return NextResponse.next()
    return NextResponse.redirect(new URL("/login", request.url))
  }

  // Unassigned users can ONLY access /pending-approval -- redirect everywhere else
  if (session.user.role === "unassigned") {
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
