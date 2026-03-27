"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { recordCreditorRepaymentAction } from "@/app/(app)/creditors/actions"
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
import { formatNumberWithCommas, stripCommas, formatCurrency } from "@/lib/utils"
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
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<RepaymentFormValues>({
    defaultValues: {
      investmentId: "",
      amount: "",
      date: new Date().toISOString().split("T")[0],
    },
  })

  const watchedAmount = watch("amount")
  const watchedInvestmentId = watch("investmentId")

  function resetForm() {
    reset({
      investmentId: "",
      amount: "",
      date: new Date().toISOString().split("T")[0],
    })
  }

  function onSubmit(data: RepaymentFormValues) {
    startTransition(async () => {
      try {
        await recordCreditorRepaymentAction({
          investmentId: data.investmentId,
          amount: data.amount.trim(),
          repaymentDate: data.date,
        })

        toast.success("Repayment recorded successfully")
        setOpen(false)
        resetForm()
        router.refresh()
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
          <DialogTitle>Record Repayment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Outstanding balance reference */}
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Outstanding Balance: </span>
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
              <p className="text-destructive text-xs">{errors.investmentId.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="repay-amount">Amount</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-medium w-10 shrink-0">UGX</span>
              <Input
                id="repay-amount"
                type="text"
                inputMode="numeric"
                value={formatNumberWithCommas(watchedAmount)}
                onChange={(e) => {
                  const raw = stripCommas(e.target.value).replace(/[^0-9.]/g, "")
                  setValue("amount", raw, { shouldValidate: true })
                }}
                placeholder="e.g. 500,000"
                disabled={isPending}
                className="flex-1"
              />
              <input
                type="hidden"
                {...register("amount", {
                  required: "Valid amount is required",
                  validate: v => {
                    const n = Number(v)
                    if (isNaN(n) || n <= 0) return "Valid amount is required"
                    return true
                  },
                })}
              />
            </div>
            {errors.amount && (
              <p className="text-destructive text-xs">{errors.amount.message}</p>
            )}
          </div>

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
