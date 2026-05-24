"use server"

import { Effect } from "effect"
import { withAction, type Session } from "@/lib/with-action"
import { revalidatePath } from "next/cache"
import {
  createCreditor,
  createCreditorWithTxid,
  updateCreditorWithTxid,
  addInvestment,
  recordCreditorRepayment,
  listCreditors,
  getSystemCapital,
  getCreditorMonthlyInterestDue,
  getCreditorMonthlySummary,
  getCreditorsPageData,
  getCreditorDashboard,
} from "@/services/creditor.service"
import { getCreditorRepaymentPortionsFromLedger } from "@/services/ledger-queries.service"
import { getErrorTag } from "@/lib/action-utils"
import type {
  CreateCreditorInput,
  CreateCreditorWithInvestmentInput,
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

export const createCreditorAction = withAction({
  permission: "creditor:create",
  action: async (session: Session, input: CreateCreditorInput) => {
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

const updateCreditorWrapped = withAction({
  permission: "creditor:update",
  action: async (session: Session, { id, input }: { id: string; input: UpdateCreditorInput }) => {
    try {
      const { creditor, txid } = await Effect.runPromise(
        updateCreditorWithTxid(id, input, session.user.id)
      )
      revalidatePath("/creditors")
      revalidatePath(`/creditors/${id}`)
      return { data: creditor, txid }
    } catch (error) {
      if (getErrorTag(error) === "CreditorNotFound") {
        return { error: "Creditor not found" }
      }
      console.error("[updateCreditorAction]", error)
      return { error: "Internal server error" }
    }
  },
})

export const createCreditorWithInvestmentAction = withAction({
  permission: "creditor:create",
  action: async (session: Session, input: CreateCreditorWithInvestmentInput) => {
    if (!input.name?.trim()) return { error: "Creditor name is required" }
    if (!input.contact?.trim()) return { error: "Contact is required" }
    if (!input.address?.trim()) return { error: "Address is required" }
    if (!input.amount?.trim() || !/^\d+(\.\d{1,2})?$/.test(input.amount) || Number(input.amount) <= 0) {
      return { error: "A valid positive amount is required" }
    }
    if (!input.investmentDate?.trim() || isNaN(Date.parse(input.investmentDate))) {
      return { error: "A valid investment date is required" }
    }

    try {
      const { creditor, txid } = await Effect.runPromise(createCreditorWithTxid({
        id: input.id,
        name: input.name.trim(),
        contact: input.contact.trim(),
        address: input.address.trim(),
      }, session.user.id))

      await Effect.runPromise(addInvestment({
        creditorId: creditor.id,
        amount: input.amount,
        interestRateMonthly: input.interestRateMonthly,
        investmentDate: input.investmentDate,
        depositLocation: input.depositLocation,
        subLocationId: input.subLocationId,
      }, session.user.id))

      revalidatePath("/creditors")
      return { data: creditor, txid }
    } catch {
      return { error: "Internal server error" }
    }
  },
})

export const addInvestmentAction = withAction({
  permission: "creditor:create",
  action: async (session: Session, input: AddInvestmentInput) => {
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

export const recordCreditorRepaymentAction = withAction({
  permission: "creditor:update",
  action: async (session: Session, input: RecordCreditorRepaymentInput) => {
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

export const getCreditorsPageDataAction = withAction({
  permission: "creditor:read",
  effect: () => getCreditorsPageData(),
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

export const getCreditorMonthlySummaryAction = withAction({
  permission: "creditor:read",
  action: async (_session: Session, creditorId: string) => {
    try {
      const data = await Effect.runPromise(getCreditorMonthlySummary(creditorId))
      return { data }
    } catch {
      return { error: "Internal server error" }
    }
  },
})

export const getCreditorDashboardAction = withAction({
  permission: "creditor:read",
  action: async (_session: Session, creditorId: string) => {
    try {
      const data = await Effect.runPromise(getCreditorDashboard(creditorId))
      return { data }
    } catch (e) {
      const tag = getErrorTag(e)
      if (tag === "CreditorNotFound") return { error: "Creditor not found" }
      return { error: "Internal server error" }
    }
  },
})

export const getCreditorRepaymentPortionsAction = withAction({
  permission: "creditor:read",
  action: async (_session: Session, repaymentIds: string[]) => {
    if (repaymentIds.length === 0) return { data: {} }
    try {
      const map = await getCreditorRepaymentPortionsFromLedger(repaymentIds)
      const data: Record<string, { interestPortion: string; principalPortion: string }> = {}
      for (const [k, v] of map) data[k] = v
      return { data }
    } catch {
      return { error: "Internal server error" }
    }
  },
})
