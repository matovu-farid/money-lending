"use server"

import { Effect } from "effect"
import { getSession, requireRole, validatePositiveDecimal } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { createFundTransfer, createCapitalInjection, listFundTransfers } from "@/services/fund-transfer.service"
import type { CreateFundTransferInput, CreateCapitalInjectionInput } from "@/types"

export async function createFundTransferAction(input: CreateFundTransferInput) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  const forbidden = requireRole(session, "admin", "Forbidden: admin access required")
  if (forbidden) return { error: forbidden }

  const validLocations = ["cash", "bank", "strong_room"]
  if (!input.fromLocation || !validLocations.includes(input.fromLocation)) {
    return { error: "Invalid source location" }
  }
  if (!input.toLocation || !validLocations.includes(input.toLocation)) {
    return { error: "Invalid destination location" }
  }
  if (input.fromLocation === input.toLocation) {
    return { error: "Source and destination must be different" }
  }
  const amountErr = validatePositiveDecimal(input.amount, "Amount")
  if (amountErr) return { error: amountErr }

  try {
    const data = await Effect.runPromise(createFundTransfer(input, session.user.id))
    revalidatePath("/fund-transfers")
    revalidatePath("/reports/balance-sheet")
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function createCapitalInjectionAction(input: CreateCapitalInjectionInput) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  const forbidden = requireRole(session, "admin", "Forbidden: admin access required")
  if (forbidden) return { error: forbidden }

  const validLocations = ["cash", "bank", "strong_room"]
  if (!input.toLocation || !validLocations.includes(input.toLocation)) {
    return { error: "Invalid deposit location" }
  }
  const amountErr = validatePositiveDecimal(input.amount, "Amount")
  if (amountErr) return { error: amountErr }

  try {
    const data = await Effect.runPromise(createCapitalInjection(input, session.user.id))
    revalidatePath("/fund-transfers")
    revalidatePath("/reports/balance-sheet")
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function listFundTransfersAction() {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  const forbidden = requireRole(session, "admin", "Forbidden: admin access required")
  if (forbidden) return { error: forbidden }

  try {
    const data = await Effect.runPromise(listFundTransfers())
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}
