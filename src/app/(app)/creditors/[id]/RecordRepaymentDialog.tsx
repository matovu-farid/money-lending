"use client"

import { useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { recordCreditorRepaymentAction } from "@/actions/creditor.actions"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MoneyInput } from "@/components/ui/money-input"
import { InfoPopover } from "@/components/ui/info-popover"
import { formatCurrency, todayDateString } from "@/lib/utils"
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

  function onSubmit(data: RepaymentFormValues) {
    startTransition(async () => {
      try {
        const result = await recordCreditorRepaymentAction({
          investmentId: data.investmentId,
          amount: data.amount.trim(),
          repaymentDate: data.date,
        })
        if ("error" in result) {
          toast.error(result.error)
          return
        }

        toast.success("Repayment recorded successfully")
        setOpen(false)
        resetForm()
        const qc = getQueryClient()
        qc.invalidateQueries({ queryKey: queryKeys.creditors.all })
        qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
        qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
      } catch (err: any) {
        toast.error(err?.message ?? "Failed to record repayment")
      }
    })
  }

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
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
          />

          <div className="space-y-1">
            <Label htmlFor="repay-date">Date</Label>
            <Input
              id="repay-date"
              type="date"
              disabled={isPending}
              {...register("date", { required: "Date is required" })}
            />
            {errors.date && <p className="text-sm text-destructive">{errors.date.message}</p>}
          </div>

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  Recording...
                </>
              ) : (
                "Record Repayment"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DrawerDialogContent>
      </DrawerDialog>
    </>
  )
}
