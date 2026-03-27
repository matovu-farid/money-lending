"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { recordPayment, editPayment, deletePayment, listPayments, searchActiveLoans, getRecentlyCollectedLoans } from "@/services/payment.service"
import { db } from "@/lib/db"
import { payments } from "@/lib/db/schema/payments"
import { eq } from "drizzle-orm"
import { PaymentNotFound, LoanNotFound } from "@/lib/errors"
import { ROLE_LEVELS, type UserRole } from "@/types"
import type { RecordPaymentInput, EditPaymentInput, DeletePaymentInput, ListPaymentsInput } from "@/types"
import { sendAdminNotification } from "@/lib/email"

/**
 * Records a new payment against a loan.
 * - Auth required
 * - Validates loanId and amount
 * - Amount must be a valid decimal number
 * - Calls recordPayment Effect service
 * - Revalidates loan detail page cache
 *
 * LOAN-06: Manual payment recording via Server Action.
 */
export async function recordPaymentAction(input: RecordPaymentInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  // Runtime validation (TypeScript types are erased at runtime)
  if (!input.loanId?.trim()) {
    return { error: "Loan ID is required" }
  }
  if (!input.amount?.trim() || !/^\d+(\.\d{1,2})?$/.test(input.amount)) {
    return { error: "Amount must be a valid decimal number (e.g. 150000 or 150000.00)" }
  }
  if (parseFloat(input.amount) <= 0) {
    return { error: "Amount must be greater than zero" }
  }
  if (!input.paymentDate?.trim()) {
    return { error: "Payment date is required" }
  }

  try {
    const data = await Effect.runPromise(recordPayment(input, session.user.id))
    revalidatePath(`/loans/${input.loanId}`)
    revalidatePath("/payments")
    void sendAdminNotification("payment.created", {
      actorName: session.user.name ?? "Unknown",
      actorEmail: session.user.email,
      loanRef: `LOAN-${input.loanId.slice(0, 8).toUpperCase()}`,
      amount: input.amount,
      timestamp: new Date(),
    })
    return { data }
  } catch (error) {
    if (error instanceof LoanNotFound) {
      return { error: "Loan not found" }
    }
    return { error: "Internal server error" }
  }
}

/**
 * Edits an existing payment (amount and/or date).
 * - Auth required
 * - Permission: own payment OR admin/superAdmin
 * - Reason required for audit log
 * - Triggers recalculation cascade
 *
 * LOAN-07: Payment edit via Server Action.
 */
export async function editPaymentAction(input: EditPaymentInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  // Runtime validation
  if (!input.paymentId?.trim()) {
    return { error: "Payment ID is required" }
  }
  if (!input.reason?.trim()) {
    return { error: "A reason is required to edit a payment" }
  }

  // Permission check: must be own payment or admin+
  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.admin) {
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, input.paymentId))
    if (!payment) {
      return { error: "Payment not found" }
    }
    if (payment.recordedBy !== session.user.id) {
      return { error: "You can only edit your own payments" }
    }
  }

  try {
    const data = await Effect.runPromise(editPayment(input, session.user.id))
    revalidatePath(`/loans/${data.loanId}`)
    void sendAdminNotification("payment.updated", {
      actorName: session.user.name ?? "Unknown",
      actorEmail: session.user.email,
      loanRef: `LOAN-${data.loanId.slice(0, 8).toUpperCase()}`,
      amount: data.amount,
      timestamp: new Date(),
    })
    return { data }
  } catch (error) {
    if (error instanceof PaymentNotFound) {
      return { error: "Payment not found" }
    }
    if (error instanceof LoanNotFound) {
      return { error: "Loan not found" }
    }
    return { error: "Internal server error" }
  }
}

/**
 * Soft-deletes a payment.
 * - Auth required
 * - Permission: own payment OR admin/superAdmin
 * - Reason required for audit log
 * - Triggers recalculation cascade; NEVER hard deletes
 *
 * LOAN-07: Payment delete via Server Action.
 */
export async function deletePaymentAction(input: DeletePaymentInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  // Runtime validation
  if (!input.paymentId?.trim()) {
    return { error: "Payment ID is required" }
  }
  if (!input.reason?.trim()) {
    return { error: "A reason is required to delete a payment" }
  }

  // Permission check: must be own payment or admin+
  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.admin) {
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, input.paymentId))
    if (!payment) {
      return { error: "Payment not found" }
    }
    if (payment.recordedBy !== session.user.id) {
      return { error: "You can only delete your own payments" }
    }
  }

  try {
    const data = await Effect.runPromise(deletePayment(input, session.user.id))
    revalidatePath(`/loans/${data.loanId}`)
    void sendAdminNotification("payment.deleted", {
      actorName: session.user.name ?? "Unknown",
      actorEmail: session.user.email,
      loanRef: `LOAN-${data.loanId.slice(0, 8).toUpperCase()}`,
      amount: data.amount,
      timestamp: new Date(),
    })
    return { data }
  } catch (error) {
    if (error instanceof PaymentNotFound) {
      return { error: "Payment not found" }
    }
    if (error instanceof LoanNotFound) {
      return { error: "Loan not found" }
    }
    return { error: "Internal server error" }
  }
}

/**
 * Lists all payments across all loans with pagination and filtering.
 * Auth required.
 *
 * PAY-01 through PAY-05: Global payments list with filtering.
 */
export async function listPaymentsAction(input: ListPaymentsInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  try {
    const data = await Effect.runPromise(listPayments(input))
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

/**
 * Lists all payments for a given loan (including soft-deleted).
 * Used in customer profile loan history to show payment breakdown.
 */
export async function getPaymentsByLoanAction(loanId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  if (!loanId?.trim()) {
    return { error: "Loan ID is required" }
  }

  try {
    const rows = await db
      .select()
      .from(payments)
      .where(eq(payments.loanId, loanId))
      .orderBy(payments.paymentDate)
    return { data: rows }
  } catch (error) {
    return { error: "Internal server error" }
  }
}

/**
 * Searches active loans by customer name for the quick-record combobox.
 * Returns up to 10 matching active loans.
 * QREC-01: Loan search without leaving payments page.
 */
export async function searchActiveLoansAction(query: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  const trimmed = query?.trim() ?? ""
  if (!trimmed) {
    return { data: [] }
  }

  try {
    const data = await Effect.runPromise(searchActiveLoans(trimmed))
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

/**
 * Returns the last N distinct loans the current user recorded payments for.
 * Used for recently-collected chips in quick-record dialog.
 * QREC-03: Recently-collected list for quick repeat selection.
 */
export async function getRecentlyCollectedLoansAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  try {
    const data = await Effect.runPromise(getRecentlyCollectedLoans(session.user.id, 5))
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}
