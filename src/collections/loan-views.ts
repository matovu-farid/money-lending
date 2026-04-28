"use client"

import { useLiveQuery, eq } from "@tanstack/react-db"
import { useMemo } from "react"
import { loanCollection } from "./loans"
import { loanBalanceCollection } from "./loan-balances"
import { customerCollection } from "./customers"
import { computeDaysOverdue } from "@/lib/interest/overdue-client"
import { computeDailyRate } from "@/lib/interest/effective-rate-client"
import type { LoanListEntry } from "@/types/loan"
import type { LoanBaseRow, LoanBalanceRow, CustomerRow } from "@/lib/schemas/collections"

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
  const unpaidInterest = bal?.unpaidInterest ?? "0"
  return {
    ...loan,
    customerName: cust?.fullName ?? "—",
    customerContact: cust?.contact ?? null,
    outstandingBalance,
    unpaidInterest,
    lastPaymentDate: bal?.lastPaymentDate ?? null,
    daysOverdue: computeDaysOverdue(loan, unpaidInterest, outstandingBalance, today),
    dailyRate: computeDailyRate(loan, outstandingBalance),
  }
}

/**
 * Shape returned by the join query before client-side projection.
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
      .join({ cust: customerCollection }, ({ loan, cust }) => eq(loan.customerId, cust.id), "left"),
  )

  const data = useMemo(
    () =>
      rawRows?.map((row) => {
        const joined = row as unknown as JoinedRow
        return projectLoanListEntry(joined.loan, joined.bal, joined.cust, today)
      }),
    [rawRows, today],
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
        .where(({ loan }) => eq(loan.id, loanId)),
    [loanId],
  )

  const data = useMemo(
    () =>
      rawRows?.map((row) => {
        const joined = row as unknown as JoinedRow
        return projectLoanListEntry(joined.loan, joined.bal, joined.cust, today)
      }),
    [rawRows, today],
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
        .where(({ loan }) => eq(loan.customerId, customerId)),
    [customerId],
  )

  const data = useMemo(
    () =>
      rawRows?.map((row) => {
        const joined = row as unknown as JoinedRow
        return projectLoanListEntry(joined.loan, joined.bal, joined.cust, today)
      }),
    [rawRows, today],
  )

  return { data, isLoading }
}
