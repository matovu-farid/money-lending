"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import {
  createCreditor,
  updateCreditor,
  addInvestment,
  recordCreditorRepayment,
  listCreditors,
  getSystemCapital,
} from "@/services/creditor.service"
import { ROLE_LEVELS, type UserRole } from "@/types"
import type {
  CreateCreditorInput,
  UpdateCreditorInput,
  AddInvestmentInput,
  RecordCreditorRepaymentInput,
} from "@/types"

export async function listCreditorsAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(listCreditors())
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function getSystemCapitalAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(getSystemCapital())
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function createCreditorAction(input: CreateCreditorInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }
  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.loanOfficer) return { error: "Forbidden" }

  if (!input.name?.trim()) return { error: "Creditor name is required" }
  if (!input.contact?.trim()) return { error: "Contact is required" }
  if (!input.address?.trim()) return { error: "Address is required" }

  try {
    const data = await Effect.runPromise(createCreditor(input, session.user.id))
    revalidatePath("/creditors")
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function updateCreditorAction(
  id: string,
  input: UpdateCreditorInput
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }
  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.loanOfficer) return { error: "Forbidden" }

  try {
    const data = await Effect.runPromise(updateCreditor(id, input, session.user.id))
    revalidatePath("/creditors")
    revalidatePath(`/creditors/${id}`)
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function addInvestmentAction(input: AddInvestmentInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }
  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.loanOfficer) return { error: "Forbidden" }

  if (!input.creditorId?.trim()) return { error: "Creditor ID is required" }
  if (!input.amount?.trim() || !/^\d+(\.\d{1,2})?$/.test(input.amount) || Number(input.amount) <= 0) {
    return { error: "A valid positive amount is required" }
  }
  if (!input.investmentDate?.trim() || isNaN(Date.parse(input.investmentDate))) {
    return { error: "A valid investment date is required" }
  }

  try {
    const data = await Effect.runPromise(addInvestment(input, session.user.id))
    revalidatePath("/creditors")
    revalidatePath(`/creditors/${input.creditorId}`)
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function recordCreditorRepaymentAction(
  input: RecordCreditorRepaymentInput
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }
  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.loanOfficer) return { error: "Forbidden" }

  if (!input.investmentId?.trim()) return { error: "Investment ID is required" }
  if (!input.amount?.trim() || !/^\d+(\.\d{1,2})?$/.test(input.amount) || Number(input.amount) <= 0) {
    return { error: "A valid positive amount is required" }
  }
  if (!input.repaymentDate?.trim() || isNaN(Date.parse(input.repaymentDate))) {
    return { error: "A valid repayment date is required" }
  }

  try {
    const data = await Effect.runPromise(recordCreditorRepayment(input, session.user.id))
    revalidatePath("/creditors")
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}
