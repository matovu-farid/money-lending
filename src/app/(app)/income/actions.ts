"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { recordIncome, deleteTransaction } from "@/services/transaction.service"
import { createCategory, deleteCategory } from "@/services/category.service"
import type { CreateIncomeInput, CreateCategoryInput } from "@/types"

async function getSessionOrThrow() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    throw new Error("Unauthorized")
  }
  return session
}

export async function recordIncomeAction(input: CreateIncomeInput) {
  const session = await getSessionOrThrow()
  await Effect.runPromise(recordIncome(input, session.user.id))
  revalidatePath("/income")
  revalidatePath("/transactions")
}

export async function deleteIncomeAction(id: string) {
  const session = await getSessionOrThrow()
  await Effect.runPromise(deleteTransaction(id, session.user.id))
  revalidatePath("/income")
  revalidatePath("/transactions")
}

export async function createIncomeCategoryAction(input: CreateCategoryInput) {
  const session = await getSessionOrThrow()
  await Effect.runPromise(createCategory(input, session.user.id))
  revalidatePath("/income")
}

export async function deleteIncomeCategoryAction(id: string) {
  const session = await getSessionOrThrow()
  await Effect.runPromise(deleteCategory(id, session.user.id))
  revalidatePath("/income")
}
