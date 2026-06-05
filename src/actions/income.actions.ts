"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import { getUserRole, getSessionPermissions, validateBackdating } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { recordIncome, deleteTransaction, listTransactions } from "@/services/transaction.service"
import { listDistinctTransactionCategories } from "@/services/category.service"
import { sendAdminNotification } from "@/lib/email"
import { shortId } from "@/lib/utils"
import { validatePositiveAmount } from "@/lib/validators"
import type { CreateTransactionInput } from "@/types"

export const listIncomeTransactionsAction = withAction({
  permission: "income:read",
  effect: () => listTransactions({ type: "credit", manualOnly: true }, 1, 50),
})

/** Returns ALL manual income rows (type=credit, referenceType IS NULL) for the collection queryFn. */
export const listIncomeAction = withAction({
  permission: "income:read",
  effect: () => listTransactions({ type: "credit", manualOnly: true }, 1, 10_000),
})

/** Returns distinct user-typed income categories for the combobox dropdown. */
export const listIncomeCategoriesAction = withAction({
  permission: "income:read",
  effect: () => listDistinctTransactionCategories("credit"),
})

export const recordIncomeAction = withAction<
  CreateTransactionInput,
  { success: true } | { error: string }
>({
  permission: "income:create",
  action: async (session, input) => {
    const amountErr = validatePositiveAmount(input.amount)
    if (amountErr) return { error: amountErr }
    if (!input.categoryName?.trim()) return { error: "Category is required" }
    if (!input.transactionDate?.trim() || isNaN(Date.parse(input.transactionDate))) {
      return { error: "A valid date is required" }
    }

    // Future-date + backdating validation (shared rules across loan/expense/income).
    const perms = await getSessionPermissions(session)
    const backdateErr = validateBackdating(input.transactionDate, perms, {
      noteValue: input.backdateNote,
      noteErrorMessage: "A note is required when backdating to explain the reason",
    })
    if (backdateErr) return { error: backdateErr }

    try {
      const tx = await Effect.runPromise(recordIncome(input, session.user.id))
      revalidatePath("/income")
      revalidatePath("/transactions")
      const txId = (tx as { id?: string } | undefined)?.id
      if (txId) {
        void sendAdminNotification("income.recorded", {
          actorName: session.user.name ?? "Unknown",
          actorEmail: session.user.email,
          timestamp: new Date(),
          amount: input.amount,
          entityRef: `INC-${shortId(txId).toUpperCase()}`,
          counterpartyLabel: "Category",
          counterpartyName: input.categoryName,
          deepLinkPath: "/income",
          notes: input.notes ?? undefined,
        })
      }
      return { success: true as const }
    } catch (err) {
      console.error("[recordIncomeAction]", err)
      return { error: "Internal server error" }
    }
  },
})

export const deleteIncomeAction = withAction<string, any>({
  permission: "income:create",
  effect: (session, id) => deleteTransaction(id, session.user.id, getUserRole(session) as string),
  revalidate: ["/income", "/transactions"],
})
