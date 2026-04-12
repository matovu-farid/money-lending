"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import { getUserRole } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { recordExpense, deleteTransaction, listTransactions } from "@/services/transaction.service"
import { createCategory, deleteCategory, listCategories } from "@/services/category.service"
import type { CreateTransactionInput, CreateCategoryInput } from "@/types"

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
