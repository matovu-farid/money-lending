"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { addInvestmentAction } from "@/app/(app)/creditors/actions"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import {
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatNumberWithCommas, stripCommas } from "@/lib/utils"

interface Props {
  creditorId: string
}

interface InvestmentFormValues {
  amount: string
  interestRate: string
  date: string
}

export function AddInvestmentDialog({ creditorId }: Props) {
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
  } = useForm<InvestmentFormValues>({
    defaultValues: {
      amount: "",
      interestRate: "10",
      date: new Date().toISOString().split("T")[0],
    },
  })

  const watchedAmount = watch("amount")

  function resetForm() {
    reset({
      amount: "",
      interestRate: "10",
      date: new Date().toISOString().split("T")[0],
    })
  }

  function onSubmit(data: InvestmentFormValues) {
    startTransition(async () => {
      try {
        await addInvestmentAction({
          creditorId,
          amount: data.amount.trim(),
          interestRateMonthly: (Number(data.interestRate) / 100).toString(),
          investmentDate: data.date,
        })

        toast.success("Investment added successfully")
        setOpen(false)
        resetForm()
        router.refresh()
      } catch (err: any) {
        toast.error(err?.message ?? "Failed to add investment")
      }
    })
  }

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
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="inv-amount">Amount</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-medium w-10 shrink-0">UGX</span>
              <Input
                id="inv-amount"
                type="text"
                inputMode="numeric"
                value={formatNumberWithCommas(watchedAmount)}
                onChange={(e) => {
                  const raw = stripCommas(e.target.value).replace(/[^0-9.]/g, "")
                  setValue("amount", raw, { shouldValidate: true })
                }}
                placeholder="e.g. 5,000,000"
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
            <Label htmlFor="inv-rate">Monthly Interest Rate</Label>
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
              <p className="text-destructive text-xs">{errors.interestRate.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="inv-date">Date</Label>
            <Input
              id="inv-date"
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
                  Adding...
                </>
              ) : (
                "Add Investment"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DrawerDialogContent>
      </DrawerDialog>
    </>
  )
}
