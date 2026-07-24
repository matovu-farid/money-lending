"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import { getErrorField, getErrorTag, getSessionPermissions, validateBackdating } from "@/lib/action-utils"
import { validatePositiveDecimal } from "@/lib/validators"
import { createFundTransferWithTxid, createCapitalInjectionWithTxid, listFundTransfers } from "@/services/fund-transfer.service"
import type { CreateFundTransferInput, CreateCapitalInjectionInput } from "@/types"
import { VALID_DEPOSIT_LOCATIONS } from "@/lib/constants"
import { sendAdminNotification } from "@/lib/email"
import { shortId } from "@/lib/utils"

// NOTE: No revalidatePath calls in these actions. The /fund-transfers and
// /reports/balance-sheet pages are client-rendered with TanStack DB collections
// that re-sync automatically via Electric shape streams + subscribeToTableChanges.
// revalidatePath would block the action response while Next re-fetches RSC for
// routes the user may not even be on, adding 1-2s of perceived latency.

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
    const sameBankAccount =
      input.fromLocation === "bank" &&
      input.fromSubLocationId &&
      input.fromSubLocationId === input.toSubLocationId
    if (input.fromLocation === input.toLocation && (input.fromLocation !== "bank" || sameBankAccount)) {
      return { error: "Source and destination must be different" }
    }
    if (input.fromLocation === "bank" && !input.fromSubLocationId) {
      return { error: "Please select a bank account for the source" }
    }
    if (input.toLocation === "bank" && !input.toSubLocationId) {
      return { error: "Please select a bank account for the destination" }
    }
    const amountErr = validatePositiveDecimal(input.amount, "Amount")
    if (amountErr) return { error: amountErr }

    const transferredAt = input.transferredAt?.trim() || new Date().toISOString()
    if (isNaN(Date.parse(transferredAt))) {
      return { error: "A valid transfer date is required" }
    }
    const perms = await getSessionPermissions(session)
    const backdateErr = validateBackdating(transferredAt, perms, {
      noteValue: input.backdateNote,
      noteErrorMessage: "A note is required when backdating to explain the reason",
    })
    if (backdateErr) return { error: backdateErr }

    try {
      const { transfer, txid } = await Effect.runPromise(
        createFundTransferWithTxid({ ...input, transferredAt }, session.user.id),
      )
      void sendAdminNotification("fund.transfer.created", {
        actorName: session.user.name ?? "Unknown",
        actorEmail: session.user.email,
        timestamp: new Date(),
        amount: input.amount,
        entityRef: `FT-${shortId(transfer.id).toUpperCase()}`,
        deepLinkPath: "/fund-transfers",
        notes: `From ${input.fromLocation} to ${input.toLocation}${input.note ? ` — ${input.note}` : ""}`,
      })
      return { data: transfer, txid }
    } catch (error) {
      if (getErrorTag(error) === "InsufficientFundsError") {
        const location = String(getErrorField(error, "location") ?? "the source location")
        const available = String(getErrorField(error, "available") ?? "0.00")
        const required = String(getErrorField(error, "required") ?? input.amount)
        return {
          error: `Insufficient funds in ${location}. Available: ${available}, required: ${required}. Transfer or inject funds first.`,
        }
      }
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
    if (input.toLocation === "bank" && !input.toSubLocationId) {
      return { error: "Please select a bank account" }
    }
    const amountErr = validatePositiveDecimal(input.amount, "Amount")
    if (amountErr) return { error: amountErr }

    const transferredAt = input.transferredAt?.trim() || new Date().toISOString()
    if (isNaN(Date.parse(transferredAt))) {
      return { error: "A valid transfer date is required" }
    }
    const perms = await getSessionPermissions(session)
    const backdateErr = validateBackdating(transferredAt, perms, {
      noteValue: input.backdateNote,
      noteErrorMessage: "A note is required when backdating to explain the reason",
    })
    if (backdateErr) return { error: backdateErr }

    try {
      const { transfer, txid } = await Effect.runPromise(
        createCapitalInjectionWithTxid({ ...input, transferredAt }, session.user.id),
      )
      void sendAdminNotification("capital.injection.created", {
        actorName: session.user.name ?? "Unknown",
        actorEmail: session.user.email,
        timestamp: new Date(),
        amount: input.amount,
        entityRef: `INJ-${shortId(transfer.id).toUpperCase()}`,
        deepLinkPath: "/fund-transfers",
        notes: `Injected to ${input.toLocation}${input.note ? ` — ${input.note}` : ""}`,
      })
      return { data: transfer, txid }
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
