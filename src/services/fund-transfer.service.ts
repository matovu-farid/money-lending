import { Effect } from "effect"
import { db } from "@/lib/db"
import { fundTransfers } from "@/lib/db/schema/fund-transfers"
import { desc, sql } from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import { isUniqueConstraintError } from "@/lib/db-errors"
import { writeAuditLog } from "./audit.service"
import { autoPostFundTransfer, autoPostCapitalInjection } from "./auto-post.service"
import type { CreateFundTransferInput, CreateCapitalInjectionInput, FundTransfer } from "@/types"

function resolveTransferTiming(
  input: { transferredAt?: string; backdateNote?: string },
  actorId: string,
): {
  transferredAt: Date
  backdatedFrom?: Date
  backdatedBy?: string
  backdatedAt?: Date
  backdateNote?: string
} {
  const transferredAt = input.transferredAt ? new Date(input.transferredAt) : new Date()
  if (!input.backdateNote?.trim()) {
    return { transferredAt }
  }
  return {
    transferredAt,
    backdatedFrom: new Date(),
    backdatedBy: actorId,
    backdatedAt: new Date(),
    backdateNote: input.backdateNote.trim(),
  }
}

function buildTransferValues(
  input: CreateFundTransferInput,
  actorId: string,
) {
  const timing = resolveTransferTiming(input, actorId)
  return {
    ...(input.id ? { id: input.id } : {}),
    fromLocation: input.fromLocation,
    toLocation: input.toLocation,
    amount: input.amount,
    transferredBy: actorId,
    note: input.note?.trim() || null,
    fromSubLocationId: input.fromSubLocationId ?? null,
    toSubLocationId: input.toSubLocationId ?? null,
    transferredAt: timing.transferredAt,
    ...(timing.backdateNote
      ? {
          backdatedFrom: timing.backdatedFrom,
          backdatedBy: timing.backdatedBy,
          backdatedAt: timing.backdatedAt,
          backdateNote: timing.backdateNote,
        }
      : {}),
  }
}

function buildInjectionValues(
  input: CreateCapitalInjectionInput,
  actorId: string,
) {
  const timing = resolveTransferTiming(input, actorId)
  return {
    ...(input.id ? { id: input.id } : {}),
    transferType: "capital_injection" as const,
    fromLocation: null,
    toLocation: input.toLocation,
    amount: input.amount,
    transferredBy: actorId,
    note: input.note?.trim() || null,
    toSubLocationId: input.toSubLocationId ?? null,
    transferredAt: timing.transferredAt,
    ...(timing.backdateNote
      ? {
          backdatedFrom: timing.backdatedFrom,
          backdatedBy: timing.backdatedBy,
          backdatedAt: timing.backdatedAt,
          backdateNote: timing.backdateNote,
        }
      : {}),
  }
}

export const createFundTransfer = (
  input: CreateFundTransferInput,
  actorId: string
): Effect.Effect<FundTransfer, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [transfer] = await tx
          .insert(fundTransfers)
          .values(buildTransferValues(input, actorId))
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "fund_transfer.create",
          entityType: "fund_transfer",
          entityId: transfer.id,
          beforeValue: null,
          afterValue: transfer,
        })

        // Post paired debit/credit fund transfer entries
        await autoPostFundTransfer(tx, {
          amount: input.amount,
          transferId: transfer.id,
          fromLocation: input.fromLocation,
          toLocation: input.toLocation,
          transactionDate: transfer.transferredAt.toISOString(),
          actorId,
          fromSubLocationId: input.fromSubLocationId,
          toSubLocationId: input.toSubLocationId,
        })

        return transfer
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  }).pipe(
    Effect.catchIf(
      (e) => !!input.id && isUniqueConstraintError(e.cause),
      () => createFundTransfer({ ...input, id: undefined }, actorId)
    )
  )

export const createCapitalInjection = (
  input: CreateCapitalInjectionInput,
  actorId: string
): Effect.Effect<FundTransfer, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [transfer] = await tx
          .insert(fundTransfers)
          .values(buildInjectionValues(input, actorId))
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "capital_injection.create",
          entityType: "fund_transfer",
          entityId: transfer.id,
          beforeValue: null,
          afterValue: transfer,
        })

        await autoPostCapitalInjection(tx, {
          amount: input.amount,
          transferId: transfer.id,
          toLocation: input.toLocation,
          transactionDate: transfer.transferredAt.toISOString(),
          actorId,
          subLocationId: input.toSubLocationId,
        })

        return transfer
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  }).pipe(
    Effect.catchIf(
      (e) => !!input.id && isUniqueConstraintError(e.cause),
      () => createCapitalInjection({ ...input, id: undefined }, actorId)
    )
  )

/**
 * Like createFundTransfer but also returns the Postgres transaction ID.
 * Required for Electric collections so the client can wait for the
 * specific transaction to appear in the shape stream before clearing
 * optimistic state.
 */
export const createFundTransferWithTxid = (
  input: CreateFundTransferInput,
  actorId: string
): Effect.Effect<{ transfer: FundTransfer; txid: number }, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [transfer] = await tx
          .insert(fundTransfers)
          .values(buildTransferValues(input, actorId))
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "fund_transfer.create",
          entityType: "fund_transfer",
          entityId: transfer.id,
          beforeValue: null,
          afterValue: transfer,
        })

        // Post paired debit/credit fund transfer entries
        await autoPostFundTransfer(tx, {
          amount: input.amount,
          transferId: transfer.id,
          fromLocation: input.fromLocation,
          toLocation: input.toLocation,
          transactionDate: transfer.transferredAt.toISOString(),
          actorId,
          fromSubLocationId: input.fromSubLocationId,
          toSubLocationId: input.toSubLocationId,
        })

        const txidRows = await tx.execute<{ txid: string }>(
          sql`SELECT pg_current_xact_id()::text as txid`
        )
        const txid = Number((txidRows as unknown as Array<{ txid: string }>)[0].txid)
        return { transfer, txid }
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  }).pipe(
    Effect.catchIf(
      (e) => !!input.id && isUniqueConstraintError(e.cause),
      () => createFundTransferWithTxid({ ...input, id: undefined }, actorId)
    )
  )

/**
 * Like createCapitalInjection but also returns the Postgres transaction ID.
 * Required for Electric collections so the client can wait for the
 * specific transaction to appear in the shape stream before clearing
 * optimistic state.
 */
export const createCapitalInjectionWithTxid = (
  input: CreateCapitalInjectionInput,
  actorId: string
): Effect.Effect<{ transfer: FundTransfer; txid: number }, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [transfer] = await tx
          .insert(fundTransfers)
          .values(buildInjectionValues(input, actorId))
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "capital_injection.create",
          entityType: "fund_transfer",
          entityId: transfer.id,
          beforeValue: null,
          afterValue: transfer,
        })

        await autoPostCapitalInjection(tx, {
          amount: input.amount,
          transferId: transfer.id,
          toLocation: input.toLocation,
          transactionDate: transfer.transferredAt.toISOString(),
          actorId,
          subLocationId: input.toSubLocationId,
        })

        const txidRows = await tx.execute<{ txid: string }>(
          sql`SELECT pg_current_xact_id()::text as txid`
        )
        const txid = Number((txidRows as unknown as Array<{ txid: string }>)[0].txid)
        return { transfer, txid }
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  }).pipe(
    Effect.catchIf(
      (e) => !!input.id && isUniqueConstraintError(e.cause),
      () => createCapitalInjectionWithTxid({ ...input, id: undefined }, actorId)
    )
  )

export const listFundTransfers = (): Effect.Effect<FundTransfer[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db
        .select()
        .from(fundTransfers)
        .orderBy(desc(fundTransfers.transferredAt))
        .limit(200)
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
