import type { LoanStatus } from "@/types/loan"
import { ValidationError } from "@/lib/errors"

/** Only active loans appear on operational surfaces (watchlist, export, payment pickers). */
export const OPERATIONAL_LOAN_STATUS = "active" as const

export function isOperationalLoan(status: LoanStatus): boolean {
  return status === OPERATIONAL_LOAN_STATUS
}

/** Closed / archived loans kept for audit, credit score, and history UI. */
export function isHistoricalLoan(status: LoanStatus): boolean {
  return status !== "active" && status !== "pending"
}

/**
 * Terminal lifecycle statuses — payment mutations must never flip these
 * (e.g. rolled_over → fully_paid via deletePayment when ledger is ~0).
 */
export function isTerminalLoanStatus(status: LoanStatus): boolean {
  return (
    status === "rolled_over" ||
    status === "fully_paid" ||
    status === "settled_with_collateral"
  )
}

/** True when the loan detail page should hide mutation CTAs. */
export function isLoanReadOnly(status: LoanStatus): boolean {
  return !isOperationalLoan(status)
}

/**
 * Fail closed for mutation entry points. Throws ValidationError so Effect
 * services and withAction paths surface a consistent client message.
 */
export function assertLoanOperational(loan: { status: LoanStatus }): void {
  if (!isOperationalLoan(loan.status)) {
    throw new ValidationError({
      message: "Loan is not active",
      field: "status",
    })
  }
}
