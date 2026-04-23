import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "test" && process.env.CYPRESS !== "true") {
    return NextResponse.json({ error: "Not available" }, { status: 404 })
  }

  const email = request.nextUrl.searchParams.get("email")
  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 })
  }

  // Dynamic import to avoid loading test code in production
  const { pendingInviteUrls } = await import("@/services/invitation.service")
  const url = pendingInviteUrls.get(email)

  if (!url) {
    return NextResponse.json({ error: "No pending invite URL" }, { status: 404 })
  }

  return NextResponse.json({ url })
}
