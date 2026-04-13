"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import { getUserRole } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { recordExpense, deleteTransaction, listTransactions } from "@/services/transaction.service"
import { createCategory, deleteCategory, listCategories } from "@/services/category.service"
import { ROLE_LEVELS } from "@/types"
import type { CreateTransactionInput, CreateCategoryInput, UserRole } from "@/types"

export const listExpenseTransactionsAction = withAction({
  effect: () => listTransactions({ type: "debit", manualOnly: true }, 1, 50),
})

export const listExpenseCategoriesAction = withAction({
  effect: () => listCategories("expense"),
})

export const recordExpenseAction = withAction<CreateTransactionInput, { success: true } | { error: string }>({
  minRole: "loanOfficer",
  action: async (session, input) => {
    if (!input.amount?.trim() || !/^\d+(\.\d{1,2})?$/.test(input.amount) || Number(input.amount) <= 0) {
      return { error: "A valid positive amount is required" }
    }
    if (!input.categoryId?.trim()) return { error: "Category is required" }
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
      if (daysDiff > 3 && ROLE_LEVELS[role] < ROLE_LEVELS.supervisor) {
        return { error: `Backdating beyond 3 days requires supervisor permission. You selected ${daysDiff} days ago.` }
      }
      if (!input.backdateNote?.trim()) {
        return { error: "A note is required when backdating to explain the reason" }
      }
    }

    try {
      await Effect.runPromise(recordExpense(input, session.user.id))
      revalidatePath("/expenses")
      revalidatePath("/transactions")
      return { success: true as const }
    } catch {
      return { error: "Internal server error" }
    }
  },
})

export const deleteExpenseAction = withAction<string, any>({
  minRole: "loanOfficer",
  effect: (session, id) => deleteTransaction(id, session.user.id, getUserRole(session) as string),
  revalidate: ["/expenses", "/transactions"],
})

export const createExpenseCategoryAction = withAction<CreateCategoryInput, any>({
  minRole: "loanOfficer",
  effect: (session, input) => createCategory(input, session.user.id),
  revalidate: ["/expenses"],
})

export const deleteExpenseCategoryAction = withAction<string, any>({
  minRole: "loanOfficer",
  effect: (session, id) => deleteCategory(id, session.user.id),
  revalidate: ["/expenses"],
})
