"use server"

import { withAction, type Session } from "@/lib/with-action"
import { revalidatePath } from "next/cache"
import {
  createDelegation,
  revokeDelegation,
  listDelegations,
} from "@/services/delegation.service"

export const createDelegationAction = withAction({
  permission: "delegation:create",
  forbiddenMessage: "Only admins can create delegations",
  action: async (session: Session, input: { id: string; userId: string }) => {
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
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Failed to create delegation" }
    }
  },
})

export const revokeDelegationAction = withAction({
  permission: "delegation:revoke",
  forbiddenMessage: "Only admins can revoke delegations",
  action: async (session: Session, input: { delegationId: string }) => {
    if (!input.delegationId?.trim()) {
      return { error: "Delegation ID is required" }
    }

    try {
      const data = await revokeDelegation(input.delegationId, session.user.id)
      revalidatePath("/admin")
      return { data }
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Failed to revoke delegation" }
    }
  },
})

export const listDelegationsAction = withAction({
  permission: "delegation:read",
  action: async () => {
    try {
      const data = await listDelegations()
      return { data }
    } catch {
      return { error: "Failed to load delegations" }
    }
  },
})
