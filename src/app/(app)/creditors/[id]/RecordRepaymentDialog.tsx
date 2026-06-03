"use client"

import { useState, useTransition } from "react"
import { useForm, Controller } from "react-hook-form"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/label"
import { MoneyInput } from "@/components/ui/money-input"
import { InfoPopover } from "@/components/ui/info-popover"
import { formatCurrency, todayDateString } from "@/lib/utils"
import { PRINCIPAL_AMOUNT_PRESETS } from "@/lib/constants"
import type { CreditorInvestment } from "@/types"

interface Props {
  creditorId: string
  investments: CreditorInvestment[]
  outstandingBalance: string
}

interface RepaymentFormValues {
  investmentId: string
  amount: string
  date: string
}

export function RecordRepaymentDialog({ creditorId, investments, outstandingBalance }: Props) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [receipt, setReceipt] = useState<TransactionReceiptData | null>(null)
  const [pending, setPending] = useState<RepaymentFormValues | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    control,
    reset,
    formState: { errors },
  } = useForm<RepaymentFormValues>({
    defaultValues: {
      investmentId: "",
      amount: "",
      date: todayDateString(),
    },
  })

  const watchedInvestmentId = watch("investmentId")

  function resetForm() {
    reset({
      investmentId: "",
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
        let createdRepaymentId: string | null = null
        const tx = recordCreditorRepayment({
          creditorId,
          investmentId: pending.investmentId,
          amount: pending.amount.trim(),
          repaymentDate: pending.date,
          onRepaymentCreated: (id) => { createdRepaymentId = id },
        })
        await tx.isPersisted.promise
        toast.success("Repayment recorded successfully")
        setPending(null)
        setOpen(false)
        resetForm()

        if (createdRepaymentId) {
          const result = await getTransactionReceiptDataAction({
            kind: "creditor_repayment",
            repaymentId: createdRepaymentId,
          })
          if ("data" in result) setReceipt(result.data)
        }
      } catch (err: any) {
        toast.error(err?.message ?? "Failed to record repayment")
      }
    })
  }

  const selectedInvestment = pending
    ? investments.find((i) => i.id === pending.investmentId)
    : null
  const summaryLines: SummaryLine[] = pending
    ? [
        {
          label: "Investment",
          value: selectedInvestment
            ? `UGX ${formatCurrency(selectedInvestment.amount)} — ${new Date(selectedInvestment.investmentDate).toLocaleDateString("en-UG")}`
            : "—",
        },
        { label: "Repayment", value: `UGX ${formatCurrency(pending.amount)}`, emphasis: true },
        { label: "Date", value: new Date(pending.date).toLocaleDateString("en-UG") },
      ]
    : []

  return (
    <>
      <Button variant="default" onClick={() => setOpen(true)}>
        Record Repayment
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
                A payment made back to the creditor (investor). This reduces the outstanding balance you owe them. Select which investment this repayment applies to.
              </p>
            </InfoPopover>
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onValidated)} className="space-y-4">
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground inline-flex items-center gap-1">
              Outstanding Balance:
              <InfoPopover>
                <p className="font-semibold text-sm mb-1">Outstanding Balance</p>
                <p className="text-xs text-muted-foreground">
                  Total amount still owed to this creditor across all their investments, minus any repayments already made.
                </p>
              </InfoPopover>
            </span>
            <span className="font-medium font-mono tabular-nums">{formatCurrency(outstandingBalance)}</span>
          </div>

          <div className="space-y-1">
            <Label htmlFor="repay-investment">Investment</Label>
            <Select
              value={watchedInvestmentId}
              onValueChange={(value) => setValue("investmentId", value ?? "", { shouldValidate: true })}
            >
              <SelectTrigger id="repay-investment" className="w-full">
                <SelectValue placeholder="Select investment" />
              </SelectTrigger>
              <SelectContent>
                {investments.map((inv) => (
                  <SelectItem key={inv.id} value={inv.id}>
                    <span className="font-mono tabular-nums">{formatCurrency(inv.amount)}</span>{" — "}<span className="font-mono tabular-nums">{new Date(inv.investmentDate).toLocaleDateString("en-UG")}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              type="hidden"
              {...register("investmentId", { required: "Please select an investment" })}
            />
            {errors.investmentId && (
              <p className="text-sm text-destructive">{errors.investmentId.message}</p>
            )}
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
