"use client"

import { useState, useTransition, useMemo } from "react"
import { format } from "date-fns"
import { useForm } from "react-hook-form"
import { useLiveSuspenseQuery, useLiveQuery } from "@tanstack/react-db"
import { loanCollection, getLoanBalanceCollection, insertPaymentWithInput } from "@/collections"
import { toast } from "sonner"
import { Card, CardContent } from "@/components/ui/card"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { MoneyInput } from "@/components/ui/money-input"
import { PosReceiptModal } from "@/components/receipts/pos-receipt-modal"
import { PosReceiptRepayment } from "@/components/receipts/pos-receipt-repayment"
import { generateReceiptNumber } from "@/lib/receipt-number"
import { useSession } from "@/lib/auth-client"
import { DepositLocationSelect } from "@/components/ui/deposit-location-select"
import { LoanSearchCombobox } from "./LoanSearchCombobox"
import { generateClientId } from "@/lib/client-id"
import type { PaymentWithCustomer, RecordPaymentInput, ReceiptPaymentData } from "@/types"
import { formatNumberWithCommas, formatCurrency, formatDate, shortId } from "@/lib/utils"
import type { ActiveLoanSearchResult, DepositLocation } from "@/types"
import { DEPOSIT_LOCATION_SHORT_LABELS, AMOUNT_PRESETS } from "@/lib/constants"
import BigNumber from "bignumber.js"

interface QuickRecordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface QuickRecordFormValues {
  amount: string
  paymentDate: string
  depositLocation: DepositLocation
  subLocationId: string
}

export function QuickRecordDialog({ open, onOpenChange }: QuickRecordDialogProps) {
  const { data: session } = useSession()
  const [selectedLoan, setSelectedLoan] = useState<ActiveLoanSearchResult | null>(null)
  const [receiptData, setReceiptData] = useState<{ payment: ReceiptPaymentData; receiptNumber: string } | null>(null)
  const [isPending] = useTransition()
  const [confirmStep, setConfirmStep] = useState(false)
  const [pendingData, setPendingData] = useState<QuickRecordFormValues | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<QuickRecordFormValues>({
    defaultValues: {
      amount: "",
      paymentDate: format(new Date(), "yyyy-MM-dd"),
      depositLocation: "cash",
      subLocationId: "",
    },
  })

  // Get active loans from collection, sorted by last payment activity
  const { data: allActiveLoans = [] } = useLiveSuspenseQuery(
    (q) => q.from({ l: loanCollection }),
    []
  )
  const recentLoans = useMemo(
    () => allActiveLoans
      .filter((l) => l.status === "active" && l.lastPaymentDate)
      .sort((a, b) => new Date(b.lastPaymentDate!).getTime() - new Date(a.lastPaymentDate!).getTime())
      .slice(0, 5)
      .map((l) => ({ loanId: l.id, customerName: l.customerName ?? "Unknown", paymentDate: new Date(l.lastPaymentDate!) })),
    [allActiveLoans]
  )

  // Fetch balance for selected loan via collection
  const selectedLoanId = selectedLoan?.loanId ?? ""
  const balanceColl = getLoanBalanceCollection(selectedLoanId)
  const { data: balanceRows } = useLiveQuery(
    (q) => q.from({ b: balanceColl }).select(({ b }) => b),
    [selectedLoanId]
  )
  const balanceData = balanceRows?.[0] ?? null

  function resetForm() {
    setSelectedLoan(null)
    reset({
      amount: "",
      paymentDate: format(new Date(), "yyyy-MM-dd"),
      depositLocation: "cash",
      subLocationId: "",
    })
    setReceiptData(null)
    setConfirmStep(false)
    setPendingData(null)
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

  function onFormSubmit(data: QuickRecordFormValues) {
    if (!selectedLoan) return
    setPendingData(data)
    setConfirmStep(true)
  }

  function handleConfirmedSubmit() {
    if (!selectedLoan || !pendingData) return
    setConfirmStep(false)

    const id = generateClientId()
    const now = new Date()

    const optimistic: PaymentWithCustomer = {
      id,
      loanId: selectedLoan.loanId,
      customerId: selectedLoan.customerId,
      customerName: selectedLoan.customerName,
      paymentDate: new Date(pendingData.paymentDate + "T12:00:00"),
      amount: pendingData.amount,
      interestPortion: "0",
      principalPortion: "0",
      principalBalanceAfter: "0",
      outstandingBalance: "0",
      recordedBy: session?.user?.id ?? "",
      recorderName: session?.user?.name ?? "",
      depositLocation: pendingData.depositLocation,
      createdAt: now,
    }

    const input: RecordPaymentInput = {
      id,
      loanId: selectedLoan.loanId,
      paymentDate: pendingData.paymentDate + "T12:00:00",
      amount: pendingData.amount,
      depositLocation: pendingData.depositLocation,
      subLocationId: pendingData.depositLocation === "bank" ? pendingData.subLocationId || undefined : undefined,
    }

    // Compute receipt allocation from available balance data
    const paidAmt = new BigNumber(pendingData.amount)
    const accrued = new BigNumber(balanceData?.accruedInterest ?? "0")
    const totalBefore = new BigNumber(balanceData?.totalBalance ?? "0")
    const interestPaid = BigNumber.min(paidAmt, accrued)
    const principalPaid = paidAmt.minus(interestPaid)
    const balanceAfter = BigNumber.max(totalBefore.minus(paidAmt), new BigNumber(0))

    insertPaymentWithInput(id, optimistic, input)
    toast.success("Payment recorded successfully")

    setReceiptData({
      payment: {
        ...optimistic,
        depositLocationValue: pendingData.depositLocation,
        allocation: {
          interestPortion: interestPaid.toFixed(0),
          principalPortion: principalPaid.toFixed(0),
          principalBalanceAfter: balanceAfter.toFixed(0),
          outstandingBalanceAfter: totalBefore.toFixed(0),
        },
      } as unknown as ReceiptPaymentData,
      receiptNumber: generateReceiptNumber(),
    })
  }

  const isSubmitDisabled = !selectedLoan || isPending

  const loanRef = selectedLoan
    ? `LOAN-${shortId(selectedLoan.loanId).toUpperCase()}`
    : ""

  return (
    <>
    <DrawerDialog open={open && !receiptData} onOpenChange={handleOpenChange}>
      <DrawerDialogContent className="sm:max-w-[480px]">
        {confirmStep && pendingData ? (
          <>
            <DialogHeader>
              <DialogTitle>Confirm Payment</DialogTitle>
              <DialogDescription>
                Please review the payment details below before submitting.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <Card>
                <CardContent className="p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Customer</span>
                    <span className="font-medium">{selectedLoan?.customerName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Loan Reference</span>
                    <span className="font-mono">{loanRef}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-mono tabular-nums font-semibold">
                      UGX {formatNumberWithCommas(pendingData.amount)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Deposit Location</span>
                    <span>{DEPOSIT_LOCATION_SHORT_LABELS[pendingData.depositLocation] ?? pendingData.depositLocation}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Payment Date</span>
                    <span>{formatDate(pendingData.paymentDate)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmStep(false)}>
                Back
              </Button>
              <Button onClick={handleConfirmedSubmit} disabled={isPending}>
                {isPending ? (
                  <Spinner>Recording...</Spinner>
                ) : (
                  "Confirm & Record"
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Record Payment</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(onFormSubmit)}>
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
                          {loan.customerName}&nbsp;·&nbsp;LOAN-{shortId(loan.loanId).toUpperCase()}
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
                    recentLoans={recentLoans}
                  />
                </div>

                {/* Balance summary when loan is selected */}
                {selectedLoan && balanceData && (
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Outstanding Principal</span>
                      <span className="font-mono tabular-nums">{formatCurrency(balanceData.outstandingPrincipal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Accrued Interest</span>
                      <span className="font-mono tabular-nums">{formatCurrency(balanceData.accruedInterest)}</span>
                    </div>
                    <Separator className="my-1" />
                    <div className="flex justify-between font-semibold">
                      <span>Total Owed</span>
                      <span className="font-mono tabular-nums">{formatCurrency(balanceData.totalBalance)}</span>
                    </div>
                  </div>
                )}

                {/* Amount */}
                <MoneyInput
                  name="amount"
                  control={control}
                  label="Amount (UGX)"
                  required="Amount is required"
                  disabled={!selectedLoan}
                  id="quick-record-amount"
                  presets={selectedLoan ? AMOUNT_PRESETS : undefined}
                />

                {/* Deposit location */}
                <DepositLocationSelect
                  name="depositLocation"
                  control={control}
                  label="Deposit Location"
                  disabled={!selectedLoan || isPending}
                  id="quick-record-deposit-location"
                  subLocationName="subLocationId"
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

    <PosReceiptModal
      open={receiptData !== null}
      onClose={() => {
        setReceiptData(null)
        onOpenChange(false)
      }}
      title="Payment Receipt"
      autoActions
    >
      {receiptData && (
        <PosReceiptRepayment
          receiptNumber={receiptData.receiptNumber}
          date={receiptData.payment.paymentDate instanceof Date
            ? receiptData.payment.paymentDate.toISOString()
            : String(receiptData.payment.paymentDate)}
          customerName={selectedLoan?.customerName ?? ""}
          loanReference={loanRef}
          amountPaid={receiptData.payment.amount}
          interestPortion={receiptData.payment.allocation?.interestPortion ?? "0"}
          principalPortion={receiptData.payment.allocation?.principalPortion ?? "0"}
          balanceAfter={receiptData.payment.allocation?.principalBalanceAfter ?? "0"}
          outstandingBalance={receiptData.payment.allocation?.outstandingBalanceAfter}
          depositLocation={receiptData.payment.depositLocationValue}
          officerName={session?.user?.name ?? "Officer"}
        />
      )}
    </PosReceiptModal>
    </>
  )
}
