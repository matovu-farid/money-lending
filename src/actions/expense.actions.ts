"use server"

import { Effect } from "effect"
import BigNumber from "bignumber.js"
import { withAction } from "@/lib/with-action"
import { getUserRole, getSessionPermissions, validateBackdating } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { recordExpense, deleteTransaction, listTransactions } from "@/services/transaction.service"
import { sendAdminNotification } from "@/lib/email"
import { shortId } from "@/lib/utils"
import { validatePositiveAmount } from "@/lib/validators"
import { listDistinctTransactionCategories } from "@/services/category.service"
import { getLocationBalances } from "@/services/report.service"
import type { CreateTransactionInput } from "@/types"

export const listExpenseTransactionsAction = withAction({
  permission: "expense:read",
  effect: () => listTransactions({ type: "debit", manualOnly: true }, 1, 50),
})

/** Returns ALL manual expense rows (type=debit, referenceType IS NULL) for the collection queryFn. */
export const listExpensesAction = withAction({
  permission: "expense:read",
  effect: () => listTransactions({ type: "debit", manualOnly: true }, 1, 10_000),
})

/** Returns distinct user-typed expense categories for the combobox dropdown. */
export const listExpenseCategoriesAction = withAction({
  permission: "expense:read",
  effect: () => listDistinctTransactionCategories("debit"),
})

export const recordExpenseAction = withAction<
  CreateTransactionInput,
  { success: true } | { error: string }
>({
  permission: "expense:create",
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

    if (input.location === "bank" && !input.subLocationId) {
      return { error: "Please select a bank account" }
    }

    // Check sufficient funds at expense location
    const location = input.location || "cash"
    try {
      const balances = await Effect.runPromise(getLocationBalances())
      const available = new BigNumber(balances[location as "cash" | "bank" | "strong_room"] ?? "0")
      const amount = new BigNumber(input.amount)
      if (available.isLessThan(amount)) {
        const loc = location === "strong_room" ? "Strong Room" : location === "bank" ? "Bank" : "Cash on Hand"
        const permsForFunds = await getSessionPermissions(session)
        const isLoanOfficer = !permsForFunds.has("backdate:beyond-3-days")
        const action = isLoanOfficer
          ? "Ask your supervisor to transfer or inject funds before recording this expense."
          : "Transfer or inject funds first."
        return { error: `Insufficient funds in ${loc}. ${action}` }
      }
    } catch {
      return { error: "Unable to verify fund balances. Please try again." }
    }

    try {
      const tx = await Effect.runPromise(recordExpense(input, session.user.id))
      revalidatePath("/expenses")
      revalidatePath("/transactions")
      const txId = (tx as { id?: string } | undefined)?.id
      if (txId) {
        void sendAdminNotification("expense.recorded", {
          actorName: session.user.name ?? "Unknown",
          actorEmail: session.user.email,
          timestamp: new Date(),
          amount: input.amount,
          entityRef: `EXP-${shortId(txId).toUpperCase()}`,
          counterpartyLabel: "Category",
          counterpartyName: input.categoryName,
          deepLinkPath: "/expenses",
          notes: input.notes ?? undefined,
        })
      }
      return { success: true as const }
    } catch (err) {
      console.error("[recordExpenseAction]", err)
      return { error: "Internal server error" }
    }
  },
})

export const deleteExpenseAction = withAction<string, any>({
  permission: "expense:create",
  effect: (session, id) => deleteTransaction(id, session.user.id, getUserRole(session) as string),
  revalidate: ["/expenses", "/transactions"],
})
