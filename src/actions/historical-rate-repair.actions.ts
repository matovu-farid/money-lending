"use server";

import { withAction } from "@/lib/with-action";
import { loadHistoricalRateRepairPlan } from
  "@/services/historical-rate-repair.service";
import { approveHistoricalRateRepair } from
  "@/services/historical-rate-repair-apply.service";

type ReviewInput = {
  loanId: string;
  asOf: string;
  policyVersion: string;
  planHash: string;
  inputFingerprint: string;
  reviewNote: string;
};

/** Approval actor is derived only from the validated session, never the request body. */
export const approveHistoricalRateRepairAction = withAction<ReviewInput,
  { data: { approvalId: string; planHash: string } } | { error: string }>({
  action: async (session, input) => {
    const role = (session.user as Record<string, unknown>).role;
    if (role !== "admin" && role !== "superAdmin") {
      return { error: "Forbidden" };
    }
    if (!input || !/^[a-f0-9-]{36}$/i.test(input.loanId) ||
        !/^[a-f0-9]{64}$/.test(input.planHash) ||
        !/^[a-f0-9]{64}$/.test(input.inputFingerprint) ||
        input.policyVersion !== "v1" ||
        typeof input.reviewNote !== "string" ||
        input.reviewNote.trim().length < 15) {
      return { error: "An exact reviewed plan and substantive note are required" };
    }
    const asOf = new Date(input.asOf);
    if (!Number.isFinite(asOf.getTime()) || asOf.toISOString() !== input.asOf ||
        asOf > new Date()) {
      return { error: "Invalid review date" };
    }
    const plan = await loadHistoricalRateRepairPlan(input.loanId, asOf,
      input.policyVersion);
    if (plan.classification !== "review" ||
        plan.planHash !== input.planHash ||
        plan.inputFingerprint !== input.inputFingerprint) {
      return { error: "Reviewed plan has changed; generate and review a new preview" };
    }
    const approvalId = await approveHistoricalRateRepair(
      plan, session.user.id, input.reviewNote,
    );
    return { data: { approvalId, planHash: plan.planHash } };
  },
});
