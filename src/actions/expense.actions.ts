"use server"

import { Effect } from "effect"
import BigNumber from "bignumber.js"
import { withAction } from "@/lib/with-action"
import { getUserRole, getEffectivePermissions } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { recordExpense, deleteTransaction, listTransactions } from "@/services/transaction.service"
import { createCategory, deleteCategory, listCategories } from "@/services/category.service"
import { getLocationBalances } from "@/services/report.service"
import type { CreateTransactionInput, CreateCategoryInput, UserRole } from "@/types"

export const listExpenseTransactionsAction = withAction({
  permission: "expense:read",
  effect: () => listTransactions({ type: "debit", manualOnly: true }, 1, 50),
})

export const listExpenseCategoriesAction = withAction({
  permission: "expense:read",
  effect: () => listCategories("expense"),
})

export const recordExpenseAction = withAction<
  CreateTransactionInput,
  { success: true; resolvedCategory: { id: string; name: string } } | { error: string }
>({
  permission: "expense:create",
  action: async (session, input) => {
    if (!input.amount?.trim() || !/^\d+(\.\d{1,2})?$/.test(input.amount) || Number(input.amount) <= 0) {
      return { error: "A valid positive amount is required" }
    }
    if (!input.categoryName?.trim()) return { error: "Category is required" }
    if (!input.transactionDate?.trim() || isNaN(Date.parse(input.transactionDate))) {
      return { error: "A valid date is required" }
    }

    // No future dates
    const txDate = new Date(input.transactionDate)
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    txDate.setHours(0, 0, 0, 0)
    if (txDate.getTime() > todayStart.getTime()) {
      return { error: "Date cannot be in the future" }
    }

    // Backdating validation (same rules as loans)
    const daysDiff = Math.round((todayStart.getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24))
    if (daysDiff > 0) {
      const role = getUserRole(session) as UserRole
      const perms = await getEffectivePermissions(session.user.id, role)
      if (daysDiff > 3 && !perms.has("backdate:beyond-3-days")) {
        return { error: `Backdating beyond 3 days requires supervisor permission. You selected ${daysDiff} days ago.` }
      }
      if (!input.backdateNote?.trim()) {
        return { error: "A note is required when backdating to explain the reason" }
      }
    }

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
        const role = getUserRole(session) as UserRole
        const permsForFunds = await getEffectivePermissions(session.user.id, role)
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
      const debitTx = await Effect.runPromise(recordExpense(input, session.user.id))
      revalidatePath("/expenses")
      revalidatePath("/transactions")
      return {
        success: true as const,
        resolvedCategory: { id: debitTx.categoryId, name: input.categoryName.trim() },
      }
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

export const createExpenseCategoryAction = withAction<CreateCategoryInput, any>({
  permission: "expense:create",
  effect: (session, input) => createCategory(input, session.user.id),
  revalidate: ["/expenses"],
})

export const deleteExpenseCategoryAction = withAction<string, any>({
  permission: "expense:create",
  effect: (session, id) => deleteCategory(id, session.user.id),
  revalidate: ["/expenses"],
})
