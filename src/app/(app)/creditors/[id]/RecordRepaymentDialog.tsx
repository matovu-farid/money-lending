"use client"

import { useState, useTransition } from "react"
import { useForm, Controller } from "react-hook-form"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { BigNumber } from "bignumber.js"
import { recordCreditorRepayment } from "@/collections/creditor-actions"
import { PosReceiptModal } from "@/components/receipts/pos-receipt-modal"
import { PosReceiptTransaction, type TransactionReceiptData } from "@/components/receipts/pos-receipt-transaction"
import { ConfirmSummaryDialog, type SummaryLine } from "@/components/ui/confirm-summary-dialog"
import { getTransactionReceiptDataAction } from "@/actions/receipt.actions"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import {
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/label"
import { MoneyInput } from "@/components/ui/money-input"
import { InfoPopover } from "@/components/ui/info-popover"
import { formatCurrency, formatDate, todayDateString } from "@/lib/utils"
import { CurrencyCell } from "@/components/ui/currency-cell"
import { PRINCIPAL_AMOUNT_PRESETS } from "@/lib/constants"
import type { CreditorInvestmentSummary } from "@/types"

interface Props {
  creditorId: string
  investment: CreditorInvestmentSummary
}

interface RepaymentFormValues {
  amount: string
  date: string
}

export function RecordRepaymentDialog({ creditorId, investment }: Props) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [receipt, setReceipt] = useState<TransactionReceiptData | null>(null)
  const [pending, setPending] = useState<RepaymentFormValues | null>(null)

  const investmentOutstanding = new BigNumber(investment.principalBalance)
    .plus(investment.interestAccrued)
    .toString()

  const {
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<RepaymentFormValues>({
    defaultValues: {
      amount: "",
      date: todayDateString(),
    },
  })

  function resetForm() {
    reset({
      amount: "",
      date: todayDateString(),
    })
  }

  function onValidated(data: RepaymentFormValues) {
    setPending(data)
  }

  function onConfirm() {
    if (!pending) return
    startTransition(async () => {
      try {
        const createdRepaymentId = await recordCreditorRepayment({
          creditorId,
          investmentId: investment.id,
          amount: pending.amount.trim(),
          repaymentDate: pending.date,
        })
        toast.success("Repayment recorded successfully")
        setPending(null)
        setOpen(false)
        resetForm()

        const result = await getTransactionReceiptDataAction({
          kind: "creditor_repayment",
          repaymentId: createdRepaymentId,
        })
        if ("data" in result) setReceipt(result.data)
      } catch (err: any) {
        toast.error(err?.message ?? "Failed to record repayment")
      }
    })
  }

  const summaryLines: SummaryLine[] = pending
    ? [
        {
          label: "Investment",
          value: `${formatCurrency(investment.amount)} — ${formatDate(investment.investmentDate)}`,
        },
        { label: "Repayment", value: formatCurrency(pending.amount), emphasis: true },
        { label: "Date", value: formatDate(pending.date) },
      ]
    : []

  return (
    <>
      <Button
        variant="default"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="Record repayment for this investment"
      >
        Repay
      </Button>
      <DrawerDialog open={open} onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) resetForm()
      }}>
      <DrawerDialogContent>
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-1">
            Record Repayment
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Creditor Repayment</p>
              <p className="text-xs text-muted-foreground mb-2">
                A payment made back to the creditor (investor) against this specific investment. Reduces the outstanding balance you owe them.
              </p>
            </InfoPopover>
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onValidated)} className="space-y-4">
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Investment</span>
              <span className="font-mono tabular-nums text-right">
                {formatCurrency(investment.amount)} — {formatDate(investment.investmentDate)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground inline-flex items-center gap-1">
                Outstanding
                <InfoPopover>
                  <p className="font-semibold text-sm mb-1">Outstanding Balance</p>
                  <p className="text-xs text-muted-foreground">
                    Remaining principal plus accrued interest on this investment.
                  </p>
                </InfoPopover>
              </span>
              <CurrencyCell amount={investmentOutstanding} className="font-medium" />
            </div>
          </div>

          <MoneyInput
            name="amount"
            control={control}
            label="Amount"
            required="Valid amount is required"
            placeholder="e.g. 500,000"
            disabled={isPending}
            id="repay-amount"
            presets={PRINCIPAL_AMOUNT_PRESETS}
          />

          <div className="space-y-1">
            <Label htmlFor="repay-date">Date</Label>
            <Controller
              name="date"
              control={control}
              rules={{ required: "Date is required" }}
              render={({ field }) => (
                <DatePicker
                  id="repay-date"
                  value={field.value}
                  onChange={field.onChange}
                  disabled={isPending}
                />
              )}
            />
            {errors.date && <p className="text-sm text-destructive">{errors.date.message}</p>}
          </div>

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="animate-spin h-4 w-4" />
                  Recording...
                </>
              ) : (
                "Review"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DrawerDialogContent>
      </DrawerDialog>

      <ConfirmSummaryDialog
        open={pending !== null}
        onOpenChange={(o) => { if (!o) setPending(null) }}
        title="Confirm repayment"
        description="Review the repayment before posting to the ledger."
        lines={summaryLines}
        isPending={isPending}
        onConfirm={onConfirm}
        confirmLabel="Record repayment"
      />

      <PosReceiptModal
        open={receipt !== null}
        onClose={() => setReceipt(null)}
        title="Creditor Repayment Receipt"
        autoActions
      >
        {receipt && <PosReceiptTransaction data={receipt} />}
      </PosReceiptModal>
    </>
  )
}
