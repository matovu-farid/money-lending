"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import { getUserRole, getEffectivePermissions } from "@/lib/action-utils"
import { createBankAccountWithTxid, updateBankAccountWithTxid, listBankAccounts } from "@/services/bank-account.service"
import type { CreateBankAccountInput, UpdateBankAccountInput } from "@/types"

export const createBankAccountAction = withAction<CreateBankAccountInput, any>({
  permission: "fund-transfer:create",
  forbiddenMessage: "Forbidden: supervisor access required",
  action: async (session, input) => {
    if (!input.name || input.name.trim().length === 0) {
      return { error: "Bank account name is required" }
    }
    if (input.name.trim().length > 100) {
      return { error: "Bank account name must be 100 characters or fewer" }
    }

    try {
      const { account, txid } = await Effect.runPromise(createBankAccountWithTxid(input, session.user.id))
      return { data: account, txid }
    } catch {
      return { error: "Failed to create bank account. Name may already be in use." }
    }
  },
})

export const updateBankAccountAction = withAction<UpdateBankAccountInput, any>({
  permission: "fund-transfer:create",
  forbiddenMessage: "Forbidden: supervisor access required",
  action: async (session, input) => {
    if (!input.id) {
      return { error: "Bank account ID is required" }
    }

    // Deactivation/reactivation requires admin role
    if (input.isActive !== undefined) {
      const role = getUserRole(session)
      const perms = await getEffectivePermissions(session.user.id, role)
      if (!perms.has("settings:update")) {
        return { error: "Only admins can deactivate or reactivate bank accounts" }
      }
    }

    if (input.name !== undefined && input.name.trim().length === 0) {
      return { error: "Bank account name cannot be empty" }
    }

    try {
      const { account, txid } = await Effect.runPromise(updateBankAccountWithTxid(input, session.user.id))
      return { data: account, txid }
    } catch {
      return { error: "Failed to update bank account" }
    }
  },
})

export const listBankAccountsAction = withAction({
  permission: "fund-transfer:read",
  forbiddenMessage: "Forbidden",
  effect: () => listBankAccounts(),
})
