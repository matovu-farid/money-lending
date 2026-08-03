"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import { getSession, getErrorTag, getSessionPermissions } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import {
  type Permission,
  type CreateRateChangeRequestInput,
  type ReviewRateChangeRequestInput,
  type RateChangeRequest,
  type AdminRateAdjustmentInput,
  type LoanRateChangeHistoryEntry,
} from "@/types"
import { getBaseRate } from "@/lib/interest/effective-rate"
import {
  applyRateChangeImmediately,
  applyAdminRateAdjustment,
  listAllRequests,
  listRateChangeRequests,
  listRequestsForLoan,
  reviewRequest,
  countPendingRequests,
  getLoanRateForChange,
  createPendingRateChangeRequest,
  getRequestForReview,
  DUPLICATE_PENDING_TAG,
  listLoanRateChangeHistory,
  type RateChangeRequestWithLoan,
} from "@/services/rate-change-request.service"

type RequestRateChangeResult =
  | { error: string }
  | { data: { applied: true; message: string } }
  | { data: { applied: false; request: RateChangeRequest; message: string } }

function normalizeAdminRate(input: string): string | { error: string } {
  if (!input?.trim()) return { error: "Requested rate is required" }
  const rate = Number(input)
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) {
    return { error: "Rate must be a decimal between 0 and 1 (e.g., 0.10 for 10%)" }
  }
  return rate.toFixed(4)
}

export const adjustLoanInterestRateAction = withAction<
  AdminRateAdjustmentInput,
  { data: undefined } | { error: string }
>({
  permission: "loan:rate-adjust",
  action: async (session, input) => {
    if (!input.loanId?.trim()) return { error: "Loan ID is required" }
    const normalizedRate = normalizeAdminRate(input.requestedRate)
    if (typeof normalizedRate !== "string") return normalizedRate

    try {
      await Effect.runPromise(
        applyAdminRateAdjustment({
          loanId: input.loanId,
          newRate: normalizedRate,
          actorId: session.user.id,
        }),
      )
      revalidatePath("/loans")
      revalidatePath(`/loans/${input.loanId}`)
      return { data: undefined }
    } catch (error) {
      const tag = getErrorTag(error)
      if (tag === "LoanNotFound") return { error: "Loan not found" }
      if (tag === "ValidationError") {
        const message = error instanceof Error ? error.message : "Unable to adjust interest rate"
        return { error: message }
      }
      return { error: "Internal server error" }
    }
  },
})

export const listLoanRateHistoryAction = withAction<
  string,
  LoanRateChangeHistoryEntry[]
>({
  permission: "loan:read",
  effect: (_session, loanId) => listLoanRateChangeHistory(loanId),
  errors: { DatabaseError: "Internal server error" },
})

// This action has complex permission-based branching that doesn't fit withAction cleanly
export async function requestRateChangeAction(
  input: CreateRateChangeRequestInput,
): Promise<RequestRateChangeResult> {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  const perms = await getSessionPermissions(session)
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
  const loan = await getLoanRateForChange(input.loanId)

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
    const data = await createPendingRateChangeRequest({
      loanId: input.loanId,
      requestedRate: input.requestedRate,
      currentRate: effectiveRate,
      requestedBy: session.user.id,
      requiredApproverRole: requiredPermission,
    })

    revalidatePath("/approvals")
    revalidatePath(`/loans/${input.loanId}`)
    return { data: { applied: false as const, request: data, message: `Rate change request submitted for approval (requires ${requiredPermission})` } }
  } catch (error) {
    const err = error as Record<string, unknown>
    if (err?._tag === DUPLICATE_PENDING_TAG) {
      return { error: "A pending rate change request already exists for this loan" }
    }
    if (getErrorTag(error) === "LoanNotFound") {
      return { error: "Loan not found" }
    }
    return { error: "Internal server error" }
  }
}

export async function listAllRequestsAction(): Promise<
  { data: RateChangeRequestWithLoan[] } | { error: string }
> {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  const perms = await getSessionPermissions(session)
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

export const listRequestsForLoanAction = withAction<
  string,
  { data: RateChangeRequest[] } | { error: string }
>({
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
export async function reviewRateChangeRequestAction(
  input: ReviewRateChangeRequestInput,
): Promise<{ data: RateChangeRequest } | { error: string }> {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  const perms = await getSessionPermissions(session)
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
    const request = await getRequestForReview(input.requestId)

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

export async function countPendingRequestsAction(): Promise<{ data: number } | { error: string }> {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  const perms = await getSessionPermissions(session)
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
