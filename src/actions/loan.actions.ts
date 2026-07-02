"use server";

import { Effect } from "effect";
import { withAction } from "@/lib/with-action";
import {
  getSession,
  getUserRole,
  getErrorTag,
  getErrorField,
  getSessionRoleAndPermissions,
  validateBackdating,
} from "@/lib/action-utils";
import { validatePositiveDecimal } from "@/lib/validators";
import {
  createLoan,
  listLoans,
  listLoanBalances,
  getLoanPaymentContext,
  getLoanCollateral,
  getLoanReceiptData,
  resolveUserNames,
  getCollateralNatures,
  getCustomerLoansWithOverdue,
  getLoanStatusCounts,
  getLoansForExport,
  listActiveLoansWithOverdue,
  waivePenalty,
  adjustPenaltyMultiplier,
} from "@/services/loan.service";
import {
  type UserRole,
  type CreateLoanInput,
  type UpdateLoanInput,
  type DeleteLoanInput,
  type Loan,
} from "@/types";
import { revalidatePath } from "next/cache";

type LoanPaymentContextData = NonNullable<
  Awaited<ReturnType<typeof getLoanPaymentContext>>
>;
type LoanReceiptData = NonNullable<
  Awaited<ReturnType<typeof getLoanReceiptData>>
>;
type CustomerLoansData = Awaited<
  ReturnType<typeof getCustomerLoansWithOverdue>
>;
/** The success shape shared by penalty mutations (waive / adjust multiplier). */
type LoanPenaltyResult = { data: Loan; txid: number };
import { notifyAdmin, resolveLoanContext } from "@/lib/email";
import BigNumber from "bignumber.js";
import { generateLoansExcel } from "@/services/export/excel.service";
import { getLocationBalances } from "@/services/report.service";
import { formatAmount } from "@/lib/interest/engine";
import { VALID_DEPOSIT_LOCATIONS, VALID_LOAN_TYPES } from "@/lib/constants";

export const getLocationBalancesAction = withAction({
  permission: "reports:read",
  effect: () => getLocationBalances(),
});

export async function getCollateralNaturesAction(): Promise<string[]> {
  const session = await getSession();
  if (!session) return [];

  return getCollateralNatures();
}

export const getLoanPaymentContextAction = withAction<
  string,
  { data: LoanPaymentContextData } | { error: string }
>({
  permission: "loan:read",
  action: async (_session, loanId) => {
    const ctx = await getLoanPaymentContext(loanId);
    if (!ctx) return { error: "Loan not found" };
    return { data: ctx };
  },
});

export const getLoanCollateralAction = withAction<
  string,
  { data: { nature: string; description: string | null } | null }
>({
  permission: "loan:read",
  action: async (_session, loanId) => {
    return { data: await getLoanCollateral(loanId) };
  },
});

export const getLoanReceiptDataAction = withAction<
  string,
  { data: LoanReceiptData } | { error: string }
>({
  permission: "loan:read",
  action: async (_session, loanId) => {
    const data = await getLoanReceiptData(loanId);
    if (!data) return { error: "Loan not found" };
    return { data };
  },
});

export const listLoansAction = withAction({
  permission: "loan:read",
  effect: () => listLoans(),
});

export async function getCurrentUserRoleAction(): Promise<UserRole> {
  const session = await getSession();
  if (!session) return "unassigned" as UserRole;
  return getUserRole(session);
}

/** Resolve an array of user IDs to a { [id]: name } map. */
export async function resolveUserNamesAction(
  userIds: string[],
): Promise<Record<string, string>> {
  const session = await getSession();
  if (!session) return {};
  return resolveUserNames(userIds);
}

// Loan editing is permanently disabled to preserve system integrity.
// To change loan terms, issue a new loan (which can roll over the old one).
export const updateLoanAction = withAction<UpdateLoanInput, { error: string }>({
  permission: "loan:update",
  action: async () => {
    return { error: "Loan editing is disabled. Issue a new loan instead." };
  },
});

// Loan deletion is permanently disabled to preserve system integrity.
export const deleteLoanAction = withAction<DeleteLoanInput, { error: string }>({
  permission: "loan:update",
  action: async () => {
    return { error: "Loan deletion is disabled. Loans are permanent records." };
  },
});

// createLoanAction has complex multi-step validation and role-based branching that
// doesn't fit the wrapper cleanly -- keep inline auth.
export async function createLoanAction(input: CreateLoanInput) {
  const session = await getSession();
  if (!session) {
    return { error: "Unauthorized" };
  }

  const { role, perms } = await getSessionRoleAndPermissions(session);
  if (!perms.has("loan:create")) {
    return { error: "Forbidden" };
  }

  // Rollover requires loan:rollover permission
  if (input.rollover) {
    if (!perms.has("loan:rollover")) {
      return { error: "Only supervisors and above can perform loan rollovers" };
    }
  }

  if (!input.customerId?.trim()) {
    return { error: "Customer ID is required" };
  }
  const principalErr = validatePositiveDecimal(
    input.principalAmount,
    "Principal",
  );
  if (principalErr) return { error: principalErr };
  if (!input.startDate?.trim()) {
    return { error: "Start date is required" };
  }

  // Backdate validation: timezone-safe future-rejection + backdate-permission
  // check (see validateBackdating for the underlying math / BUG-10 context).
  const backdateErr = validateBackdating(input.startDate, perms, {
    futureErrorMessage: "Start date cannot be in the future",
    noteValue: input.backdateNote,
    noteErrorMessage:
      "A note is required when backdating a loan to explain the reason",
  });
  if (backdateErr) return { error: backdateErr };
  if (!input.collateral?.nature?.trim()) {
    return { error: "Collateral nature is required" };
  }
  const isRollover = !!input.rollover;
  if (isRollover) {
    // Rollovers allow zero issuance fee (already paid on original loan)
    if (
      !input.issuanceFee?.trim() ||
      !/^\d+(\.\d{1,2})?$/.test(input.issuanceFee)
    ) {
      return { error: "Issuance fee must be a valid decimal number" };
    }
  } else {
    const feeErr = validatePositiveDecimal(input.issuanceFee, "Issuance fee");
    if (feeErr) return { error: feeErr };
    if (parseFloat(input.issuanceFee) < 50000) {
      return { error: "Issuance fee must be at least 50,000 UGX" };
    }
  }
  if (!input.collateral?.description?.trim()) {
    return { error: "Collateral description is required" };
  }

  if (
    !input.disbursementSource ||
    !VALID_DEPOSIT_LOCATIONS.includes(input.disbursementSource)
  ) {
    return {
      error: "Disbursement source is required (cash, bank, or strong_room)",
    };
  }

  // Check sufficient funds at disbursement source (all locations including cash)
  // For rollovers, principalAmount is already the fresh cash portion (carried amounts are separate)
  //
  // KNOWN TOCTOU RISK: This balance check runs outside the loan creation transaction
  // in loan.service.ts. A concurrent disbursement could pass validation here but
  // overdraw the fund by the time the transaction commits. The ledger's double-entry
  // bookkeeping will record the correct (negative) balance, so the data stays consistent,
  // but the business constraint (no overdraw) is enforced optimistically. A database-level
  // CHECK constraint or trigger on the Cash category balance would close this gap but
  // requires aggregating across all transaction rows, which is expensive as a constraint.
  // For now, the admin dashboard surfaces negative balances for manual remediation.
  const freshAmount = new BigNumber(input.principalAmount);

  if (freshAmount.isGreaterThan(0)) {
    try {
      const balances = await Effect.runPromise(getLocationBalances());
      // For bank disbursements with a chosen sub-account, validate against that
      // specific account's balance — the aggregate "bank" total can mask an
      // individual account that lacks funds.
      const isBankWithSub =
        input.disbursementSource === "bank" && !!input.subLocationId;
      const available = isBankWithSub
        ? new BigNumber(
            balances.bankAccounts?.[input.subLocationId as string] ?? "0",
          )
        : new BigNumber(
            balances[
              input.disbursementSource as "cash" | "bank" | "strong_room"
            ],
          );
      if (available.isLessThan(freshAmount)) {
        const loc = isBankWithSub
          ? "the selected bank account"
          : input.disbursementSource === "strong_room"
            ? "Strong Room"
            : input.disbursementSource === "bank"
              ? "Bank"
              : "Cash on Hand";
        const isLoanOfficer = !perms.has("fund-transfer:create");
        const action = isLoanOfficer
          ? "Ask your supervisor to transfer or inject funds before disbursing."
          : "Transfer or inject funds first.";
        return {
          error: `Insufficient funds in ${loc}. Available: ${formatAmount(available)}, required: ${formatAmount(freshAmount)}. ${action}`,
        };
      }
    } catch {
      return { error: "Unable to verify fund balances. Please try again." };
    }
  }

  // Loan officers cannot issue more than 4,000,000 UGX
  const MAX_LOAN_OFFICER_AMOUNT = 4_000_000;
  if (
    role === "loanOfficer" &&
    new BigNumber(input.principalAmount).isGreaterThan(MAX_LOAN_OFFICER_AMOUNT)
  ) {
    return {
      error: `Loan officers cannot issue more than ${formatAmount(new BigNumber(MAX_LOAN_OFFICER_AMOUNT))} UGX. Request a supervisor to issue this loan.`,
    };
  }

  // Validate loanType
  const loanType = input.loanType || "perpetual";
  if (!(VALID_LOAN_TYPES as readonly string[]).includes(loanType)) {
    return {
      error: "Loan type must be perpetual, fixed_rate, or reducing_balance",
    };
  }

  // Validate interestRate if provided
  if (input.interestRate && input.interestRate !== "") {
    if (
      !/^\d+(\.\d+)?$/.test(input.interestRate) ||
      parseFloat(input.interestRate) <= 0
    ) {
      return {
        error:
          "Interest rate must be a positive decimal (e.g. 0.10 for 10%/month)",
      };
    }
  }

  // Validate termMonths for term loans
  if (loanType !== "perpetual") {
    if (
      !input.termMonths ||
      input.termMonths <= 0 ||
      !Number.isInteger(input.termMonths)
    ) {
      return {
        error:
          "Term months must be a positive integer for fixed rate and reducing balance loans",
      };
    }
  }

  const loanInput: CreateLoanInput = {
    ...input,
    interestRate: input.interestRate || "0.10",
    minInterestDays: input.minInterestDays || 30,
    loanType,
    // For perpetual loans termMonths is record-only — pass it through if provided.
    termMonths: input.termMonths,
  };

  if (!perms.has("settings:update")) {
    loanInput.interestRateOverride = null;
    loanInput.minPeriodOverride = null;
  }

  try {
    const data = await Effect.runPromise(
      createLoan(loanInput, session.user.id),
    );
    revalidatePath("/loans");
    revalidatePath(`/customers/${input.customerId}`);
    notifyAdmin({
      eventType: "loan.disbursed",
      context: resolveLoanContext(data.id),
      session,
      amount: input.principalAmount,
    });
    return { data };
  } catch (error) {
    if (getErrorTag(error) === "CustomerNotFound") {
      return { error: "Customer not found" };
    }
    if (getErrorTag(error) === "IncompleteLoanRequirements") {
      const missing = getErrorField(error, "missing") as string[] | undefined;
      return {
        error: `Missing fields: ${missing?.join(", ") ?? "unknown"}`,
      };
    }
    return { error: "Internal server error" };
  }
}

export const getCustomerLoansWithOverdueAction = withAction<
  string,
  { data: CustomerLoansData } | { error: string }
>({
  permission: "loan:read",
  action: async (_session, customerId) => {
    try {
      return { data: await getCustomerLoansWithOverdue(customerId) };
    } catch {
      return { error: "Internal server error" };
    }
  },
});

export const getLoanStatusCountsAction = withAction({
  permission: "loan:read",
  action: async () => {
    try {
      return { data: await getLoanStatusCounts() };
    } catch {
      return { error: "Internal server error" };
    }
  },
});

export const exportLoansExcelAction = withAction<
  "all" | "critical" | "at-risk" | "early" | undefined,
  { data: string } | { error: string }
>({
  permission: "reports:read",
  action: async (_session, filter) => {
    try {
      const entries = await getLoansForExport(filter);
      if (entries.length === 0) {
        return { error: "No loans to export" };
      }

      const buffer = await generateLoansExcel(entries);
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      return { data: base64 };
    } catch {
      return { error: "Internal server error" };
    }
  },
});

export const listActiveLoansWithOverdueAction = withAction({
  permission: "loan:read",
  action: async () => {
    try {
      return { data: await listActiveLoansWithOverdue() };
    } catch {
      return { error: "Internal server error" };
    }
  },
});

export const waivePenaltyAction = withAction<
  string,
  LoanPenaltyResult | { error: string }
>({
  permission: "settings:update",
  forbiddenMessage: "Only admins can waive penalties",
  action: async (session, loanId) => {
    try {
      const result = await waivePenalty(loanId, session.user.id);

      if ("notFound" in result) return { error: "Loan not found" };

      revalidatePath("/loans");
      revalidatePath(`/loans/${loanId}`);
      return { data: result.data, txid: result.txid };
    } catch {
      return { error: "Internal server error" };
    }
  },
});

export async function adjustPenaltyMultiplierAction(
  loanId: string,
  multiplier: string,
) {
  return adjustPenaltyMultiplierWrapped({ loanId, multiplier });
}

const adjustPenaltyMultiplierWrapped = withAction<
  { loanId: string; multiplier: string },
  LoanPenaltyResult | { error: string }
>({
  permission: "settings:update",
  forbiddenMessage: "Only admins can adjust penalty rates",
  action: async (_session, { loanId, multiplier }) => {
    const value = parseFloat(multiplier);
    if (isNaN(value) || value < 0 || value >= 1) {
      return {
        error: "Multiplier must be between 0 and 1 (e.g., 0.10 for 10%)",
      };
    }

    try {
      const result = await adjustPenaltyMultiplier(loanId, value);
      if ("notFound" in result) return { error: "Loan not found" };
      revalidatePath("/loans");
      revalidatePath(`/loans/${loanId}`);
      return { data: result.data, txid: result.txid };
    } catch {
      return { error: "Internal server error" };
    }
  },
});

/**
 * List all loan_balances projection rows for the loanBalanceCollection.
 * Returns the same data the `loan_balances` Electric shape was syncing.
 */
export const listLoanBalancesAction = withAction({
  permission: "loan:read",
  effect: () => listLoanBalances(),
});
