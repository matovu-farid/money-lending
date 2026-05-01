import { NextResponse } from "next/server"
import { clearCaches } from "@/lib/ip-allowlist"

export async function POST() {
  if (process.env.CYPRESS !== "true") {
    return NextResponse.json({ error: "Not available" }, { status: 404 })
  }
  clearCaches()
  return NextResponse.json({ ok: true })
}
