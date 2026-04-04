"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { createFundTransfer, listFundTransfers } from "@/services/fund-transfer.service"
import { ROLE_LEVELS, type UserRole } from "@/types"
import type { CreateFundTransferInput } from "@/types"

export async function createFundTransferAction(input: CreateFundTransferInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.admin) {
    return { error: "Forbidden: admin access required" }
  }

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
  if (!input.amount?.trim() || !/^\d+(\.\d{1,2})?$/.test(input.amount)) {
    return { error: "Amount must be a valid decimal number" }
  }
  if (parseFloat(input.amount) <= 0) {
    return { error: "Amount must be greater than zero" }
  }

  try {
    const data = await Effect.runPromise(createFundTransfer(input, session.user.id))
    revalidatePath("/fund-transfers")
    revalidatePath("/reports/balance-sheet")
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function listFundTransfersAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  try {
    const data = await Effect.runPromise(listFundTransfers())
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}
