"use server"

import { withAction } from "@/lib/with-action"
import { loadPortfolioAccrualPlan } from "@/services/portfolio-accrual-repair.service"
import { approvePortfolioAccrualRepair } from
  "@/services/portfolio-accrual-repair-apply.service"

type ReviewInput = {
  loanId: string
  asOf: string
  policyVersion: string
  planHash: string
  inputFingerprint: string
  reviewNote: string
}

/** The approving identity comes only from the validated server session. */
export const approvePortfolioAccrualRepairAction = withAction<ReviewInput,
  { data: { approvalId: string; planHash: string } } | { error: string }>({
  action: async (session, input) => {
    const role = (session.user as Record<string, unknown>).role
    if (role !== "admin" && role !== "superAdmin") return { error: "Forbidden" }
    if (!input || !/^[a-f0-9-]{36}$/i.test(input.loanId) ||
        !/^[a-f0-9]{64}$/.test(input.planHash) ||
        !/^[a-f0-9]{64}$/.test(input.inputFingerprint) ||
        input.policyVersion !== "portfolio-accrual-v1" ||
        typeof input.reviewNote !== "string" || input.reviewNote.trim().length < 15) {
      return { error: "An exact reviewed plan and substantive note are required" }
    }
    const asOf = new Date(input.asOf)
    if (!Number.isFinite(asOf.getTime()) || asOf.toISOString() !== input.asOf ||
        asOf > new Date()) return { error: "Invalid review date" }
    const plan = await loadPortfolioAccrualPlan(input.loanId, asOf)
    if (plan.classification !== "ready" || plan.planHash !== input.planHash ||
        plan.inputFingerprint !== input.inputFingerprint ||
        plan.policyVersion !== input.policyVersion) {
      return { error: "Reviewed plan changed; generate a new preview" }
    }
    const approvalId = await approvePortfolioAccrualRepair(
      plan, session.user.id, input.reviewNote,
    )
    return { data: { approvalId, planHash: plan.planHash } }
  },
})
