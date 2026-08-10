"use server";

import { endOfDay } from "date-fns";
import { revalidatePath } from "next/cache";
import { withAction } from "@/lib/with-action";
import { getErrorTag } from "@/lib/action-utils";
import {
  validatePositiveDecimal,
  validateUuid,
  validateWaiveReason,
  validateWaiveLoanAmountInput,
} from "@/lib/validators";
import { allocateLoanSettlementAmount } from "@/lib/interest/engine-server";
import {
  undoLoanWaiver,
  waiveLoanAmount,
  listLoanWaiversForLoan,
} from "@/services/loan-waiver.service";
import { notifyAdmin, resolveLoanContext } from "@/lib/email";
import { captureServerError } from "@/lib/sentry";
import type {
  LoanWaiver,
  LoanWaiverWithPortions,
  UndoLoanWaiverInput,
  UndoLoanWaiverResult,
  WaiveLoanAmountInput,
} from "@/types";

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
      captureServerError(error, {
        source: "waiveLoanAmountAction",
        userId: session.user.id,
        loanId: input.loanId,
      });
      return { error: "Internal server error" };
    }
  },
});

export const undoLoanWaiverAction = withAction<
  UndoLoanWaiverInput,
  { data: UndoLoanWaiverResult } | { error: string }
>({
  permission: "loan:waiver",
  forbiddenMessage: "Only admins can undo loan waivers",
  action: async (session, input) => {
    const waiverIdErr = validateUuid(input.waiverId, "Waiver ID");
    if (waiverIdErr) return { error: waiverIdErr };
    const reasonErr = validateWaiveReason(input.reason);
    if (reasonErr) return { error: reasonErr };

    try {
      const result = await undoLoanWaiver(input, session.user.id);
      revalidatePath(`/loans/${result.loanId}`);
      return { data: result };
    } catch (error) {
      const tag = getErrorTag(error);
      if (tag === "LoanNotFound") return { error: "Loan not found" };
      if (tag === "WaiverNotFound") return { error: "Waiver not found" };
      if (tag === "ValidationError") {
        return {
          error:
            (error as { message?: string }).message ?? "Validation error",
        };
      }
      captureServerError(error, {
        source: "undoLoanWaiverAction",
        userId: session.user.id,
        waiverId: input.waiverId,
      });
      return { error: "Internal server error" };
    }
  },
});

export const listLoanWaiversAction = withAction<
  string,
  { data: LoanWaiverWithPortions[] } | { error: string }
>({
  permission: "loan:waiver",
  forbiddenMessage: "Only admins can view loan waivers",
  action: async (_session, loanId) => {
    if (!loanId?.trim()) return { error: "Loan ID is required" };
    try {
      return { data: await listLoanWaiversForLoan(loanId) };
    } catch (error) {
      captureServerError(error, { source: "listLoanWaiversAction", loanId });
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
    } catch (error) {
      captureServerError(error, { source: "previewWaiverAllocationAction", loanId: input.loanId });
      return { error: "Internal server error" };
    }
  },
});
