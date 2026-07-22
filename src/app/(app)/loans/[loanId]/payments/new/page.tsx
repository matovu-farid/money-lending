"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery, eq } from "@tanstack/react-db";
import { loanBalanceCollection } from "@/collections/loan-balances";
import { getLoanPaymentContextAction } from "@/actions/loan.actions";
import { queryKeys } from "@/lib/query-keys";
import { isOperationalLoan } from "@/lib/loan-visibility";
import { RecordPaymentForm } from "./record-payment-form";

export default function RecordPaymentPage() {
  const { loanId } = useParams<{ loanId: string }>();

  // Uncapped server context (includes status) — do not rely on 500-cap loanCollection
  const { data: ctx, isLoading: ctxLoading } = useQuery({
    queryKey: [...queryKeys.loans.detail(loanId), "payment-context"],
    queryFn: async () => {
      const result = await getLoanPaymentContextAction(loanId);
      if ("error" in result) return null;
      return result.data;
    },
    staleTime: 30_000,
  });

  // Per-loan balance from the projection table.
  const { data: balanceRows } = useLiveQuery(
    (q) =>
      q
        .from({ b: loanBalanceCollection })
        .where(({ b }) => eq(b.loanId, loanId)),
    [loanId],
  );
  const balanceRow = balanceRows?.[0] ?? null;
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

  if (ctxLoading) {
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

  if (!ctx) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-destructive">Loan not found.</p>
      </div>
    );
  }

  if (!isOperationalLoan(ctx.status)) {
    return (
      <div className="p-4 md:p-6 max-w-xl space-y-3">
        <p className="text-destructive font-medium">
          This loan is not active — payments cannot be recorded.
        </p>
        <p className="text-sm text-muted-foreground">
          Status: {ctx.status}. Open the current (successor) loan to record a
          payment.
        </p>
      </div>
    );
  }

  return (
    <RecordPaymentForm
      loanId={loanId}
      customerId={ctx.customerId}
      customerName={ctx.customerName}
      loanReference={ctx.loanReference}
      loanStartDate={ctx.startDate}
      balanceData={balanceData ?? null}
      balanceLoading={balanceLoading}
    />
  );
}
