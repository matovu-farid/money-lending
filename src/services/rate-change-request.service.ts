import { Effect } from "effect"
import { db } from "@/lib/db"
import { rateChangeRequests } from "@/lib/db/schema/rate-change-requests"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { getBaseRate } from "@/lib/interest/effective-rate"
import { eq, and, isNull, desc, count } from "drizzle-orm"
import { DatabaseError, LoanNotFound, RateChangeRequestNotFound, ValidationError } from "@/lib/errors"
import { isUniqueConstraintError } from "@/lib/db-errors"
import { writeAuditLog } from "./audit.service"
import { autoPostRateChangeAdjustment } from "./auto-post.service"
import { shortId } from "@/lib/utils"
import type { CreateRateChangeRequestInput, ReviewRateChangeRequestInput, RateChangeRequest } from "@/types"

export interface RateChangeRequestWithLoan extends RateChangeRequest {
  customerName: string
  loanRef: string
  principalAmount: string
}

/** The loan rate fields needed to compute its effective (base) rate. */
export type LoanRateInfo = { interestRate: string; interestRateOverride: string | null }

/** Thrown by {@link createPendingRateChangeRequest} when a pending request already exists. */
export const DUPLICATE_PENDING_TAG = "DuplicatePending" as const

/**
 * Loads the rate fields for a non-deleted loan, or `undefined` if not found.
 */
export async function getLoanRateForChange(loanId: string): Promise<LoanRateInfo | undefined> {
  const [loan] = await db
    .select({ interestRate: loans.interestRate, interestRateOverride: loans.interestRateOverride })
    .from(loans)
    .where(and(eq(loans.id, loanId), isNull(loans.deletedAt)))
  return loan
}

/**
 * Creates a pending rate-change request inside a transaction that guards against
 * duplicate pending requests for the same loan (TOCTOU race). Throws
 * `{ _tag: DUPLICATE_PENDING_TAG }` if one already exists.
 */
export async function createPendingRateChangeRequest(params: {
  loanId: string
  requestedRate: string
  currentRate: string
  requestedBy: string
  requiredApproverRole: string
}): Promise<RateChangeRequest> {
  return db.transaction(async (tx) => {
    const [existingPending] = await tx
      .select({ id: rateChangeRequests.id })
      .from(rateChangeRequests)
      .where(
        and(
          eq(rateChangeRequests.loanId, params.loanId),
          eq(rateChangeRequests.status, "pending"),
        ),
      )
      .for("update")

    if (existingPending) {
      throw { _tag: DUPLICATE_PENDING_TAG }
    }

    const [request] = await tx
      .insert(rateChangeRequests)
      .values({
        loanId: params.loanId,
        requestedRate: params.requestedRate,
        currentRate: params.currentRate,
        requestedBy: params.requestedBy,
        requiredApproverRole: params.requiredApproverRole,
        status: "pending",
      })
      .returning()

    return request
  })
}

/** Loads the approval-routing fields for a request, or `undefined` if not found. */
export async function getRequestForReview(
  requestId: string,
): Promise<{ requiredApproverRole: string; loanId: string; requestedBy: string } | undefined> {
  const [request] = await db
    .select({
      requiredApproverRole: rateChangeRequests.requiredApproverRole,
      loanId: rateChangeRequests.loanId,
      requestedBy: rateChangeRequests.requestedBy,
    })
    .from(rateChangeRequests)
    .where(eq(rateChangeRequests.id, requestId))
  return request
}

export const createRateChangeRequest = (
  input: CreateRateChangeRequestInput,
  requestedBy: string,
  requiredApproverRole: string,
  currentRate: string
): Effect.Effect<RateChangeRequest, LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [loan] = await db
        .select()
        .from(loans)
        .where(eq(loans.id, input.loanId))

      if (!loan) throw { _tag: "LoanNotFound", id: input.loanId }

      const [request] = await db
        .insert(rateChangeRequests)
        .values({
          ...(input.id ? { id: input.id } : {}),
          loanId: input.loanId,
          requestedRate: input.requestedRate,
          currentRate,
          requestedBy,
          requiredApproverRole,
          status: "pending",
        })
        .returning()

      return request
    },
    catch: (e) => {
      const err = e as Record<string, unknown>
      if (err?._tag === "LoanNotFound") return new LoanNotFound({ id: err.id as string })
      return new DatabaseError({ cause: e })
    },
  }).pipe(
    Effect.catchIf(
      (e) => e._tag === "DatabaseError" && !!input.id && isUniqueConstraintError(e.cause),
      () => createRateChangeRequest({ ...input, id: undefined }, requestedBy, requiredApproverRole, currentRate)
    )
  )

export const applyRateChangeImmediately = (
  loanId: string,
  newRate: string,
  actorId: string
): Effect.Effect<void, LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      await db.transaction(async (tx) => {
        const [loan] = await tx
          .select()
          .from(loans)
          .where(eq(loans.id, loanId))
          .for("update")

        if (!loan) throw { _tag: "LoanNotFound", id: loanId }

        await tx
          .update(loans)
          .set({ interestRateOverride: newRate, updatedAt: new Date() })
          .where(eq(loans.id, loanId))

        // Reset accrual baseline so next accrual run uses the new rate
        await autoPostRateChangeAdjustment(tx, {
          loanId,
          oldRate: getBaseRate(loan),
          newRate,
          actorId,
        })

        await writeAuditLog(tx, {
          actorId,
          action: "loan.rate_change.immediate",
          entityType: "loan",
          entityId: loanId,
          beforeValue: { interestRateOverride: loan.interestRateOverride, interestRate: loan.interestRate },
          afterValue: { interestRateOverride: newRate },
        })
      })
    },
    catch: (e) => {
      const err = e as Record<string, unknown>
      if (err?._tag === "LoanNotFound") return new LoanNotFound({ id: err.id as string })
      return new DatabaseError({ cause: e })
    },
  })

export const listAllRequests = (): Effect.Effect<RateChangeRequestWithLoan[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db
        .select({
          id: rateChangeRequests.id,
          loanId: rateChangeRequests.loanId,
          requestedRate: rateChangeRequests.requestedRate,
          currentRate: rateChangeRequests.currentRate,
          requestedBy: rateChangeRequests.requestedBy,
          requiredApproverRole: rateChangeRequests.requiredApproverRole,
          status: rateChangeRequests.status,
          reviewedBy: rateChangeRequests.reviewedBy,
          reviewNote: rateChangeRequests.reviewNote,
          createdAt: rateChangeRequests.createdAt,
          reviewedAt: rateChangeRequests.reviewedAt,
          customerName: customers.fullName,
          principalAmount: loans.principalAmount,
        })
        .from(rateChangeRequests)
        .innerJoin(loans, eq(rateChangeRequests.loanId, loans.id))
        .innerJoin(customers, eq(loans.customerId, customers.id))
        .orderBy(desc(rateChangeRequests.createdAt))
        .limit(100)

      return rows.map((row) => ({
        ...row,
        loanRef: `LOAN-${shortId(row.loanId).toUpperCase()}`,
      }))
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const listRequestsForLoan = (
  loanId: string
): Effect.Effect<RateChangeRequest[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db
        .select()
        .from(rateChangeRequests)
        .where(eq(rateChangeRequests.loanId, loanId))
        .orderBy(desc(rateChangeRequests.createdAt))
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const reviewRequest = (
  input: ReviewRateChangeRequestInput,
  reviewerId: string
): Effect.Effect<RateChangeRequest, RateChangeRequestNotFound | ValidationError | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [request] = await tx
          .select()
          .from(rateChangeRequests)
          .where(eq(rateChangeRequests.id, input.requestId))
          .for("update")

        if (!request) throw { _tag: "RateChangeRequestNotFound", id: input.requestId }

        if (request.status !== "pending") {
          throw { _tag: "ValidationError", message: "Request has already been reviewed" }
        }

        const now = new Date()

        const [updated] = await tx
          .update(rateChangeRequests)
          .set({
            status: input.action,
            reviewedBy: reviewerId,
            reviewNote: input.reviewNote ?? null,
            reviewedAt: now,
          })
          .where(eq(rateChangeRequests.id, input.requestId))
          .returning()

        if (input.action === "approved") {
          // Apply the rate change to the loan
          await tx
            .update(loans)
            .set({ interestRateOverride: request.requestedRate, updatedAt: now })
            .where(eq(loans.id, request.loanId))

          // Reset accrual baseline so next accrual run uses the new rate
          await autoPostRateChangeAdjustment(tx, {
            loanId: request.loanId,
            oldRate: request.currentRate,
            newRate: request.requestedRate,
            actorId: reviewerId,
          })

          await writeAuditLog(tx, {
            actorId: reviewerId,
            action: "loan.rate_change.approved",
            entityType: "loan",
            entityId: request.loanId,
            beforeValue: { interestRate: request.currentRate },
            afterValue: { interestRateOverride: request.requestedRate, requestId: request.id },
          })
        } else {
          await writeAuditLog(tx, {
            actorId: reviewerId,
            action: "loan.rate_change.rejected",
            entityType: "rate_change_request",
            entityId: request.id,
            beforeValue: null,
            afterValue: { reviewNote: input.reviewNote ?? null },
          })
        }

        return updated
      })
    },
    catch: (e) => {
      const err = e as Record<string, unknown>
      if (err?._tag === "RateChangeRequestNotFound") return new RateChangeRequestNotFound({ id: err.id as string })
      if (err?._tag === "ValidationError") return new ValidationError({ message: err.message as string })
      return new DatabaseError({ cause: e })
    },
  })

export const countPendingRequests = (): Effect.Effect<number, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [result] = await db
        .select({ count: count() })
        .from(rateChangeRequests)
        .where(eq(rateChangeRequests.status, "pending"))
      return result?.count ?? 0
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

/**
 * Lists all rate change requests (base table columns only — no joins).
 * Used by the query-polled collection accessible to any user with loan:read.
 */
export const listRateChangeRequests = (): Effect.Effect<RateChangeRequest[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db
        .select()
        .from(rateChangeRequests)
        .orderBy(desc(rateChangeRequests.createdAt))
        .limit(200)
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
