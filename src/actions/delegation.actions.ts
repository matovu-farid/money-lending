"use server"

import { withAction } from "@/lib/with-action"
import { captureServerError } from "@/lib/sentry"
import { revalidatePath } from "next/cache"
import {
  createDelegation,
  revokeDelegation,
  listDelegations,
} from "@/services/delegation.service"

export const createDelegationAction = withAction<{ id: string; userId: string }, any>({
  permission: "delegation:create",
  forbiddenMessage: "Only admins can create delegations",
  action: async (session, input) => {
    if (!input.id?.trim()) {
      return { error: "ID is required" }
    }
    if (!input.userId?.trim()) {
      return { error: "User ID is required" }
    }

    try {
      const data = await createDelegation(input.id, input.userId, session.user.id)
      revalidatePath("/admin")
      return { data }
    } catch (error: any) {
      const message = error?.message
      if (message === "User already has an active delegation" || message === "Only supervisors can receive delegations") {
        return { error: message }
      }
      captureServerError(error, { source: "createDelegationAction", userId: session.user.id })
      return { error: "Failed to create delegation" }
    }
  },
})

export const revokeDelegationAction = withAction<{ delegationId: string }, any>({
  permission: "delegation:revoke",
  forbiddenMessage: "Only admins can revoke delegations",
  action: async (session, input) => {
    if (!input.delegationId?.trim()) {
      return { error: "Delegation ID is required" }
    }

    try {
      const data = await revokeDelegation(input.delegationId, session.user.id)
      revalidatePath("/admin")
      return { data }
    } catch (error: any) {
      if (error?.message === "Active delegation not found") {
        return { error: error.message }
      }
      captureServerError(error, {
        source: "revokeDelegationAction",
        userId: session.user.id,
        delegationId: input.delegationId,
      })
      return { error: "Failed to revoke delegation" }
    }
  },
})

export const listDelegationsAction = withAction({
  permission: "delegation:read",
  action: async () => {
    try {
      const data = await listDelegations()
      return { data }
    } catch (error) {
      captureServerError(error, { source: "listDelegationsAction" })
      return { error: "Failed to load delegations" }
    }
  },
})
