"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { recordIncome, deleteTransaction } from "@/services/transaction.service"
import { createCategory, deleteCategory } from "@/services/category.service"
import { ROLE_LEVELS, type UserRole } from "@/types"
import type { CreateIncomeInput, CreateCategoryInput } from "@/types"

export async function recordIncomeAction(input: CreateIncomeInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }
  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.loanOfficer) return { error: "Forbidden" }

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
    return { success: true }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function deleteIncomeAction(id: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }
  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.loanOfficer) return { error: "Forbidden" }

  try {
    await Effect.runPromise(deleteTransaction(id, session.user.id, role as string))
    revalidatePath("/income")
    revalidatePath("/transactions")
    return { success: true }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function createIncomeCategoryAction(input: CreateCategoryInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }
  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.loanOfficer) return { error: "Forbidden" }

  try {
    const category = await Effect.runPromise(createCategory(input, session.user.id))
    revalidatePath("/income")
    return { data: category }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function deleteIncomeCategoryAction(id: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }
  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.loanOfficer) return { error: "Forbidden" }

  try {
    await Effect.runPromise(deleteCategory(id, session.user.id))
    revalidatePath("/income")
    return { success: true }
  } catch {
    return { error: "Internal server error" }
  }
}
