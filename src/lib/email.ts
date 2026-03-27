import { Resend } from "resend"
import { db } from "@/lib/db"
import { sql } from "drizzle-orm"

const resend = new Resend(process.env.RESEND_API_KEY)

type NotificationEvent = "payment.created" | "payment.updated" | "payment.deleted" | "loan.disbursed"

type NotificationPayload = {
  actorName: string
  actorEmail: string
  loanRef: string      // e.g., "LOAN-A3B2C1D4"
  amount: string       // formatted UGX amount
  timestamp: Date
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const SUBJECT_MAP: Record<NotificationEvent, string> = {
  "payment.created": "Payment recorded",
  "payment.updated": "Payment updated",
  "payment.deleted": "Payment deleted",
  "loan.disbursed": "Loan disbursed",
}

export async function sendAdminNotification(
  event: NotificationEvent,
  payload: NotificationPayload
): Promise<void> {
  try {
    // Query DB for all active users with role admin or superAdmin
    // Better Auth stores users in the "user" table with a "role" column
    const adminUsers = await db.execute(
      sql`SELECT email FROM "user" WHERE role IN ('admin', 'superAdmin') AND "banned" IS NOT TRUE`
    )
    const adminEmails = (adminUsers as unknown as Array<{ email: string }>)
      .map((u) => u.email)
      .filter(Boolean)

    if (adminEmails.length === 0) {
      console.warn("[Email] No admin users found to notify")
      return
    }

    const subject = `${SUBJECT_MAP[event]} — ${payload.loanRef} — UGX ${payload.amount}`

    // Format timestamp in Africa/Kampala timezone
    const formattedTimestamp = payload.timestamp.toLocaleString("en-UG", {
      timeZone: process.env.BUSINESS_TIMEZONE || "Africa/Kampala",
      dateStyle: "full",
      timeStyle: "short",
    })

    const html = `
      <div style="font-family: sans-serif; max-width: 600px;">
        <h2 style="color: #333;">${SUBJECT_MAP[event]}</h2>
        <table style="border-collapse: collapse; width: 100%;">
          <tr><td style="padding: 8px; color: #666;">Event</td><td style="padding: 8px;">${SUBJECT_MAP[event]}</td></tr>
          <tr><td style="padding: 8px; color: #666;">Actor</td><td style="padding: 8px;">${escapeHtml(payload.actorName)} (${escapeHtml(payload.actorEmail)})</td></tr>
          <tr><td style="padding: 8px; color: #666;">Loan ref</td><td style="padding: 8px; font-family: monospace;">${escapeHtml(payload.loanRef)}</td></tr>
          <tr><td style="padding: 8px; color: #666;">Amount</td><td style="padding: 8px;">UGX ${escapeHtml(payload.amount)}</td></tr>
          <tr><td style="padding: 8px; color: #666;">Timestamp</td><td style="padding: 8px;">${formattedTimestamp}</td></tr>
        </table>
        <p style="color: #999; font-size: 12px; margin-top: 24px;">This is an automated notification from the lending system.</p>
      </div>
    `

    await resend.emails.send({
      from: process.env.EMAIL_FROM || "Lending Manager <noreply@fidexa.org>",
      to: adminEmails,
      subject,
      html,
    })
  } catch (error) {
    // Fire-and-forget: log but never throw
    console.error("[Email] Failed to send admin notification:", error)
  }
}
