import { NextResponse } from "next/server"
import { sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { session, verification, invitations } from "@/lib/db/schema"

export async function GET(request: Request) {
  // Fail-closed: reject if CRON_SECRET is not configured
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  }

  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const deleted = { sessions: 0, verifications: 0, invitations: 0 }

  try {
    const rows = await db
      .delete(session)
      .where(sql`${session.expiresAt} < now() - interval '1 day'`)
      .returning({ id: session.id })
    deleted.sessions = rows.length
  } catch (err) {
    console.error("[cleanup-cron] Failed to delete expired sessions:", err)
  }

  try {
    const rows = await db
      .delete(verification)
      .where(sql`${verification.expiresAt} < now() - interval '1 day'`)
      .returning({ id: verification.id })
    deleted.verifications = rows.length
  } catch (err) {
    console.error("[cleanup-cron] Failed to delete expired verifications:", err)
  }

  try {
    const rows = await db
      .delete(invitations)
      .where(
        sql`${invitations.status} IN ('accepted','rejected','expired') AND ${invitations.createdAt} < now() - interval '90 days'`,
      )
      .returning({ id: invitations.id })
    deleted.invitations = rows.length
  } catch (err) {
    console.error("[cleanup-cron] Failed to delete old invitations:", err)
  }

  console.log(
    `[cleanup-cron] Cleanup completed: sessions=${deleted.sessions}, verifications=${deleted.verifications}, invitations=${deleted.invitations}`,
  )

  return NextResponse.json({ success: true, deleted })
}
