"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { HandCoins, Loader2, Undo2 } from "lucide-react";
import { useLiveQuery } from "@tanstack/react-db";
import { endOfDay, format } from "date-fns";
import {
  getLoanWaiversCollection,
  insertWaiverWithInput,
  invalidateLoanWaiverMutation,
  type LoanWaiverRow,
} from "@/collections/loan-waivers";
import { generateClientId } from "@/lib/client-id";
import { previewWaiverAllocation } from "@/lib/interest/engine";
import { getEffectiveRate, isPenaltyActive } from "@/lib/interest/effective-rate";
import { daysBetween } from "@/lib/db/utils";
import { formatCurrency, formatNumberWithCommas } from "@/lib/utils";
import { undoLoanWaiverAction } from "@/actions/loan-waiver.actions";
import { toLoanType, type Loan } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog";
import { ConfirmSummaryDialog } from "@/components/ui/confirm-summary-dialog";
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { captureClientError } from "@/lib/sentry";

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
  const [reviewStep, setReviewStep] = useState(false);
  const [pendingData, setPendingData] = useState<{
    amount: string;
    reason: string;
    interestPortion: string;
    principalPortion: string;
  } | null>(null);
  const pendingRef = useRef(false);

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
      setReviewStep(false);
      setPendingData(null);
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

  function handleReview() {
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

    if (!preview) {
      toast.error("Enter a valid waiver amount");
      return;
    }

    setPendingData({
      amount: trimmedAmount,
      reason: trimmedReason,
      interestPortion: preview.interestPortion,
      principalPortion: preview.principalPortion,
    });
    setReviewStep(true);
  }

  async function handleConfirm() {
    if (!pendingData || isPending || pendingRef.current) return;

    pendingRef.current = true;
    try {
      setIsPending(true);
      const waiverId = generateClientId();
      const input = {
        id: waiverId,
        loanId: loan.id,
        amount: pendingData.amount,
        reason: pendingData.reason,
      };
      const tx = insertWaiverWithInput(
        {
          id: waiverId,
          loanId: loan.id,
          amount: pendingData.amount,
          waiverDate: new Date(),
          reason: pendingData.reason,
          recordedBy: "pending",
          createdAt: new Date(),
          deletedAt: null,
          interestPortion: "0",
          principalPortion: "0",
        },
        input,
      );
      await tx.isPersisted.promise;
      toast.success("Loan amount waived");
      setReviewStep(false);
      setPendingData(null);
      onOpenChange(false);
    } catch (err) {
      captureClientError(err, { source: "waive-loan-dialog.submit" });
      toast.error(err instanceof Error ? err.message : "Failed to waive amount");
    } finally {
      pendingRef.current = false;
      setIsPending(false);
    }
  }

  return (
    <>
      <DrawerDialog
        open={open && !reviewStep}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onOpenChange(false);
        }}
      >
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
          <Button onClick={handleReview} disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Review Waiver
          </Button>
        </DialogFooter>
      </DrawerDialogContent>
      </DrawerDialog>

      {pendingData && (
        <ConfirmSummaryDialog
          open={open && reviewStep}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setReviewStep(false);
              setPendingData(null);
              onOpenChange(false);
            }
          }}
          title="Review Loan Waiver"
          description="Review the amount and reason before saving this waiver."
          lines={[
            { label: "Loan Reference", value: `LOAN-${loan.id.slice(0, 8).toUpperCase()}` },
            {
              label: "Amount Waived",
              value: formatCurrency(pendingData.amount),
              emphasis: true,
            },
            {
              label: "Interest Waived",
              value: formatCurrency(pendingData.interestPortion),
            },
            {
              label: "Principal Waived",
              value: formatCurrency(pendingData.principalPortion),
            },
            {
              label: "Balance After Waiver",
              value: formatCurrency(
                Math.max(0, Number(totalDue) - Number(pendingData.amount)),
              ),
            },
            { label: "Reason", value: pendingData.reason },
          ]}
          confirmLabel="Confirm & Waive"
          goBackLabel="Back"
          onGoBack={() => {
            setReviewStep(false);
            setPendingData(null);
          }}
          isPending={isPending}
          onConfirm={handleConfirm}
        />
      )}
    </>
  );
}

interface WaiverHistorySectionProps {
  loanId: string;
  userNameMap: Record<string, string>;
  canUndo: boolean;
}

export function WaiverHistorySection({
  loanId,
  userNameMap,
  canUndo,
}: WaiverHistorySectionProps) {
  const waiverColl = useMemo(() => getLoanWaiversCollection(loanId), [loanId]);
  const { data: rows = [] } = useLiveQuery(
    (q) => q.from({ w: waiverColl }).select(({ w }) => w),
    [waiverColl],
  );
  const waivers = Array.isArray(rows) ? rows : [];
  const [undoing, setUndoing] = useState<LoanWaiverRow | null>(null);
  const [undoReason, setUndoReason] = useState("");
  const [isUndoPending, setIsUndoPending] = useState(false);
  const undoPendingRef = useRef(false);

  if (waivers.length === 0) return null;

  function closeUndo() {
    if (undoPendingRef.current) return;
    setUndoing(null);
    setUndoReason("");
  }

  async function handleUndo() {
    if (!undoing || undoPendingRef.current) return;
    const reason = undoReason.trim();
    if (reason.length < 10) {
      toast.error("Reason must be at least 10 characters");
      return;
    }

    undoPendingRef.current = true;
    setIsUndoPending(true);
    try {
      const result = await undoLoanWaiverAction({
        waiverId: undoing.id,
        reason,
      });
      if ("error" in result) throw new Error(result.error);

      invalidateLoanWaiverMutation(loanId);
      try {
        waiverColl.utils.writeDelete(undoing.id);
      } catch {
        // The row may already have been removed by the invalidation refresh.
      }
      toast.success("Loan waiver undone");
      undoPendingRef.current = false;
      closeUndo();
    } catch (error) {
      captureClientError(error, { source: "waive-loan-history.undo" });
      toast.error(error instanceof Error ? error.message : "Failed to undo waiver");
    } finally {
      undoPendingRef.current = false;
      setIsUndoPending(false);
    }
  }

  return (
    <>
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="font-semibold mb-3 text-sm uppercase tracking-wider text-muted-foreground">
          Waiver History
        </h3>
        <div className="rounded-md border overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-right">Amount Waived</th>
                <th className="px-3 py-2 text-left">Reason</th>
                <th className="px-3 py-2 text-left">Recorded By</th>
                {canUndo && <th className="px-3 py-2 text-right">Actions</th>}
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
                    <td
                      className="px-3 py-2 text-right font-mono tabular-nums"
                      data-testid="waiver-amount"
                    >
                      {formatCurrency(w.amount)}
                    </td>
                    <td className="px-3 py-2 max-w-xs">{w.reason}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {userNameMap[w.recordedBy] ?? "—"}
                    </td>
                    {canUndo && (
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setUndoing(w);
                            setUndoReason("");
                          }}
                          disabled={isUndoPending}
                        >
                          <Undo2 className="h-4 w-4" />
                          Undo
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <DrawerDialog
        open={undoing !== null}
        onOpenChange={(open) => {
          if (!open) closeUndo();
        }}
      >
        <DrawerDialogContent>
          <DialogHeader>
            <DialogTitle>Undo Waiver</DialogTitle>
            <DialogDescription>
              This write-down will be reversed and the loan balance restored.
            </DialogDescription>
          </DialogHeader>

          {undoing && (
            <div className="space-y-4 py-4">
              <Card>
                <CardContent className="p-3 text-sm">
                  <div className="flex justify-between font-semibold">
                    <span>Amount Waived</span>
                    <span>{formatCurrency(undoing.amount)}</span>
                  </div>
                </CardContent>
              </Card>
              <div className="space-y-2">
                <Label htmlFor="undo-waiver-reason">Reason (required)</Label>
                <Textarea
                  id="undo-waiver-reason"
                  placeholder="Explain why this waiver is being undone (min 10 characters)"
                  value={undoReason}
                  onChange={(event) => setUndoReason(event.target.value)}
                  rows={3}
                  disabled={isUndoPending}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeUndo} disabled={isUndoPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleUndo}
              disabled={isUndoPending}
            >
              {isUndoPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Undo Waiver
            </Button>
          </DialogFooter>
        </DrawerDialogContent>
      </DrawerDialog>
    </>
  );
}
