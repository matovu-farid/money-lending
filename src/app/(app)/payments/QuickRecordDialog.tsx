"use client"

import { useState, useTransition } from "react"
import { format } from "date-fns"
import { useForm } from "react-hook-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import Link from "next/link"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import {
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { MoneyInput } from "@/components/ui/money-input"
import { LoanSearchCombobox } from "./LoanSearchCombobox"
import { getRecentlyCollectedLoansAction, recordPaymentAction } from "@/actions/payment.actions"
import { queryKeys } from "@/hooks/query-keys"
import { formatNumberWithCommas } from "@/lib/utils"
import type { ActiveLoanSearchResult } from "@/types"

interface QuickRecordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface QuickRecordFormValues {
  amount: string
  paymentDate: string
}

export function QuickRecordDialog({ open, onOpenChange }: QuickRecordDialogProps) {
  const queryClient = useQueryClient()
  const [selectedLoan, setSelectedLoan] = useState<ActiveLoanSearchResult | null>(null)
  const [successPaymentId, setSuccessPaymentId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const {
    register,
    handleSubmit,
    watch,
    reset,
    control,
    formState: { errors },
  } = useForm<QuickRecordFormValues>({
    defaultValues: {
      amount: "",
      paymentDate: format(new Date(), "yyyy-MM-dd"),
    },
  })

  const amount = watch("amount")

  const { data: recentLoans = [] } = useQuery({
    queryKey: queryKeys.recentLoans.list(),
    queryFn: async () => {
      const r = await getRecentlyCollectedLoansAction()
      return "error" in r ? [] : r.data
    },
    staleTime: 0,
    enabled: open,
  })

  function resetForm() {
    setSelectedLoan(null)
    reset({
      amount: "",
      paymentDate: format(new Date(), "yyyy-MM-dd"),
    })
    setSuccessPaymentId(null)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetForm()
    }
    onOpenChange(nextOpen)
  }

  function handleChipClick(loan: { loanId: string; customerName: string }) {
    const activeLoan: ActiveLoanSearchResult = {
      loanId: loan.loanId,
      customerId: "",
      customerName: loan.customerName,
      principalAmount: "0",
    }
    setSelectedLoan(activeLoan)
  }

  function onSubmit(data: QuickRecordFormValues) {
    if (!selectedLoan) return

    startTransition(async () => {
      const result = await recordPaymentAction({
        loanId: selectedLoan.loanId,
        amount: data.amount,
        paymentDate: new Date(data.paymentDate + "T12:00:00").toISOString(),
      })

      if ("error" in result) {
        toast.error(
          result.error === "Loan not found"
            ? "Loan not found. It may have been deleted."
            : "Failed to record payment. Please try again."
        )
        return
      }

      setSuccessPaymentId(result.data.id)
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.recentLoans.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dailyCollections.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.loansDueToday.all })
    })
  }

  const isSubmitDisabled = !selectedLoan || isPending

  return (
    <DrawerDialog open={open} onOpenChange={handleOpenChange}>
      <DrawerDialogContent className="sm:max-w-[480px]">
        {successPaymentId ? (
          <>
            <DialogHeader>
              <DialogTitle>Payment Recorded</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-sm">
                Payment of <span className="font-mono tabular-nums">UGX {formatNumberWithCommas(amount)}</span> recorded for {selectedLoan?.customerName}.
              </p>
              <Link
                href={`/receipts/repayment/${successPaymentId}`}
                target="_blank"
                className="text-sm underline-offset-4 hover:underline"
              >
                View receipt
              </Link>
            </div>
            <DialogFooter>
              <Button variant="default" onClick={resetForm}>
                Record another
              </Button>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Record Payment</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)}>
              <div className="space-y-4 py-2">
                {/* Recently-collected chips */}
                {recentLoans.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">Recent</p>
                    <div className="flex flex-wrap gap-2">
                      {recentLoans.map((loan) => (
                        <Button
                          key={loan.loanId}
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => handleChipClick(loan)}
                        >
                          {loan.customerName}&nbsp;·&nbsp;LOAN-{loan.loanId.slice(0, 8).toUpperCase()}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Loan search */}
                <div className="space-y-1.5">
                  <Label>Loan</Label>
                  <LoanSearchCombobox
                    selectedLoan={selectedLoan}
                    onSelect={setSelectedLoan}
                    onClear={() => setSelectedLoan(null)}
                  />
                </div>

                {/* Amount */}
                <MoneyInput
                  name="amount"
                  control={control}
                  label="Amount (UGX)"
                  required="Amount is required"
                  disabled={!selectedLoan}
                  id="quick-record-amount"
                />

                {/* Payment date */}
                <div className="space-y-1.5">
                  <Label htmlFor="quick-record-date">Payment Date</Label>
                  <Input
                    id="quick-record-date"
                    type="date"
                    {...register("paymentDate", { required: "Payment date is required" })}
                  />
                  {errors.paymentDate && (
                    <p className="text-sm text-destructive">{errors.paymentDate.message}</p>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                  Close
                </Button>
                <Button
                  type="submit"
                  variant="default"
                  disabled={isSubmitDisabled}
                >
                  {isPending ? (
                    <Spinner>Recording...</Spinner>
                  ) : (
                    "Record Payment"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DrawerDialogContent>
    </DrawerDialog>
  )
}
