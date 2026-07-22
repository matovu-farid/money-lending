"use server";

import { endOfDay } from "date-fns";
import { revalidatePath } from "next/cache";
import { withAction } from "@/lib/with-action";
import { getErrorTag } from "@/lib/action-utils";
import {
  validatePositiveDecimal,
  validateWaiveLoanAmountInput,
} from "@/lib/validators";
import { allocateLoanSettlementAmount } from "@/lib/interest/engine-server";
import {
  waiveLoanAmount,
  listLoanWaiversForLoan,
} from "@/services/loan-waiver.service";
import { notifyAdmin, resolveLoanContext } from "@/lib/email";
import type { WaiveLoanAmountInput, LoanWaiver } from "@/types";

export const waiveLoanAmountAction = withAction<
  WaiveLoanAmountInput,
  | {
      data: LoanWaiver;
      interestPortion: string;
      principalPortion: string;
      txid: number;
    }
  | { error: string }
>({
  permission: "loan:waiver",
  forbiddenMessage: "Only admins can waive loan amounts",
  action: async (session, input) => {
    const validationErr = validateWaiveLoanAmountInput(input);
    if (validationErr) return { error: validationErr };

    try {
      const result = await waiveLoanAmount(input, session.user.id);
      revalidatePath(`/loans/${input.loanId}`);
      notifyAdmin({
        eventType: "loan.waiver",
        context: resolveLoanContext(input.loanId),
        session,
        amount: input.amount,
        notes: input.reason.trim(),
      });
      return {
        data: result.waiver,
        interestPortion: result.interestPortion,
        principalPortion: result.principalPortion,
        txid: result.txid,
      };
    } catch (error) {
      const tag = getErrorTag(error);
      if (tag === "LoanNotFound") return { error: "Loan not found" };
      if (tag === "ValidationError") {
        return {
          error:
            (error as { message?: string }).message ?? "Validation error",
        };
      }
      return { error: "Internal server error" };
    }
  },
});

export const listLoanWaiversAction = withAction<
  string,
  { data: LoanWaiver[] } | { error: string }
>({
  permission: "loan:waiver",
  forbiddenMessage: "Only admins can view loan waivers",
  action: async (_session, loanId) => {
    if (!loanId?.trim()) return { error: "Loan ID is required" };
    try {
      return { data: await listLoanWaiversForLoan(loanId) };
    } catch {
      return { error: "Internal server error" };
    }
  },
});

export const previewWaiverAllocationAction = withAction<
  { loanId: string; amount: string },
  | {
      data: {
        interestPortion: string;
        principalPortion: string;
        unpaidInterest: string;
        principalBalance: string;
        totalDue: string;
      };
    }
  | { error: string }
>({
  permission: "loan:waiver",
  forbiddenMessage: "Only admins can preview waiver allocation",
  action: async (_session, input) => {
    if (!input.loanId?.trim()) return { error: "Loan ID is required" };
    const amountErr = validatePositiveDecimal(input.amount, "Amount");
    if (amountErr) return { error: amountErr };

    try {
      const allocation = await allocateLoanSettlementAmount({
        amount: input.amount,
        asOf: endOfDay(new Date()),
        loanId: input.loanId,
        settlementKind: "waiver",
      });
      return {
        data: {
          interestPortion: allocation.interestPortion,
          principalPortion: allocation.principalPortion,
          unpaidInterest: allocation.unpaidInterest,
          principalBalance: allocation.remainingPrincipalAmount,
          totalDue: allocation.totalBalanceOwedAfter,
        },
      };
    } catch {
      return { error: "Internal server error" };
    }
  },
});
