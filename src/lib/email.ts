import { Resend } from "resend"
import { db } from "@/lib/db"
import { sql } from "drizzle-orm"
import { AdminNotificationTemplate } from "@/lib/emails"
import { formatNumberWithCommas } from "@/lib/utils"

const resend = new Resend(process.env.RESEND_API_KEY)

type NotificationEvent = "payment.created" | "payment.updated" | "payment.deleted" | "loan.disbursed"

type NotificationPayload = {
  actorName: string
  actorEmail: string
  loanRef: string      // e.g., "LOAN-A3B2C1D4"
  amount: string       // formatted UGX amount
  timestamp: Date
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

    const formattedAmount = formatNumberWithCommas(payload.amount)
    const subject = `${SUBJECT_MAP[event]} — ${payload.loanRef} — UGX ${formattedAmount}`

    const formattedTimestamp = payload.timestamp.toLocaleString("en-UG", {
      timeZone: process.env.BUSINESS_TIMEZONE || "Africa/Kampala",
      dateStyle: "full",
      timeStyle: "short",
    })

    await resend.emails.send({
      from: process.env.EMAIL_FROM || "Kaks Credit <noreply@fidexa.org>",
      to: adminEmails,
      subject,
      react: AdminNotificationTemplate({
        eventLabel: SUBJECT_MAP[event],
        actorName: payload.actorName,
        actorEmail: payload.actorEmail,
        loanRef: payload.loanRef,
        amount: formattedAmount,
        formattedTimestamp,
      }),
    })
  } catch (error) {
    // Fire-and-forget: log but never throw
    console.error("[Email] Failed to send admin notification:", error)
  }
}
