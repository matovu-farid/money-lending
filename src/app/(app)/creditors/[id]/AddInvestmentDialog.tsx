"use client"

import { useState, useTransition } from "react"
import { useForm, Controller } from "react-hook-form"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { useLiveQuery } from "@tanstack/react-db"
import { addInvestment } from "@/collections/creditor-actions"
import { bankAccountCollection } from "@/collections/bank-accounts"
import { PosReceiptModal } from "@/components/receipts/pos-receipt-modal"
import { PosReceiptTransaction, type TransactionReceiptData } from "@/components/receipts/pos-receipt-transaction"
import { ConfirmSummaryDialog, type SummaryLine } from "@/components/ui/confirm-summary-dialog"
import { getTransactionReceiptDataAction } from "@/actions/receipt.actions"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/label"
import { MoneyInput } from "@/components/ui/money-input"
import { InfoPopover } from "@/components/ui/info-popover"
import { BankAccountSelect } from "@/components/ui/bank-account-select"
import { todayDateString } from "@/lib/utils"
import { PRINCIPAL_AMOUNT_PRESETS } from "@/lib/constants"

interface Props {
  creditorId: string
}

interface InvestmentFormValues {
  amount: string
  interestRate: string
  date: string
  bankAccountId: string
}

export function AddInvestmentDialog({ creditorId }: Props) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [receipt, setReceipt] = useState<TransactionReceiptData | null>(null)
  const [pending, setPending] = useState<InvestmentFormValues | null>(null)
  const { data: bankAccounts } = useLiveQuery((q) =>
    q.from({ b: bankAccountCollection }).select(({ b }) => b),
  )

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<InvestmentFormValues>({
    defaultValues: {
      amount: "",
      interestRate: "10",
      date: todayDateString(),
      bankAccountId: "",
    },
  })

  function resetForm() {
    reset({
      amount: "",
      interestRate: "10",
      date: todayDateString(),
      bankAccountId: "",
    })
  }

  function onValidated(data: InvestmentFormValues) {
    setPending(data)
  }

  function onConfirm() {
    if (!pending) return
    startTransition(async () => {
      try {
        let createdInvestmentId: string | null = null
        const tx = addInvestment({
          creditorId,
          amount: pending.amount.trim(),
          interestRateMonthly: (Number(pending.interestRate) / 100).toString(),
          investmentDate: pending.date,
          depositLocation: "bank",
          subLocationId: pending.bankAccountId,
          onInvestmentCreated: (id) => { createdInvestmentId = id },
        })
        await tx.isPersisted.promise
        toast.success("Investment added successfully")
        setPending(null)
        setOpen(false)
        resetForm()

        if (createdInvestmentId) {
          const result = await getTransactionReceiptDataAction({
            kind: "creditor_investment",
            investmentId: createdInvestmentId,
          })
          if ("data" in result) setReceipt(result.data)
        }
      } catch (err: any) {
        toast.error(err?.message ?? "Failed to add investment")
      }
    })
  }

  const summaryLines: SummaryLine[] = pending
    ? [
        { label: "Amount", value: `UGX ${formatCurrency(pending.amount)}`, emphasis: true },
        { label: "Monthly rate", value: `${pending.interestRate}%` },
        { label: "Date", value: formatDate(pending.date) },
        {
          label: "Deposit to",
          value: (bankAccounts ?? []).find((b) => b.id === pending.bankAccountId)?.name ?? "—",
        },
      ]
    : []

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Add Investment
      </Button>
      <DrawerDialog open={open} onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) resetForm()
      }}>
      <DrawerDialogContent>
        <DialogHeader>
          <DialogTitle>Add Investment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onValidated)} className="space-y-4">
          <MoneyInput
            name="amount"
            control={control}
            label="Amount"
            required="Valid amount is required"
            placeholder="e.g. 5,000,000"
            disabled={isPending}
            id="inv-amount"
            presets={PRINCIPAL_AMOUNT_PRESETS}
          />

          <div className="space-y-1">
            <Label htmlFor="inv-rate" className="inline-flex items-center gap-1">
              Monthly Interest Rate
              <InfoPopover>
                <p className="font-semibold text-sm mb-1">Creditor Interest Rate</p>
                <p className="text-xs text-muted-foreground mb-2">
                  The monthly rate you pay the creditor on their investment. This is a cost to the business — different from the rate charged to borrowers.
                </p>
                <div className="bg-muted/50 rounded-md p-2 text-xs space-y-1">
                  <p className="font-medium">Example:</p>
                  <p>Creditor invests UGX 10,000,000 at 5%/month</p>
                  <p>You owe the creditor UGX 500,000/month in interest</p>
                </div>
              </InfoPopover>
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="inv-rate"
                type="number"
                min="0"
                max="100"
                step="0.01"
                disabled={isPending}
                className="flex-1"
                {...register("interestRate", {
                  required: "Valid interest rate is required",
                  validate: v => !isNaN(Number(v)) || "Valid interest rate is required",
                })}
              />
              <span className="text-sm text-muted-foreground font-medium w-6 shrink-0">%</span>
            </div>
            {errors.interestRate && (
              <p className="text-sm text-destructive">{errors.interestRate.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="inv-date">Date</Label>
            <Controller
              name="date"
              control={control}
              rules={{ required: "Date is required" }}
              render={({ field }) => (
                <DatePicker
                  id="inv-date"
                  value={field.value}
                  onChange={field.onChange}
                  disabled={isPending}
                />
              )}
            />
            {errors.date && <p className="text-sm text-destructive">{errors.date.message}</p>}
          </div>

          <BankAccountSelect
            name="bankAccountId"
            control={control}
            label="Deposit To"
            disabled={isPending}
            id="inv-bank-account"
            showBalances={false}
          />

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="animate-spin h-4 w-4" />
                  Adding...
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
        title="Confirm investment"
        description="Review the investment before posting to the ledger."
        lines={summaryLines}
        isPending={isPending}
        onConfirm={onConfirm}
        confirmLabel="Add investment"
      />

      <PosReceiptModal
        open={receipt !== null}
        onClose={() => setReceipt(null)}
        title="Creditor Investment Receipt"
        autoActions
      >
        {receipt && <PosReceiptTransaction data={receipt} />}
      </PosReceiptModal>
    </>
  )
}
