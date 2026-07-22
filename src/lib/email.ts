import { Resend } from "resend"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { sql } from "drizzle-orm"
import { AdminNotificationTemplate } from "@/lib/emails"
import { formatNumberWithCommas, shortId } from "@/lib/utils"
import { absoluteUrl } from "@/lib/urls"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { creditors } from "@/lib/db/schema/creditors"
import { creditorInvestments } from "@/lib/db/schema/creditor-investments"
import { creditorRepayments } from "@/lib/db/schema/creditor-repayments"

const resend = new Resend(process.env.RESEND_API_KEY)

export type NotificationEvent =
  | "loan.disbursed"
  | "payment.created"
  | "payment.updated"
  | "payment.deleted"
  | "expense.recorded"
  | "income.recorded"
  | "creditor.investment.recorded"
  | "creditor.repayment.recorded"
  | "fund.transfer.created"
  | "capital.injection.created"
  | "settlement.completed"
  | "loan.waiver"

const SUBJECT_MAP: Record<NotificationEvent, string> = {
  "loan.disbursed": "Loan disbursed",
  "payment.created": "Payment recorded",
  "payment.updated": "Payment updated",
  "payment.deleted": "Payment deleted",
  "expense.recorded": "Expense recorded",
  "income.recorded": "Income recorded",
  "creditor.investment.recorded": "Creditor investment received",
  "creditor.repayment.recorded": "Creditor repayment made",
  "fund.transfer.created": "Fund transfer recorded",
  "capital.injection.created": "Capital injection recorded",
  "settlement.completed": "Loan settled with collateral",
  "loan.waiver": "Loan amount waived",
}

/**
 * Money-flow direction for the event — drives the counterparty label
 * ("Paid to" vs "Received from") in the rendered email.
 */
const DIRECTION_MAP: Record<NotificationEvent, "in" | "out" | "internal"> = {
  "loan.disbursed": "out",
  "payment.created": "in",
  "payment.updated": "in",
  "payment.deleted": "in",
  "expense.recorded": "out",
  "income.recorded": "in",
  "creditor.investment.recorded": "in",
  "creditor.repayment.recorded": "out",
  "fund.transfer.created": "internal",
  "capital.injection.created": "in",
  "settlement.completed": "internal",
  "loan.waiver": "internal",
}

export type NotificationPayload = {
  /** Person who performed the action in the system (loan officer / cashier / admin). */
  actorName: string
  actorEmail: string
  /** ISO timestamp when the event happened. */
  timestamp: Date
  /** Unformatted amount (will be formatted with commas before render). */
  amount: string
  /** Free-form entity reference, e.g. "LOAN-A3B2C1D4" or "EXP-7F1C". */
  entityRef: string
  /** Counterparty name (customer, creditor, vendor) — optional for internal events. */
  counterpartyName?: string
  /** Counterparty role label, e.g. "Customer", "Creditor", "Vendor". */
  counterpartyLabel?: string
  /** Path within the app that links to the entity, e.g. "/loans/abc". */
  deepLinkPath: string
  /** Optional short note (description, category, transfer note). */
  notes?: string
}

/**
 * Resolve loan ref + customer counterparty from a loanId for the loan/payment
 * notification call sites that previously only had the loanId in scope.
 */
export async function resolveLoanContext(loanId: string): Promise<{
  entityRef: string
  counterpartyName?: string
  counterpartyLabel: string
  deepLinkPath: string
}> {
  const entityRef = `LOAN-${shortId(loanId).toUpperCase()}`
  const [loan] = await db.select().from(loans).where(eq(loans.id, loanId))
  if (!loan) return { entityRef, counterpartyLabel: "Customer", deepLinkPath: `/loans/${loanId}` }
  const [cust] = await db.select().from(customers).where(eq(customers.id, loan.customerId))
  return {
    entityRef,
    counterpartyName: cust?.fullName,
    counterpartyLabel: "Customer",
    deepLinkPath: `/loans/${loanId}`,
  }
}

/** Resolve creditor name + deep link from a creditor id. */
export async function resolveCreditorContext(creditorId: string): Promise<{
  counterpartyName?: string
  counterpartyLabel: string
  deepLinkPath: string
}> {
  const [cred] = await db.select().from(creditors).where(eq(creditors.id, creditorId))
  return {
    counterpartyName: cred?.name,
    counterpartyLabel: "Creditor",
    deepLinkPath: `/creditors/${creditorId}`,
  }
}

/** Resolve creditor info from a repayment id (joins through investment). */
export async function resolveCreditorRepaymentContext(repaymentId: string): Promise<{
  counterpartyName?: string
  counterpartyLabel: string
  deepLinkPath: string
  entityRef: string
}> {
  const [rep] = await db.select().from(creditorRepayments).where(eq(creditorRepayments.id, repaymentId))
  const entityRef = `REP-${shortId(repaymentId).toUpperCase()}`
  if (!rep) {
    return { entityRef, counterpartyLabel: "Creditor", deepLinkPath: "/creditors" }
  }
  const [inv] = await db.select().from(creditorInvestments).where(eq(creditorInvestments.id, rep.investmentId))
  if (!inv) {
    return { entityRef, counterpartyLabel: "Creditor", deepLinkPath: "/creditors" }
  }
  const ctx = await resolveCreditorContext(inv.creditorId)
  return { ...ctx, entityRef }
}

/**
 * Fire-and-forget admin notification helper.
 *
 * Wraps the repeating pattern at most action call sites:
 *   - awaits a context resolver (or accepts an already-resolved context),
 *   - derives `actor` from the session,
 *   - stamps `timestamp: new Date()`,
 *   - calls `sendAdminNotification` and swallows any error.
 *
 * Callers do not await — this returns void and never throws.
 */
export function notifyAdmin(opts: {
  eventType: NotificationEvent
  context:
    | Promise<Partial<NotificationPayload>>
    | Partial<NotificationPayload>
  session: { user: { name?: string | null; email: string } }
  amount: string
  entityRef?: string
  notes?: string
}): void {
  const { eventType, context, session, amount, entityRef, notes } = opts
  void Promise.resolve(context)
    .then((ctx) =>
      sendAdminNotification(eventType, {
        actorName: session.user.name ?? "Unknown",
        actorEmail: session.user.email,
        timestamp: new Date(),
        amount,
        // Allow context to supply entityRef (e.g. resolveLoanContext / resolveCreditorRepaymentContext),
        // but let an explicit caller-supplied entityRef win (e.g. INV-xxx built at the call site).
        ...ctx,
        ...(entityRef ? { entityRef } : {}),
        ...(notes ? { notes } : {}),
      } as NotificationPayload)
    )
    .catch((error) => {
      console.error("[Email] notifyAdmin failed:", error)
    })
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
    const subject = `${SUBJECT_MAP[event]} — ${payload.entityRef} — UGX ${formattedAmount}`

    const formattedTimestamp = payload.timestamp.toLocaleString("en-UG", {
      timeZone: process.env.BUSINESS_TIMEZONE || "Africa/Kampala",
      dateStyle: "full",
      timeStyle: "short",
    })

    const deepLink = absoluteUrl(payload.deepLinkPath)
    const direction = DIRECTION_MAP[event]
    const counterpartyHeading = direction === "out"
      ? "Paid to"
      : direction === "in"
      ? "Received from"
      : undefined

    await resend.emails.send({
      from: process.env.EMAIL_FROM || "Kaks Credit <noreply@fidexa.org>",
      to: adminEmails,
      subject,
      react: AdminNotificationTemplate({
        eventLabel: SUBJECT_MAP[event],
        actorName: payload.actorName,
        actorEmail: payload.actorEmail,
        entityRef: payload.entityRef,
        amount: formattedAmount,
        formattedTimestamp,
        deepLink,
        counterpartyHeading,
        counterpartyName: payload.counterpartyName,
        counterpartyLabel: payload.counterpartyLabel,
        notes: payload.notes,
      }),
    })
  } catch (error) {
    // Fire-and-forget: log but never throw
    console.error("[Email] Failed to send admin notification:", error)
  }
}
