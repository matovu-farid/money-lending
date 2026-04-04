import { Effect } from "effect"
import { db } from "@/lib/db"
import { fundTransfers } from "@/lib/db/schema/fund-transfers"
import { desc } from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import type { CreateFundTransferInput, FundTransfer } from "@/types"

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
