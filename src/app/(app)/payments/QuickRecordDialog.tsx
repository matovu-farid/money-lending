"use client"

import { useState, useTransition } from "react"
import { format } from "date-fns"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import Link from "next/link"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { LoanSearchCombobox } from "./LoanSearchCombobox"
import { getRecentlyCollectedLoansAction, recordPaymentAction } from "@/actions/payment.actions"
import { formatNumberWithCommas } from "@/lib/utils"
import type { ActiveLoanSearchResult } from "@/types"

interface QuickRecordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const todayStr = format(new Date(), "yyyy-MM-dd")

export function QuickRecordDialog({ open, onOpenChange }: QuickRecordDialogProps) {
  const queryClient = useQueryClient()
  const [selectedLoan, setSelectedLoan] = useState<ActiveLoanSearchResult | null>(null)
  const [amount, setAmount] = useState("")
  const [paymentDate, setPaymentDate] = useState(todayStr)
  const [successPaymentId, setSuccessPaymentId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const { data: recentLoans = [] } = useQuery({
    queryKey: ["recentLoans"],
    queryFn: async () => {
      const r = await getRecentlyCollectedLoansAction()
      return "error" in r ? [] : r.data
    },
    staleTime: 0,
    enabled: open,
  })

  function resetForm() {
    setSelectedLoan(null)
    setAmount("")
    setPaymentDate(format(new Date(), "yyyy-MM-dd"))
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

  function handleSubmit() {
    if (!selectedLoan || !amount || Number(amount) <= 0) return

    startTransition(async () => {
      const result = await recordPaymentAction({
        loanId: selectedLoan.loanId,
        amount,
        paymentDate: new Date(paymentDate + "T12:00:00").toISOString(),
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
      queryClient.invalidateQueries({ queryKey: ["payments"] })
      queryClient.invalidateQueries({ queryKey: ["recentLoans"] })
      queryClient.invalidateQueries({ queryKey: ["daily-collections"] })
      queryClient.invalidateQueries({ queryKey: ["loans-due-today"] })
    })
  }

  const isSubmitDisabled = !selectedLoan || !amount || Number(amount) <= 0 || isPending

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
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
              <div className="space-y-1.5">
                <Label htmlFor="quick-record-amount">Amount (UGX)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    UGX
                  </span>
                  <Input
                    id="quick-record-amount"
                    type="number"
                    min="1"
                    step="1"
                    className="pl-12"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={!selectedLoan}
                  />
                </div>
              </div>

              {/* Payment date */}
              <div className="space-y-1.5">
                <Label htmlFor="quick-record-date">Payment Date</Label>
                <Input
                  id="quick-record-date"
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
              <Button
                variant="default"
                disabled={isSubmitDisabled}
                onClick={handleSubmit}
              >
                {isPending ? (
                  <Spinner>Recording...</Spinner>
                ) : (
                  "Record Payment"
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
