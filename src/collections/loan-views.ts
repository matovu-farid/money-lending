"use client";

import { useLiveQuery, eq, and, isNull } from "@tanstack/react-db";
import { useMemo } from "react";
import { loanCollection } from "./loans";
import { loanBalanceCollection } from "./loan-balances";
import { customerCollection } from "./customers";
import type { LoanListEntry } from "@/types/loan";

/**
 * Soft-delete filter, applied uniformly to all loan views.
 *
 * The Electric shape syncs every row from the `loans` table — including
 * those with `deleted_at` set. Server actions filter `isNull(deletedAt)`
 * everywhere; the UI must mirror that filter so a soft-deleted loan is
 * invisible to users at every surface (list, detail, customer page).
 */

/**
 * Live query: every loan, joined with its balance projection and customer.
 * Returns rows shaped like the legacy `LoanListEntry`.
 */
export function useLoansWithBalances(): {
  data: LoanListEntry[] | undefined;
  isLoading: boolean;
} {
  const { data: rawRows, isLoading } = useLiveQuery((q) =>
    q
      .from({ loan: loanCollection })
      .join(
        { bal: loanBalanceCollection },
        ({ loan, bal }) => eq(loan.id, bal.loanId),
        "left",
      )
      .join(
        { cust: customerCollection },
        ({ loan, cust }) => eq(loan.customerId, cust.id),
        "left",
      )
      .where(({ loan }) => isNull(loan.deletedAt)),
  );

  const data = useMemo(
    () =>
      rawRows.map((row) => {
        const joined = row;
        return {
          ...joined.loan,
          daysOverdue: joined.bal?.daysOverdue || 0,
          outstandingBalance: joined.bal?.outstandingBalance || "0",
          dailyRate: joined.bal?.dailyRate || "0",
          lastPaymentDate: joined.bal?.lastPaymentDate || joined.loan.startDate,
          unpaidInterest: joined.bal?.unpaidInterest || "0",
          customerName: joined.cust?.fullName ?? "—",
          customerContact: joined.cust?.contact ?? null,
        };
      }),
    [rawRows],
  );

  return { data, isLoading };
}

/**
 * Live query: a single loan by id, joined with balance + customer.
 */
export function useLoanWithBalance(loanId: string): {
  data: LoanListEntry[] | undefined;
  isLoading: boolean;
} {
  const { data: rawRows, isLoading } = useLiveQuery(
    (q) =>
      q
        .from({ loan: loanCollection })
        .join(
          { bal: loanBalanceCollection },
          ({ loan, bal }) => eq(loan.id, bal.loanId),
          "left",
        )
        .join(
          { cust: customerCollection },
          ({ loan, cust }) => eq(loan.customerId, cust.id),
          "left",
        )
        .where(({ loan }) => and(eq(loan.id, loanId), isNull(loan.deletedAt))),
    [loanId],
  );

  const data = useMemo(
    () =>
      rawRows.map((row) => {
        const joined = row;
        return {
          ...joined.loan,
          daysOverdue: joined.bal?.daysOverdue || 0,
          outstandingBalance: joined.bal?.outstandingBalance || "0",
          dailyRate: joined.bal?.dailyRate || "0",
          lastPaymentDate: joined.bal?.lastPaymentDate || joined.loan.startDate,
          unpaidInterest: joined.bal?.unpaidInterest || "0",
          customerName: joined.cust?.fullName ?? "—",
          customerContact: joined.cust?.contact ?? null,
        };
      }),
    [rawRows],
  );

  return { data, isLoading };
}

/**
 * Live query: all loans for one customer (powers the customer-detail page
 * and the credit-score badge). Same projected shape as useLoansWithBalances.
 */
export function useLoansForCustomer(customerId: string): {
  data: LoanListEntry[] | undefined;
  isLoading: boolean;
} {
  const today = useMemo(() => new Date(), []);
  const { data: rawRows, isLoading } = useLiveQuery(
    (q) =>
      q
        .from({ loan: loanCollection })
        .join(
          { bal: loanBalanceCollection },
          ({ loan, bal }) => eq(loan.id, bal.loanId),
          "left",
        )
        .join(
          { cust: customerCollection },
          ({ loan, cust }) => eq(loan.customerId, cust.id),
          "left",
        )
        .where(({ loan }) =>
          and(eq(loan.customerId, customerId), isNull(loan.deletedAt)),
        ),
    [customerId],
  );

  const data = useMemo(
    () =>
      rawRows.map((row) => {
        const joined = row;
        return {
          ...joined.loan,
          daysOverdue: joined.bal?.daysOverdue || 0,
          outstandingBalance: joined.bal?.outstandingBalance || "0",
          dailyRate: joined.bal?.dailyRate || "0",
          lastPaymentDate: joined.bal?.lastPaymentDate || joined.loan.startDate,
          unpaidInterest: joined.bal?.unpaidInterest || "0",
          customerName: joined.cust?.fullName ?? "—",
          customerContact: joined.cust?.contact ?? null,
        };
      }),
    [rawRows],
  );

  return { data, isLoading };
}
