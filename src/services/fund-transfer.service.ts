import { Effect } from "effect"
import { db } from "@/lib/db"
import { fundTransfers } from "@/lib/db/schema/fund-transfers"
import { desc } from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import { autoPostFundTransfer, autoPostCapitalInjection } from "./auto-post.service"
import type { CreateFundTransferInput, CreateCapitalInjectionInput, FundTransfer } from "@/types"

export const createFundTransfer = (
  input: CreateFundTransferInput,
  actorId: string
): Effect.Effect<FundTransfer, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [transfer] = await tx
          .insert(fundTransfers)
          .values({
            fromLocation: input.fromLocation,
            toLocation: input.toLocation,
            amount: input.amount,
            transferredBy: actorId,
            note: input.note?.trim() || null,
          })
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
          transactionDate: transfer.createdAt.toISOString(),
          actorId,
        })

        return transfer
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const createCapitalInjection = (
  input: CreateCapitalInjectionInput,
  actorId: string
): Effect.Effect<FundTransfer, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [transfer] = await tx
          .insert(fundTransfers)
          .values({
            transferType: "capital_injection",
            fromLocation: null,
            toLocation: input.toLocation,
            amount: input.amount,
            transferredBy: actorId,
            note: input.note?.trim() || null,
          })
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
          transactionDate: transfer.createdAt.toISOString(),
          actorId,
        })

        return transfer
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const listFundTransfers = (): Effect.Effect<FundTransfer[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db
        .select()
        .from(fundTransfers)
        .orderBy(desc(fundTransfers.createdAt))
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
