"use server";

import { withAction } from "@/lib/with-action";

type ReviewInput = {
  loanId: string;
  asOf: string;
  policyVersion: string;
  planHash: string;
  inputFingerprint: string;
  reviewNote: string;
};

/** Legacy endpoint is intentionally inert: new corrections require agent review. */
export const approveHistoricalRateRepairAction = withAction<ReviewInput,
  { data: { approvalId: string; planHash: string } } | { error: string }>({
  action: async (session, _input) => {
    const role = (session.user as Record<string, unknown>).role;
    if (role !== "admin" && role !== "superAdmin") {
      return { error: "Forbidden" };
    }
    return { error: "Financial corrections require a separate agent review" };
  },
});
