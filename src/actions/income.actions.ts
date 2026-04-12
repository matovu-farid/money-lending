"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import { getUserRole } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { recordIncome, deleteTransaction } from "@/services/transaction.service"
import { createCategory, deleteCategory } from "@/services/category.service"
import type { CreateTransactionInput, CreateCategoryInput } from "@/types"

export const recordIncomeAction = withAction<CreateTransactionInput, { success: true } | { error: string }>({
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
      await Effect.runPromise(recordIncome(input, session.user.id))
      revalidatePath("/income")
      revalidatePath("/transactions")
      return { success: true as const }
    } catch {
      return { error: "Internal server error" }
    }
  },
})

export const deleteIncomeAction = withAction<string, any>({
  minRole: "loanOfficer",
  effect: (session, id) => deleteTransaction(id, session.user.id, getUserRole(session) as string),
  revalidate: ["/income", "/transactions"],
})

export const createIncomeCategoryAction = withAction<CreateCategoryInput, any>({
  minRole: "loanOfficer",
  effect: (session, input) => createCategory(input, session.user.id),
  revalidate: ["/income"],
})

export const deleteIncomeCategoryAction = withAction<string, any>({
  minRole: "loanOfficer",
  effect: (session, id) => deleteCategory(id, session.user.id),
  revalidate: ["/income"],
})
