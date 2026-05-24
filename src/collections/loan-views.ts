"use client"

import { useLiveQuery, eq, and, isNull } from "@tanstack/react-db"
import { useMemo } from "react"
import { loanCollection } from "./loans"
import { loanBalanceCollection } from "./loan-balances"
import { customerCollection } from "./customers"
import { computeDaysOverdue, computeUnpaidInterest } from "@/lib/interest/overdue-client"
import { computeDailyRate } from "@/lib/interest/effective-rate-client"
import type { LoanListEntry } from "@/types/loan"
import type { LoanBaseRow, LoanBalanceRow, CustomerRow } from "@/lib/schemas/collections"

/**
 * Soft-delete filter, applied uniformly to all loan views.
 *
 * The Electric shape syncs every row from the `loans` table — including
 * those with `deleted_at` set. Server actions filter `isNull(deletedAt)`
 * everywhere; the UI must mirror that filter so a soft-deleted loan is
 * invisible to users at every surface (list, detail, customer page).
 */

/**
 * Project a (loan, balance, customer) join into the legacy `LoanListEntry`
 * shape that consumer code already expects. `daysOverdue` and `dailyRate`
 * are computed client-side from primitives + `today`; they are NOT projection
 * columns because they depend on the moving wall clock.
 */
function projectLoanListEntry(
  loan: LoanBaseRow,
  bal: LoanBalanceRow | undefined | null,
  cust: CustomerRow | undefined | null,
  today: Date,
): LoanListEntry {
  const outstandingBalance = bal?.outstandingBalance ?? "0"
  // The projection stores the net Interest Earned ledger balance under the
  // `unpaidInterest` column name. Semantically it is cumulative interest paid;
  // `computeDaysOverdue` and the Total Due math both treat it as such.
  const totalInterestPaid = bal?.unpaidInterest ?? "0"
  return {
    ...loan,
    customerName: cust?.fullName ?? "—",
    customerContact: cust?.contact ?? null,
    outstandingBalance,
    // Re-expose unpaid-to-date as the legacy `unpaidInterest` field. Computed
    // here as accruedToDate − paid (clamped at 0) so that consumers (Total
    // Due column, badges, exports) see the true unpaid figure rather than
    // the projection's raw revenue total.
    unpaidInterest: computeUnpaidInterest(loan, totalInterestPaid, outstandingBalance, today),
    lastPaymentDate: bal?.lastPaymentDate ?? null,
    daysOverdue: computeDaysOverdue(loan, totalInterestPaid, outstandingBalance, today),
    dailyRate: computeDailyRate(loan, outstandingBalance),
  }
}

/**
 * Shape returned by the join query before client-side projection.
 *
 * `useLiveQuery`'s `InferResultType` for an un-`.select()`'d query with joins
 * produces a structurally identical object, but the inferred type carries
 * collection-internal metadata that doesn't tell consumers anything useful.
 * Declaring it here gives the file a single, explicit join contract that the
 * three hooks share.
 */
type JoinedRow = {
  loan: LoanBaseRow
  bal: LoanBalanceRow | undefined
  cust: CustomerRow | undefined
}

/**
 * Live query: every loan, joined with its balance projection and customer.
 * Returns rows shaped like the legacy `LoanListEntry`.
 */
export function useLoansWithBalances(): { data: LoanListEntry[] | undefined; isLoading: boolean } {
  const today = useMemo(() => new Date(), [])
  const { data: rawRows, isLoading } = useLiveQuery((q) =>
    q
      .from({ loan: loanCollection })
      .join({ bal: loanBalanceCollection }, ({ loan, bal }) => eq(loan.id, bal.loanId), "left")
      .join({ cust: customerCollection }, ({ loan, cust }) => eq(loan.customerId, cust.id), "left")
      .where(({ loan }) => isNull(loan.deletedAt)),
  )

  // `useLiveQuery`'s join inference produces a structurally identical row but
  // wraps it in optionality flags TS can't unify here. One `as unknown as`
  // boundary cast — at the iterator — is cheaper than per-row casts inside
  // the map callback (the previous shape).
  const joinedRows = rawRows as unknown as JoinedRow[] | undefined

  const data = useMemo(
    () => joinedRows?.map((row) => projectLoanListEntry(row.loan, row.bal, row.cust, today)),
    [joinedRows, today],
  )

  return { data, isLoading }
}

/**
 * Live query: a single loan by id, joined with balance + customer.
 */
export function useLoanWithBalance(loanId: string): { data: LoanListEntry[] | undefined; isLoading: boolean } {
  const today = useMemo(() => new Date(), [])
  const { data: rawRows, isLoading } = useLiveQuery(
    (q) =>
      q
        .from({ loan: loanCollection })
        .join({ bal: loanBalanceCollection }, ({ loan, bal }) => eq(loan.id, bal.loanId), "left")
        .join({ cust: customerCollection }, ({ loan, cust }) => eq(loan.customerId, cust.id), "left")
        .where(({ loan }) => and(eq(loan.id, loanId), isNull(loan.deletedAt))),
    [loanId],
  )

  const joinedRows = rawRows as unknown as JoinedRow[] | undefined

  const data = useMemo(
    () => joinedRows?.map((row) => projectLoanListEntry(row.loan, row.bal, row.cust, today)),
    [joinedRows, today],
  )

  return { data, isLoading }
}

/**
 * Live query: all loans for one customer (powers the customer-detail page
 * and the credit-score badge). Same projected shape as useLoansWithBalances.
 */
export function useLoansForCustomer(customerId: string): { data: LoanListEntry[] | undefined; isLoading: boolean } {
  const today = useMemo(() => new Date(), [])
  const { data: rawRows, isLoading } = useLiveQuery(
    (q) =>
      q
        .from({ loan: loanCollection })
        .join({ bal: loanBalanceCollection }, ({ loan, bal }) => eq(loan.id, bal.loanId), "left")
        .join({ cust: customerCollection }, ({ loan, cust }) => eq(loan.customerId, cust.id), "left")
        .where(({ loan }) => and(eq(loan.customerId, customerId), isNull(loan.deletedAt))),
    [customerId],
  )

  const joinedRows = rawRows as unknown as JoinedRow[] | undefined

  const data = useMemo(
    () => joinedRows?.map((row) => projectLoanListEntry(row.loan, row.bal, row.cust, today)),
    [joinedRows, today],
  )

  return { data, isLoading }
}
