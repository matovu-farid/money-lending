import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { pendingVerifications } from "@/lib/auth"

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production" || process.env.CYPRESS !== "true") {
    return NextResponse.json({ error: "Not available" }, { status: 404 })
  }

  const email = request.nextUrl.searchParams.get("email")
  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 })
  }

  const url = pendingVerifications.get(email)
  if (!url) {
    return NextResponse.json({ error: "no pending verification" }, { status: 404 })
  }

  pendingVerifications.delete(email)
  return NextResponse.json({ url })
}
