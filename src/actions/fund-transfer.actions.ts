"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import { validatePositiveDecimal } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { createFundTransfer, createCapitalInjection, listFundTransfers } from "@/services/fund-transfer.service"
import type { CreateFundTransferInput, CreateCapitalInjectionInput } from "@/types"

export const createFundTransferAction = withAction<CreateFundTransferInput, any>({
  minRole: "admin",
  forbiddenMessage: "Forbidden: admin access required",
  action: async (session, input) => {
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
  },
})

export const createCapitalInjectionAction = withAction<CreateCapitalInjectionInput, any>({
  minRole: "admin",
  forbiddenMessage: "Forbidden: admin access required",
  action: async (session, input) => {
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
  },
})

export const listFundTransfersAction = withAction({
  minRole: "admin",
  forbiddenMessage: "Forbidden: admin access required",
  effect: () => listFundTransfers(),
})
