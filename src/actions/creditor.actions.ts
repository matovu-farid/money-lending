"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import { revalidatePath } from "next/cache"
import {
  createCreditor,
  createCreditorWithTxid,
  updateCreditorWithTxid,
  addInvestment,
  recordCreditorRepayment,
  listCreditors,
  listCreditorInvestments,
  listCreditorRepayments,
  getSystemCapital,
  getCreditorMonthlyInterestDue,
  getCreditorMonthlySummary,
  getCreditorsPageData,
  getCreditorDashboard,
} from "@/services/creditor.service"
import { getCreditorRepaymentPortionsFromLedger } from "@/services/ledger-queries.service"
import { getErrorTag } from "@/lib/action-utils"
import {
  notifyAdmin,
  resolveCreditorContext,
  resolveCreditorRepaymentContext,
} from "@/lib/email"
import { shortId } from "@/lib/utils"
import { validatePositiveAmount } from "@/lib/validators"
import type {
  CreateCreditorInput,
  CreateCreditorWithInvestmentInput,
  UpdateCreditorInput,
  AddInvestmentInput,
  RecordCreditorRepaymentInput,
} from "@/types"

function validateCreditorFields(input: {
  name?: string
  contact?: string
  address?: string
}): string | null {
  if (!input.name?.trim()) return "Creditor name is required"
  if (!input.contact?.trim()) return "Contact is required"
  if (!input.address?.trim()) return "Address is required"
  return null
}

export const listCreditorsAction = withAction({
  permission: "creditor:read",
  effect: () => listCreditors(),
})

export const listCreditorInvestmentsAction = withAction({
  permission: "creditor:read",
  effect: () => listCreditorInvestments(),
})

export const listCreditorRepaymentsAction = withAction({
  permission: "creditor:read",
  effect: () => listCreditorRepayments(),
})

export const getSystemCapitalAction = withAction({
  permission: "creditor:read",
  effect: () => getSystemCapital(),
})

export const createCreditorAction = withAction<CreateCreditorInput, any>({
  permission: "creditor:create",
  action: async (session, input) => {
    const err = validateCreditorFields(input)
    if (err) return { error: err }

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
  action: async (session, { id, input }) => {
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

export const createCreditorWithInvestmentAction = withAction<CreateCreditorWithInvestmentInput, any>({
  permission: "creditor:create",
  action: async (session, input) => {
    const fieldErr = validateCreditorFields(input)
    if (fieldErr) return { error: fieldErr }
    const amountErr = validatePositiveAmount(input.amount)
    if (amountErr) return { error: amountErr }
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

      const investment = await Effect.runPromise(addInvestment({
        creditorId: creditor.id,
        amount: input.amount,
        interestRateMonthly: input.interestRateMonthly,
        investmentDate: input.investmentDate,
        depositLocation: input.depositLocation,
        subLocationId: input.subLocationId,
      }, session.user.id))

      notifyAdmin({
        eventType: "creditor.investment.recorded",
        context: resolveCreditorContext(creditor.id),
        session,
        amount: input.amount,
        entityRef: `INV-${shortId(investment.id).toUpperCase()}`,
      })

      revalidatePath("/creditors")
      return { data: creditor, txid, investmentId: investment.id }
    } catch (err) {
      console.error("[createCreditorWithInvestmentAction] failed", err)
      return { error: err instanceof Error ? err.message : "Internal server error" }
    }
  },
})

export const addInvestmentAction = withAction<AddInvestmentInput, any>({
  permission: "creditor:create",
  action: async (session, input) => {
    if (!input.creditorId?.trim()) return { error: "Creditor ID is required" }
    const amountErr = validatePositiveAmount(input.amount)
    if (amountErr) return { error: amountErr }
    if (!input.investmentDate?.trim() || isNaN(Date.parse(input.investmentDate))) {
      return { error: "A valid investment date is required" }
    }

    try {
      const data = await Effect.runPromise(addInvestment(input, session.user.id))
      revalidatePath("/creditors")
      revalidatePath(`/creditors/${input.creditorId}`)
      notifyAdmin({
        eventType: "creditor.investment.recorded",
        context: resolveCreditorContext(input.creditorId),
        session,
        amount: input.amount,
        entityRef: `INV-${shortId((data as { id: string }).id).toUpperCase()}`,
      })
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
    const amountErr = validatePositiveAmount(input.amount)
    if (amountErr) return { error: amountErr }
    if (!input.repaymentDate?.trim() || isNaN(Date.parse(input.repaymentDate))) {
      return { error: "A valid repayment date is required" }
    }

    try {
      const data = await Effect.runPromise(recordCreditorRepayment(input, session.user.id))
      revalidatePath("/creditors")
      notifyAdmin({
        eventType: "creditor.repayment.recorded",
        context: resolveCreditorRepaymentContext((data as { id: string }).id),
        session,
        amount: input.amount,
      })
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

export const getCreditorDashboardAction = withAction<string, any>({
  permission: "creditor:read",
  action: async (_session, creditorId) => {
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

export const getCreditorRepaymentPortionsAction = withAction<string[], any>({
  permission: "creditor:read",
  action: async (_session, repaymentIds) => {
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
