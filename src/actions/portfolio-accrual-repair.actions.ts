"use server"

import { withAction } from "@/lib/with-action"

type ReviewInput = {
  loanId: string
  asOf: string
  policyVersion: string
  planHash: string
  inputFingerprint: string
  reviewNote: string
}

/** Legacy endpoint remains callable by old clients, but cannot create new human approvals. */
export const approvePortfolioAccrualRepairAction = withAction<ReviewInput,
  { data: { approvalId: string; planHash: string } } | { error: string }>({
  action: async (session) => {
    const role = (session.user as Record<string, unknown>).role
    if (role !== "admin" && role !== "superAdmin") return { error: "Forbidden" }
    return { error: "Financial corrections require a separate agent review" }
  },
})
