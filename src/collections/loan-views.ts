"use client";

import { useLiveQuery, eq, and, isNull } from "@tanstack/react-db";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { loanCollection } from "./loans";
import { operationalLoanCollection } from "./operational-loans";
import { loanBalanceCollection } from "./loan-balances";
import { customerCollection } from "./customers";
import {
  getCustomerLoansCollection,
  pinCollectionKey,
  unpinCollectionKey,
} from "./loan-extras";
import { getLoanWithBalanceAction } from "@/actions/loan.actions";
import { queryKeys } from "@/lib/query-keys";
import type { LoanListEntry } from "@/types/loan";

/**
 * Soft-delete filter, applied uniformly to all loan views.
 *
 * The Electric shape syncs every row from the `loans` table — including
 * those with `deleted_at` set. Server actions filter `isNull(deletedAt)`
 * everywhere; the UI must mirror that filter so a soft-deleted loan is
 * invisible to users at every surface (list, detail, customer page).
 */

type JoinedLoanRow = {
  loan: {
    id: string;
    customerId: string;
    startDate: Date;
    customerName?: string;
    customerContact?: string | null;
  } & Record<string, unknown>;
  bal?: {
    daysOverdue?: number;
    totalBalanceOwed?: string;
    dailyRate?: string;
    lastPaymentDate?: Date | null;
    unpaidInterest?: string;
  } | null;
  cust?: { fullName?: string; contact?: string | null } | null;
};

function mapJoinedRow(joined: JoinedLoanRow): LoanListEntry {
  return {
    ...(joined.loan as unknown as LoanListEntry),
    daysOverdue: joined.bal?.daysOverdue || 0,
    outstandingBalance: joined.bal?.totalBalanceOwed || "0",
    dailyRate: joined.bal?.dailyRate || "0",
    lastPaymentDate: joined.bal?.lastPaymentDate || joined.loan.startDate,
    unpaidInterest: joined.bal?.unpaidInterest || "0",
    // Prefer server SQL join names (operational list); fall back to customer sync
    customerName: joined.loan.customerName ?? joined.cust?.fullName ?? "—",
    customerContact:
      joined.loan.customerContact ?? joined.cust?.contact ?? null,
  };
}

/**
 * Live query: every loan, joined with its balance projection and customer.
 * Returns rows shaped like the legacy `LoanListEntry`.
 * Prefer `useOperationalLoansWithBalances` for watchlist / payment pickers.
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
    () => rawRows.map((row) => mapJoinedRow(row as unknown as JoinedLoanRow)),
    [rawRows],
  );

  return { data, isLoading };
}

/**
 * Uncapped active-only loans for operational UI (watchlist, export pickers,
 * overdue filters). Prefers server customerName from listOperationalLoans.
 */
export function useOperationalLoansWithBalances(): {
  data: LoanListEntry[] | undefined;
  isLoading: boolean;
} {
  const { data: rawRows, isLoading } = useLiveQuery((q) =>
    q
      .from({ loan: operationalLoanCollection })
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
    () => rawRows.map((row) => mapJoinedRow(row as unknown as JoinedLoanRow)),
    [rawRows],
  );

  return { data, isLoading };
}

/**
 * Live query: a single loan by id, joined with balance + customer.
 * Falls back to uncapped server fetch when outside the 500-cap sync window.
 */
export function useLoanWithBalance(loanId: string): {
  data: LoanListEntry[] | undefined;
  isLoading: boolean;
} {
  const { data: rawRows, isLoading: collectionLoading } = useLiveQuery(
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

  const collectionData = useMemo(
    () =>
      rawRows.map((row) => mapJoinedRow(row as unknown as JoinedLoanRow)),
    [rawRows],
  );

  const needsFallback =
    !collectionLoading && collectionData.length === 0 && !!loanId;

  const { data: fallback, isLoading: fallbackLoading } = useQuery({
    queryKey: queryKeys.loans.detail(loanId),
    queryFn: async () => {
      const result = await getLoanWithBalanceAction(loanId);
      if ("error" in result) return null;
      return result.data;
    },
    enabled: needsFallback,
    staleTime: 30_000,
  });

  const data = useMemo(() => {
    if (collectionData.length > 0) return collectionData;
    if (fallback) return [fallback];
    return collectionData;
  }, [collectionData, fallback]);

  const isLoading = collectionLoading || (needsFallback && fallbackLoading);

  return { data, isLoading };
}

/**
 * Live query: all loans for one customer (powers the customer-detail page
 * and the credit-score badge). Uses uncapped per-customer server fetch —
 * not the global 500-cap loanCollection (R13-2).
 */
export function useLoansForCustomer(customerId: string): {
  data: LoanListEntry[] | undefined;
  isLoading: boolean;
} {
  const collection = useMemo(
    () => getCustomerLoansCollection(customerId),
    [customerId],
  );

  useEffect(() => {
    if (!customerId) return;
    pinCollectionKey(customerId);
    return () => unpinCollectionKey(customerId);
  }, [customerId]);

  const { data: rawRows, isLoading } = useLiveQuery(
    (q) => q.from({ loan: collection }).select(({ loan }) => loan),
    [collection],
  );

  const data = useMemo(() => {
    if (!rawRows) return undefined;
    return rawRows.map(({ _key: _ignored, ...loan }) => loan as LoanListEntry);
  }, [rawRows]);

  return { data, isLoading };
}
