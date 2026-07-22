"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { HandCoins, Loader2 } from "lucide-react";
import { useLiveQuery } from "@tanstack/react-db";
import { endOfDay, format } from "date-fns";
import { getLoanWaiversCollection, insertWaiverWithInput } from "@/collections/loan-waivers";
import { generateClientId } from "@/lib/client-id";
import { previewWaiverAllocation } from "@/lib/interest/engine";
import { getEffectiveRate, isPenaltyActive } from "@/lib/interest/effective-rate";
import { daysBetween } from "@/lib/db/utils";
import { formatCurrency, formatNumberWithCommas } from "@/lib/utils";
import { toLoanType, type Loan } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog";
import {
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface WaiveLoanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loan: Loan;
  daysOverdue: number;
  paymentDates: Date[];
  principalBalance: string;
  unpaidInterest: string;
  totalDue: string;
}

export function WaiveLoanDialog({
  open,
  onOpenChange,
  loan,
  daysOverdue,
  paymentDates,
  principalBalance,
  unpaidInterest,
  totalDue,
}: WaiveLoanDialogProps) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);

  const waiverColl = useMemo(
    () => getLoanWaiversCollection(loan.id),
    [loan.id],
  );
  const { data: waiverRows = [] } = useLiveQuery(
    (q) => q.from({ w: waiverColl }).select(({ w }) => w),
    [waiverColl],
  );

  const lastSettlementDate = useMemo(() => {
    let last = new Date(loan.startDate);
    for (const paymentDate of paymentDates) {
      const d = new Date(paymentDate);
      if (d.getTime() > last.getTime()) last = d;
    }
    const waivers = Array.isArray(waiverRows) ? waiverRows : [];
    for (const w of waivers) {
      const d = new Date(w.waiverDate);
      if (d.getTime() > last.getTime()) last = d;
    }
    return last;
  }, [loan.startDate, paymentDates, waiverRows]);

  const activePaymentCount = paymentDates.length;

  useEffect(() => {
    if (!open) {
      setAmount("");
      setReason("");
    }
  }, [open]);

  const preview = useMemo(() => {
    const trimmed = amount.trim();
    if (!trimmed || Number.isNaN(Number(trimmed)) || Number(trimmed) <= 0) {
      return null;
    }

    const penaltyActive = isPenaltyActive(daysOverdue, loan.penaltyWaived);
    const monthlyRateDecimal = getEffectiveRate(loan, penaltyActive);
    const daysElapsed = daysBetween(
      new Date(lastSettlementDate),
      endOfDay(new Date()),
    );

    return previewWaiverAllocation({
      amount: trimmed,
      principalBalanceBefore: principalBalance,
      unpaidInterest,
      monthlyRateDecimal,
      daysElapsed,
      minInterestDays: loan.minPeriodOverride ?? loan.minInterestDays,
      loanType: toLoanType(loan.loanType),
      originalPrincipal: loan.principalAmount,
      termMonths: loan.termMonths ?? undefined,
      paymentNumber: Math.max(activePaymentCount, 1),
    });
  }, [
    amount,
    principalBalance,
    unpaidInterest,
    loan,
    daysOverdue,
    activePaymentCount,
    lastSettlementDate,
  ]);

  async function handleSubmit() {
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 10) {
      toast.error("Reason must be at least 10 characters");
      return;
    }

    const trimmedAmount = amount.trim();
    if (
      !trimmedAmount ||
      Number.isNaN(Number(trimmedAmount)) ||
      Number(trimmedAmount) <= 0
    ) {
      toast.error("Enter a valid waiver amount");
      return;
    }

    try {
      setIsPending(true);
      const waiverId = generateClientId();
      const input = {
        id: waiverId,
        loanId: loan.id,
        amount: trimmedAmount,
        reason: trimmedReason,
      };
      const tx = insertWaiverWithInput(
        {
          id: waiverId,
          loanId: loan.id,
          amount: trimmedAmount,
          waiverDate: new Date(),
          reason: trimmedReason,
          recordedBy: "pending",
          createdAt: new Date(),
          deletedAt: null,
        },
        input,
      );
      await tx.isPersisted.promise;
      toast.success("Loan amount waived");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to waive amount");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <DrawerDialog open={open} onOpenChange={onOpenChange}>
      <DrawerDialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="h-5 w-5 text-amber-600" />
            Waive Loan Amount
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            Write down part of the outstanding balance without collecting cash.
            Interest is waived first, then principal — same allocation order as
            payments.
          </p>

          <Card>
            <CardContent className="p-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Principal Balance</span>
                <span className="font-medium">
                  {formatCurrency(principalBalance)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Unpaid Interest</span>
                <span className="font-medium">
                  {formatCurrency(unpaidInterest)}
                </span>
              </div>
              <Separator className="my-2" />
              <div className="flex justify-between font-semibold">
                <span>Total Due</span>
                <span>{formatCurrency(totalDue)}</span>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <Label htmlFor="waiver-amount">Waiver Amount</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-medium w-10 shrink-0">
                UGX
              </span>
              <Input
                id="waiver-amount"
                type="text"
                inputMode="numeric"
                placeholder="e.g. 1,000,000"
                className="flex-1"
                value={formatNumberWithCommas(amount)}
                onChange={(e) => {
                  const raw =
                    e.target.value.replace(/[^0-9]/g, "").replace(/^0+/, "") ||
                    "";
                  setAmount(raw);
                }}
              />
            </div>
          </div>

          {preview && (
            <Card>
              <CardContent className="p-3 space-y-2 text-sm">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Allocation Preview
                </p>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Interest portion</span>
                  <span className="font-medium">
                    {formatCurrency(preview.interestPortion)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Principal portion</span>
                  <span className="font-medium">
                    {formatCurrency(preview.principalPortion)}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="space-y-2">
            <Label htmlFor="waiver-reason">Reason (required)</Label>
            <Textarea
              id="waiver-reason"
              placeholder="Explain why this amount is being waived (min 10 characters)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirm Waiver
          </Button>
        </DialogFooter>
      </DrawerDialogContent>
    </DrawerDialog>
  );
}

interface WaiverHistorySectionProps {
  loanId: string;
  userNameMap: Record<string, string>;
}

export function WaiverHistorySection({
  loanId,
  userNameMap,
}: WaiverHistorySectionProps) {
  const waiverColl = useMemo(() => getLoanWaiversCollection(loanId), [loanId]);
  const { data: rows = [] } = useLiveQuery(
    (q) => q.from({ w: waiverColl }).select(({ w }) => w),
    [waiverColl],
  );
  const waivers = Array.isArray(rows) ? rows : [];

  if (waivers.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h3 className="font-semibold mb-3 text-sm uppercase tracking-wider text-muted-foreground">
        Waiver History
      </h3>
      <div className="rounded-md border overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-left">Reason</th>
              <th className="px-3 py-2 text-left">Recorded By</th>
            </tr>
          </thead>
          <tbody>
            {[...waivers]
              .sort(
                (a, b) =>
                  new Date(b.waiverDate).getTime() -
                  new Date(a.waiverDate).getTime(),
              )
              .map((w) => (
                <tr key={w.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {format(new Date(w.waiverDate), "MMM d, yyyy")}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatCurrency(w.amount)}
                  </td>
                  <td className="px-3 py-2 max-w-xs">{w.reason}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {userNameMap[w.recordedBy] ?? "—"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
