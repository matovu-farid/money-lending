"use client";

import { useParams } from "next/navigation";
import { useLiveQuery, eq, and, isNull } from "@tanstack/react-db";
import { loanCollection } from "@/collections/loans";
import { customerCollection } from "@/collections/customers";
import { loanBalanceCollection } from "@/collections/loan-balances";
import { shortId } from "@/lib/utils";
import { RecordPaymentForm } from "./record-payment-form";

export default function RecordPaymentPage() {
  const { loanId } = useParams<{ loanId: string }>();

  // Loan + customer come from globally-synced Electric collections. They render
  // immediately when in cache; otherwise we show a brief loading skeleton.
  // Soft-deleted loans must fail closed: filter `deletedAt IS NULL` so the
  // "Loan not found." state renders instead of letting a user record a
  // payment against a wiped ledger.
  const { data: loans, isLoading: loansLoading } = useLiveQuery(
    (q) =>
      q
        .from({ l: loanCollection })
        .where(({ l }) => and(eq(l.id, loanId), isNull(l.deletedAt))),
    [loanId],
  );
  const loan = loans?.[0] ?? null;

  const loanLoading = loansLoading && !loan;
  const { data: customers } = useLiveQuery(
    (q) =>
      q
        .from({ c: customerCollection })
        .where(({ c }) => eq(c.id, loan?.customerId ?? "")),
    [loan?.customerId],
  );
  const customerName = customers?.[0]?.fullName ?? "";

  // Per-loan balance from the Electric-synced loan_balances projection table.
  // Don't suspend on it — the form can render and let the user start typing;
  // balance-aware UI fills in once the data arrives.
  const { data: balanceRows } = useLiveQuery(
    (q) =>
      q
        .from({ b: loanBalanceCollection })
        .where(({ b }) => eq(b.loanId, loanId)),
    [loanId],
  );
  const balanceRow = balanceRows?.[0] ?? null;
  // Map Electric field names to the shape RecordPaymentForm expects.
  const balanceData = balanceRow
    ? {
        outstandingPrincipal: balanceRow.totalBalanceOwed,
        accruedInterest: balanceRow.unpaidInterest,
        totalBalance: String(
          parseFloat(balanceRow.totalBalanceOwed) +
            parseFloat(balanceRow.unpaidInterest),
        ),
      }
    : null;
  const balanceLoading = !balanceData;

  if (loanLoading) {
    return (
      <div className="p-4 md:p-6 max-w-xl">
        <div className="space-y-4">
          <div className="h-9 w-24 rounded bg-muted-foreground/10 animate-pulse" />
          <div className="h-8 w-48 rounded bg-muted-foreground/10 animate-pulse" />
          <div className="h-40 w-full rounded-lg bg-muted-foreground/10 animate-pulse" />
          <div className="h-64 w-full rounded-lg bg-muted-foreground/10 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!loan) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-destructive">Loan not found.</p>
      </div>
    );
  }

  return (
    <RecordPaymentForm
      loanId={loanId}
      customerId={loan.customerId}
      customerName={customerName}
      loanReference={`LOAN-${shortId(loan.id).toUpperCase()}`}
      loanStartDate={
        loan.startDate instanceof Date
          ? loan.startDate.toISOString()
          : String(loan.startDate)
      }
      balanceData={balanceData ?? null}
      balanceLoading={balanceLoading}
    />
  );
}
