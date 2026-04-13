"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import { validatePositiveDecimal } from "@/lib/validators"
import { revalidatePath } from "next/cache"
import { createFundTransfer, createCapitalInjection, listFundTransfers } from "@/services/fund-transfer.service"
import type { CreateFundTransferInput, CreateCapitalInjectionInput } from "@/types"
import { VALID_DEPOSIT_LOCATIONS } from "@/lib/constants"

export const createFundTransferAction = withAction<CreateFundTransferInput, any>({
  permission: "fund-transfer:create",
  forbiddenMessage: "Forbidden: supervisor access required",
  action: async (session, input) => {
    if (!input.fromLocation || !VALID_DEPOSIT_LOCATIONS.includes(input.fromLocation)) {
      return { error: "Invalid source location" }
    }
    if (!input.toLocation || !VALID_DEPOSIT_LOCATIONS.includes(input.toLocation)) {
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
  permission: "fund-transfer:create",
  forbiddenMessage: "Forbidden: supervisor access required",
  action: async (session, input) => {
    if (!input.toLocation || !VALID_DEPOSIT_LOCATIONS.includes(input.toLocation)) {
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
  permission: "fund-transfer:read",
  forbiddenMessage: "Forbidden: supervisor access required",
  effect: () => listFundTransfers(),
})
