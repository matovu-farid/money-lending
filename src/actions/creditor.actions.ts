"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import { revalidatePath } from "next/cache"
import {
  createCreditor,
  updateCreditor,
  addInvestment,
  recordCreditorRepayment,
  listCreditors,
  getSystemCapital,
  getCreditorMonthlyInterestDue,
  getCreditorMonthlySummary,
} from "@/services/creditor.service"
import type {
  CreateCreditorInput,
  UpdateCreditorInput,
  AddInvestmentInput,
  RecordCreditorRepaymentInput,
} from "@/types"

export const listCreditorsAction = withAction({
  permission: "creditor:read",
  effect: () => listCreditors(),
})

export const getSystemCapitalAction = withAction({
  permission: "creditor:read",
  effect: () => getSystemCapital(),
})

export const createCreditorAction = withAction<CreateCreditorInput, any>({
  permission: "creditor:create",
  action: async (session, input) => {
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
  },
})

export async function updateCreditorAction(
  id: string,
  input: UpdateCreditorInput
) {
  return updateCreditorWrapped({ id, input })
}

const updateCreditorWrapped = withAction<{ id: string; input: UpdateCreditorInput }, any>({
  permission: "creditor:update",
  effect: (session, { id, input }) => updateCreditor(id, input, session.user.id),
  revalidate: (input) => ["/creditors", `/creditors/${input.id}`],
})

export const addInvestmentAction = withAction<AddInvestmentInput, any>({
  permission: "creditor:create",
  action: async (session, input) => {
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
  },
})

export const recordCreditorRepaymentAction = withAction<RecordCreditorRepaymentInput, any>({
  permission: "creditor:update",
  action: async (session, input) => {
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
  },
})

export const getCreditorMonthlyInterestDueAction = withAction({
  permission: "creditor:read",
  action: async () => {
    try {
      const map = await Effect.runPromise(getCreditorMonthlyInterestDue())
      const data: Record<string, string> = {}
      for (const [k, v] of map) data[k] = v
      return { data }
    } catch {
      return { error: "Internal server error" }
    }
  },
})

export const getCreditorMonthlySummaryAction = withAction<string, any>({
  permission: "creditor:read",
  action: async (_session, creditorId) => {
    try {
      const data = await Effect.runPromise(getCreditorMonthlySummary(creditorId))
      return { data }
    } catch {
      return { error: "Internal server error" }
    }
  },
})
