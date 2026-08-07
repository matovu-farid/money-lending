import { Effect } from "effect"
import BigNumber from "bignumber.js"
import { db } from "@/lib/db"
import { rateChangeRequests } from "@/lib/db/schema/rate-change-requests"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { auditLog } from "@/lib/db/schema/audit"
import { user } from "@/lib/db/schema/auth"
import { getBaseRate } from "@/lib/interest/effective-rate"
import { eq, and, isNull, desc, count, inArray } from "drizzle-orm"
import { DatabaseError, LoanNotFound, RateChangeRequestNotFound, ValidationError } from "@/lib/errors"
import { isUniqueConstraintError } from "@/lib/db-errors"
import { writeAuditLog } from "./audit.service"
import { autoPostRateChangeAdjustment } from "./auto-post.service"
import { shortId } from "@/lib/utils"
import { assertLoanOperational } from "@/lib/loan-visibility"
import { captureServerWarning } from "@/lib/sentry"
import type {
  CreateRateChangeRequestInput,
  ReviewRateChangeRequestInput,
  RateChangeRequest,
  LoanRateChangeHistoryEntry,
} from "@/types"

type DrizzleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type CancelPendingRateChangeReason =
  | "loan_closed"
  | "rolled_over"
  | "settled"
  | "fully_paid"

const CANCEL_NOTE: Record<CancelPendingRateChangeReason, string> = {
  loan_closed: "Cancelled: loan closed",
  rolled_over: "Cancelled: loan rolled over",
  settled: "Cancelled: loan settled with collateral",
  fully_paid: "Cancelled: loan fully paid",
}

/**
 * Auto-reject pending rate-change requests when a loan leaves the operational set.
 * Call inside the same transaction as the status change.
 */
export async function cancelPendingRateChangeRequestsForLoan(
  tx: DrizzleTransaction,
  loanId: string,
  reason: CancelPendingRateChangeReason,
  actorId: string,
): Promise<number> {
  const updated = await tx
    .update(rateChangeRequests)
    .set({
      status: "rejected",
      reviewNote: CANCEL_NOTE[reason],
      reviewedBy: actorId,
      reviewedAt: new Date(),
    })
    .where(
      and(
        eq(rateChangeRequests.loanId, loanId),
        eq(rateChangeRequests.status, "pending"),
      ),
    )
    .returning({ id: rateChangeRequests.id })
  return updated.length
}

export interface RateChangeRequestWithLoan extends RateChangeRequest {
  customerName: string
  loanRef: string
  principalAmount: string
}

/** The loan rate fields needed to compute its effective (base) rate. */
export type LoanRateInfo = { interestRate: string; interestRateOverride: string | null }

/** Thrown by {@link createPendingRateChangeRequest} when a pending request already exists. */
export const DUPLICATE_PENDING_TAG = "DuplicatePending" as const

const APPLIED_RATE_CHANGE_ACTIONS = [
  "loan.rate_change.immediate",
  "loan.rate_change.approved",
  "loan.rate_change.admin_adjusted",
] as const

type AppliedRateChangeAction = (typeof APPLIED_RATE_CHANGE_ACTIONS)[number]

function parseRateAuditValue(value: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}
  } catch {
    captureServerWarning("Rate-change audit value could not be parsed", {
      source: "rate-change.audit-parse",
    })
    return {}
  }
}

function rateFromAuditValue(value: Record<string, unknown>): string | null {
  const rate = value.interestRateOverride ?? value.interestRate
  return typeof rate === "string" ? rate : typeof rate === "number" ? String(rate) : null
}

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
    const [loan] = await tx
      .select({ id: loans.id, status: loans.status, deletedAt: loans.deletedAt })
      .from(loans)
      .where(eq(loans.id, params.loanId))
      .for("update")

    if (!loan || loan.deletedAt) {
      throw { _tag: "LoanNotFound", id: params.loanId }
    }
    assertLoanOperational(loan)

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
): Effect.Effect<RateChangeRequest, LoanNotFound | ValidationError | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [loan] = await db
        .select()
        .from(loans)
        .where(and(eq(loans.id, input.loanId), isNull(loans.deletedAt)))

      if (!loan) throw { _tag: "LoanNotFound", id: input.loanId }
      assertLoanOperational(loan)

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
      if (err?._tag === "ValidationError")
        return new ValidationError({
          message: (err.message as string) ?? "Loan is not active",
          field: err.field as string | undefined,
        })
      return new DatabaseError({ cause: e })
    },
  }).pipe(
    Effect.catchIf(
      (e) => e._tag === "DatabaseError" && !!input.id && isUniqueConstraintError(e.cause),
      () => createRateChangeRequest({ ...input, id: undefined }, requestedBy, requiredApproverRole, currentRate)
    )
  )

async function applyLoanRateChangeTransaction(
  tx: DrizzleTransaction,
  params: { loanId: string; newRate: string; actorId: string; action: AppliedRateChangeAction },
): Promise<void> {
  const [loan] = await tx
    .select()
    .from(loans)
    .where(and(eq(loans.id, params.loanId), isNull(loans.deletedAt)))
    .for("update")

  if (!loan) throw { _tag: "LoanNotFound", id: params.loanId }
  assertLoanOperational(loan)

  const oldRate = getBaseRate(loan)
  const newRate = new BigNumber(params.newRate)
  if (!newRate.isFinite() || newRate.isLessThanOrEqualTo(0) || newRate.isGreaterThanOrEqualTo(1)) {
    throw {
      _tag: "ValidationError",
      message: "Rate must be a decimal between 0 and 1",
      field: "requestedRate",
    }
  }
  if (new BigNumber(oldRate).isEqualTo(newRate)) {
    throw {
      _tag: "ValidationError",
      message: "Requested rate is the same as the current rate",
      field: "requestedRate",
    }
  }
  const normalizedRate = newRate.toFixed(4)

  await tx
    .update(loans)
    .set({ interestRateOverride: normalizedRate, updatedAt: new Date() })
    .where(eq(loans.id, params.loanId))

  await autoPostRateChangeAdjustment(tx, {
    loanId: params.loanId,
    oldRate,
    newRate: normalizedRate,
    actorId: params.actorId,
  })

  await writeAuditLog(tx, {
    actorId: params.actorId,
    action: params.action,
    entityType: "loan",
    entityId: params.loanId,
    beforeValue: { interestRate: oldRate },
    afterValue: { interestRateOverride: normalizedRate },
  })
}

function mapRateChangeError(error: unknown): LoanNotFound | ValidationError | DatabaseError {
  const err = error as Record<string, unknown>
  if (err?._tag === "LoanNotFound") return new LoanNotFound({ id: err.id as string })
  if (err?._tag === "ValidationError") {
    return new ValidationError({
      message: (err.message as string) ?? "Loan is not active",
      field: err.field as string | undefined,
    })
  }
  return new DatabaseError({ cause: error })
}

export const applyAdminRateAdjustment = (params: {
  loanId: string
  newRate: string
  actorId: string
}): Effect.Effect<void, LoanNotFound | ValidationError | DatabaseError> =>
  Effect.tryPromise({
    try: () => db.transaction((tx) => applyLoanRateChangeTransaction(tx, {
      ...params,
      action: "loan.rate_change.admin_adjusted",
    })),
    catch: mapRateChangeError,
  })

export const applyRateChangeImmediately = (
  loanId: string,
  newRate: string,
  actorId: string,
): Effect.Effect<void, LoanNotFound | ValidationError | DatabaseError> =>
  Effect.tryPromise({
    try: () => db.transaction((tx) => applyLoanRateChangeTransaction(tx, {
      loanId,
      newRate,
      actorId,
      action: "loan.rate_change.immediate",
    })),
    catch: mapRateChangeError,
  })

export const listLoanRateChangeHistory = (
  loanId: string,
): Effect.Effect<LoanRateChangeHistoryEntry[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db
        .select({
          id: auditLog.id,
          actorId: auditLog.actorId,
          actorName: user.name,
          action: auditLog.action,
          beforeValue: auditLog.beforeValue,
          afterValue: auditLog.afterValue,
          occurredAt: auditLog.occurredAt,
        })
        .from(auditLog)
        .leftJoin(user, eq(auditLog.actorId, user.id))
        .where(and(
          eq(auditLog.entityType, "loan"),
          eq(auditLog.entityId, loanId),
          inArray(auditLog.action, APPLIED_RATE_CHANGE_ACTIONS),
        ))
        .orderBy(desc(auditLog.occurredAt))

      return rows.flatMap((row) => {
        const fromRate = rateFromAuditValue(parseRateAuditValue(row.beforeValue))
        const toRate = rateFromAuditValue(parseRateAuditValue(row.afterValue))
        if (!fromRate || !toRate) return []
        return [{
          id: row.id,
          fromRate,
          toRate,
          actorId: row.actorId,
          actorName: row.actorName,
          changedAt: row.occurredAt,
        }]
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
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
): Effect.Effect<RateChangeRequest, RateChangeRequestNotFound | LoanNotFound | ValidationError | DatabaseError> =>
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
          const [loan] = await tx
            .select()
            .from(loans)
            .where(and(eq(loans.id, request.loanId), isNull(loans.deletedAt)))
            .for("update")

          if (!loan) throw { _tag: "LoanNotFound", id: request.loanId }
          assertLoanOperational(loan)

          const oldRate = getBaseRate(loan)
          const newRate = new BigNumber(request.requestedRate).toFixed(4)
          if (new BigNumber(oldRate).isEqualTo(newRate)) {
            throw {
              _tag: "ValidationError",
              message: "Requested rate is the same as the current rate",
              field: "requestedRate",
            }
          }

          // Apply the rate change to the loan
          await tx
            .update(loans)
            .set({ interestRateOverride: newRate, updatedAt: now })
            .where(eq(loans.id, request.loanId))

          // Reset accrual baseline so next accrual run uses the new rate
          await autoPostRateChangeAdjustment(tx, {
            loanId: request.loanId,
            oldRate,
            newRate,
            actorId: reviewerId,
          })

          await writeAuditLog(tx, {
            actorId: reviewerId,
            action: "loan.rate_change.approved",
            entityType: "loan",
            entityId: request.loanId,
            beforeValue: { interestRate: oldRate },
            afterValue: { interestRateOverride: newRate, requestId: request.id },
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
      if (err?._tag === "LoanNotFound") return new LoanNotFound({ id: err.id as string })
      if (err?._tag === "ValidationError") return new ValidationError({ message: err.message as string, field: err.field as string | undefined })
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
