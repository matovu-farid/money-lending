"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import { getSession, getUserRole, getErrorTag, getEffectivePermissions } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { type Permission, type CreateRateChangeRequestInput, type ReviewRateChangeRequestInput } from "@/types"
import { getBaseRate } from "@/lib/interest/effective-rate"
import {
  applyRateChangeImmediately,
  listAllRequests,
  listRateChangeRequests,
  listRequestsForLoan,
  reviewRequest,
  countPendingRequests,
} from "@/services/rate-change-request.service"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { rateChangeRequests } from "@/lib/db/schema/rate-change-requests"
import { eq, and, isNull } from "drizzle-orm"

// This action has complex permission-based branching that doesn't fit withAction cleanly
export async function requestRateChangeAction(input: CreateRateChangeRequestInput) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  const role = getUserRole(session)
  const perms = await getEffectivePermissions(session.user.id, role)
  if (!perms.has("loan:create")) {
    return { error: "Forbidden" }
  }

  if (!input.loanId?.trim()) {
    return { error: "Loan ID is required" }
  }
  if (!input.requestedRate?.trim()) {
    return { error: "Requested rate is required" }
  }

  const requestedRateFloat = parseFloat(input.requestedRate)
  if (isNaN(requestedRateFloat) || requestedRateFloat <= 0 || requestedRateFloat >= 1) {
    return { error: "Rate must be a decimal between 0 and 1 (e.g., 0.10 for 10%)" }
  }

  // Look up the loan's current rate (exclude soft-deleted loans)
  const [loan] = await db
    .select({ interestRate: loans.interestRate, interestRateOverride: loans.interestRateOverride })
    .from(loans)
    .where(and(eq(loans.id, input.loanId), isNull(loans.deletedAt)))

  if (!loan) {
    return { error: "Loan not found" }
  }

  const effectiveRate = getBaseRate(loan)
  if (parseFloat(input.requestedRate) === parseFloat(effectiveRate)) {
    return { error: "Requested rate is the same as the current rate" }
  }

  const requiredPermission: Permission | null =
    requestedRateFloat >= 0.10 ? null :
    requestedRateFloat >= 0.08 ? "rate-change:approve-standard" :
    "rate-change:approve-low"

  // If no approval needed (rate >= 10%) or user has the required permission, apply immediately
  if (requiredPermission === null || perms.has(requiredPermission)) {
    try {
      await Effect.runPromise(
        applyRateChangeImmediately(input.loanId, input.requestedRate, session.user.id)
      )
      revalidatePath("/loans")
      revalidatePath(`/loans/${input.loanId}`)
      return { data: { applied: true as const, message: "Rate changed immediately" } }
    } catch (error) {
      if (getErrorTag(error) === "LoanNotFound") {
        return { error: "Loan not found" }
      }
      return { error: "Internal server error" }
    }
  }

  // Check + create inside a transaction to prevent duplicate pending requests (TOCTOU race)
  try {
    const data = await db.transaction(async (tx) => {
      const [existingPending] = await tx
        .select({ id: rateChangeRequests.id })
        .from(rateChangeRequests)
        .where(
          and(
            eq(rateChangeRequests.loanId, input.loanId),
            eq(rateChangeRequests.status, "pending")
          )
        )
        .for("update")

      if (existingPending) {
        throw { _tag: "DuplicatePending" as const }
      }

      const [request] = await tx
        .insert(rateChangeRequests)
        .values({
          loanId: input.loanId,
          requestedRate: input.requestedRate,
          currentRate: effectiveRate,
          requestedBy: session.user.id,
          requiredApproverRole: requiredPermission,
          status: "pending",
        })
        .returning()

      return request
    })

    revalidatePath("/approvals")
    revalidatePath(`/loans/${input.loanId}`)
    return { data: { applied: false as const, request: data, message: `Rate change request submitted for approval (requires ${requiredPermission})` } }
  } catch (error) {
    const err = error as Record<string, unknown>
    if (err?._tag === "DuplicatePending") {
      return { error: "A pending rate change request already exists for this loan" }
    }
    if (getErrorTag(error) === "LoanNotFound") {
      return { error: "Loan not found" }
    }
    return { error: "Internal server error" }
  }
}

export async function listAllRequestsAction() {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  const role = getUserRole(session)
  const perms = await getEffectivePermissions(session.user.id, role)
  if (!perms.has("rate-change:approve-standard")) {
    return { error: "Forbidden" }
  }

  try {
    const data = await Effect.runPromise(listAllRequests())
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export const listRequestsForLoanAction = withAction<string, any>({
  permission: "loan:read",
  action: async (_session, loanId) => {
    if (!loanId?.trim()) {
      return { error: "Loan ID is required" }
    }

    try {
      const data = await Effect.runPromise(listRequestsForLoan(loanId))
      return { data }
    } catch {
      return { error: "Internal server error" }
    }
  },
})

// This action has complex permission checking (requiredApproverRole per-request), keep inline auth
export async function reviewRateChangeRequestAction(input: ReviewRateChangeRequestInput) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  const role = getUserRole(session)
  const perms = await getEffectivePermissions(session.user.id, role)
  if (!perms.has("rate-change:approve-standard")) {
    return { error: "Forbidden" }
  }

  if (!input.requestId?.trim()) {
    return { error: "Request ID is required" }
  }
  if (input.action !== "approved" && input.action !== "rejected") {
    return { error: "Action must be 'approved' or 'rejected'" }
  }

  // Fetch the request to check requiredApproverRole
  try {
    const [request] = await db
      .select({
        requiredApproverRole: rateChangeRequests.requiredApproverRole,
        loanId: rateChangeRequests.loanId,
        requestedBy: rateChangeRequests.requestedBy,
      })
      .from(rateChangeRequests)
      .where(eq(rateChangeRequests.id, input.requestId))

    if (!request) {
      return { error: "Rate change request not found" }
    }

    // Prevent self-approval (I-6)
    if (session.user.id === request.requestedBy) {
      return { error: "You cannot review your own rate change request" }
    }

    const requiredPermission = request.requiredApproverRole as Permission
    if (!perms.has(requiredPermission)) {
      return { error: `You do not have permission to review this request (requires ${requiredPermission})` }
    }

    const data = await Effect.runPromise(
      reviewRequest(input, session.user.id)
    )
    revalidatePath("/approvals")
    revalidatePath(`/loans/${request.loanId}`)
    revalidatePath("/loans")
    return { data }
  } catch (error) {
    if (getErrorTag(error) === "RateChangeRequestNotFound") {
      return { error: "Rate change request not found" }
    }
    return { error: "Internal server error" }
  }
}

export const listRateChangeRequestsAction = withAction({
  permission: "loan:read",
  effect: () => listRateChangeRequests(),
})

export async function countPendingRequestsAction() {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  const role = getUserRole(session)
  const perms = await getEffectivePermissions(session.user.id, role)
  if (!perms.has("rate-change:approve-standard")) {
    return { data: 0 }
  }

  try {
    const count = await Effect.runPromise(countPendingRequests())
    return { data: count }
  } catch {
    return { data: 0 }
  }
}
