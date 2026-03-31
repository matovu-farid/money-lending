"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { recordPayment, editPayment, deletePayment, listPayments, searchActiveLoans, getRecentlyCollectedLoans } from "@/services/payment.service"
import { db } from "@/lib/db"
import { payments } from "@/lib/db/schema/payments"
import { eq, and, asc, isNull } from "drizzle-orm"
import { PaymentNotFound, LoanNotFound } from "@/lib/errors"
import { ROLE_LEVELS, type UserRole } from "@/types"
import type { RecordPaymentInput, EditPaymentInput, DeletePaymentInput, ListPaymentsInput } from "@/types"
import { sendAdminNotification } from "@/lib/email"

export async function recordPaymentAction(input: RecordPaymentInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

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

export async function editPaymentAction(input: EditPaymentInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

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

export async function deletePaymentAction(input: DeletePaymentInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

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
      .where(and(eq(payments.loanId, loanId), isNull(payments.deletedAt)))
      .orderBy(asc(payments.paymentDate), asc(payments.createdAt))
    return { data: rows }
  } catch (error) {
    return { error: "Internal server error" }
  }
}

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
