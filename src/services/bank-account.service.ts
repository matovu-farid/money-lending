import { Effect } from "effect"
import { db } from "@/lib/db"
import { bankAccounts } from "@/lib/db/schema/bank-accounts"
import { eq, asc } from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import { isUniqueConstraintError } from "@/lib/db-errors"
import { writeAuditLog } from "./audit.service"
import type { CreateBankAccountInput, UpdateBankAccountInput, BankAccount } from "@/types"

export const createBankAccount = (
  input: CreateBankAccountInput,
  actorId: string
): Effect.Effect<BankAccount, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [account] = await tx
          .insert(bankAccounts)
          .values({
            ...(input.id ? { id: input.id } : {}),
            name: input.name.trim(),
            createdBy: actorId,
          })
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "bank_account.create",
          entityType: "bank_account",
          entityId: account.id,
          beforeValue: null,
          afterValue: account,
        })

        return account
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  }).pipe(
    Effect.catchIf(
      (e) => !!input.id && isUniqueConstraintError(e.cause),
      () => createBankAccount({ ...input, id: undefined }, actorId)
    )
  )

export const updateBankAccount = (
  input: UpdateBankAccountInput,
  actorId: string
): Effect.Effect<BankAccount, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(bankAccounts)
          .where(eq(bankAccounts.id, input.id))

        if (!before) throw new Error("Bank account not found")

        const updates: Partial<typeof bankAccounts.$inferInsert> = {}
        if (input.name !== undefined) updates.name = input.name.trim()
        if (input.isActive !== undefined) updates.isActive = input.isActive

        const [updated] = await tx
          .update(bankAccounts)
          .set(updates)
          .where(eq(bankAccounts.id, input.id))
          .returning()

        const action = input.isActive === false
          ? "bank_account.deactivate"
          : input.isActive === true && !before.isActive
            ? "bank_account.reactivate"
            : "bank_account.update"

        await writeAuditLog(tx, {
          actorId,
          action,
          entityType: "bank_account",
          entityId: updated.id,
          beforeValue: before,
          afterValue: updated,
        })

        return updated
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const listBankAccounts = (): Effect.Effect<BankAccount[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db
        .select()
        .from(bankAccounts)
        .orderBy(asc(bankAccounts.name))
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
