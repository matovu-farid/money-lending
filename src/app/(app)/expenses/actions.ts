"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { recordExpense, deleteTransaction } from "@/services/transaction.service"
import { createCategory, deleteCategory } from "@/services/category.service"
import type { CreateExpenseInput, CreateCategoryInput } from "@/types"

async function getSessionOrThrow() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    throw new Error("Unauthorized")
  }
  return session
}

export async function recordExpenseAction(input: CreateExpenseInput) {
  const session = await getSessionOrThrow()
  await Effect.runPromise(recordExpense(input, session.user.id))
  revalidatePath("/expenses")
  revalidatePath("/transactions")
}

export async function deleteExpenseAction(id: string) {
  const session = await getSessionOrThrow()
  await Effect.runPromise(deleteTransaction(id, session.user.id))
  revalidatePath("/expenses")
  revalidatePath("/transactions")
}

export async function createExpenseCategoryAction(input: CreateCategoryInput) {
  const session = await getSessionOrThrow()
  const category = await Effect.runPromise(createCategory(input, session.user.id))
  revalidatePath("/expenses")
  return category
}

export async function deleteExpenseCategoryAction(id: string) {
  const session = await getSessionOrThrow()
  await Effect.runPromise(deleteCategory(id, session.user.id))
  revalidatePath("/expenses")
}
