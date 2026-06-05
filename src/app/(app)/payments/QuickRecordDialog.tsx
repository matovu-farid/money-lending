"use client"

import { useState, useTransition, useMemo } from "react"
import { format } from "date-fns"
import { useForm, Controller } from "react-hook-form"
import { useLiveQuery, eq } from "@tanstack/react-db"
import { useLoansWithBalances } from "@/collections/loan-views"
import { loanBalanceCollection } from "@/collections/loan-balances"
import { insertPaymentWithInput, type PaymentRow } from "@/collections/payments"
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
import { DatePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { MoneyInput } from "@/components/ui/money-input"
import { CurrencyCell } from "@/components/ui/currency-cell"
import { PosReceiptModal } from "@/components/receipts/pos-receipt-modal"
import { PosReceiptRepayment } from "@/components/receipts/pos-receipt-repayment"
import { generateReceiptNumber } from "@/lib/receipt-number"
import { useSession } from "@/lib/auth-client"
import { DepositLocationSelect } from "@/components/ui/deposit-location-select"
import { LoanSearchCombobox } from "./LoanSearchCombobox"
import { generateClientId } from "@/lib/client-id"
import type { RecordPaymentInput, ReceiptPaymentData } from "@/types"
import { formatDate, shortId } from "@/lib/utils"
import type { ActiveLoanSearchResult, DepositLocation } from "@/types"
import { DEPOSIT_LOCATION_SHORT_LABELS, AMOUNT_PRESETS } from "@/lib/constants"
import { computeReceiptAllocation } from "@/lib/receipt-allocation"

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
  const [receiptData, setReceiptData] = useState<{ payment: ReceiptPaymentData; receiptNumber: string; totalBalanceBefore?: string } | null>(null)
  const [isPending] = useTransition()
  const [confirmStep, setConfirmStep] = useState(false)
  const [pendingData, setPendingData] = useState<QuickRecordFormValues | null>(null)

  const {
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

  // Get active loans from projection hook (includes customerName + lastPaymentDate)
  const { data: allActiveLoans = [] } = useLoansWithBalances()
  const recentLoans = useMemo(
    () => allActiveLoans
      .filter((l) => l.status === "active" && l.lastPaymentDate)
      .sort((a, b) => new Date(b.lastPaymentDate!).getTime() - new Date(a.lastPaymentDate!).getTime())
      .slice(0, 5)
      .map((l) => ({ loanId: l.id, customerName: l.customerName ?? "Unknown", paymentDate: new Date(l.lastPaymentDate!) })),
    [allActiveLoans]
  )

  // Fetch balance for selected loan from the Electric-synced loan_balances projection.
  const selectedLoanId = selectedLoan?.loanId ?? ""
  const { data: balanceRows } = useLiveQuery(
    (q) => q.from({ b: loanBalanceCollection }).where(({ b }) => eq(b.loanId, selectedLoanId)),
    [selectedLoanId]
  )
  const balanceRow = balanceRows?.[0] ?? null
  // Map Electric field names to the shape this component displays.
  const balanceData = balanceRow
    ? {
        outstandingPrincipal: balanceRow.outstandingBalance,
        accruedInterest: balanceRow.unpaidInterest,
        totalBalance: String(
          parseFloat(balanceRow.outstandingBalance) + parseFloat(balanceRow.unpaidInterest)
        ),
      }
    : null

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

  async function handleConfirmedSubmit() {
    if (!selectedLoan || !pendingData) return
    setConfirmStep(false)

    const id = generateClientId()
    const now = new Date()

    const optimistic: PaymentRow = {
      id,
      loanId: selectedLoan.loanId,
      paymentDate: new Date(pendingData.paymentDate + "T12:00:00"),
      amount: pendingData.amount,
      recordedBy: session?.user?.id ?? "",
      depositLocation: pendingData.depositLocation,
      subLocationId: pendingData.depositLocation === "bank" ? pendingData.subLocationId || null : null,
      editReason: null,
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
      markedWrong: false,
      markedWrongReason: null,
      markedWrongBy: null,
      createdAt: now,
      updatedAt: now,
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
    const allocation = computeReceiptAllocation(pendingData.amount, balanceData)
    const totalBalanceBefore = balanceData?.totalBalance

    const tx = insertPaymentWithInput(id, optimistic, input)
    try {
      await tx.isPersisted.promise
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to record payment"
      toast.error(message)
      return
    }
    toast.success("Payment recorded successfully")

    setReceiptData({
      payment: {
        ...optimistic,
        depositLocationValue: pendingData.depositLocation,
        allocation,
      } as unknown as ReceiptPaymentData,
      receiptNumber: generateReceiptNumber(),
      totalBalanceBefore,
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
                    <CurrencyCell amount={pendingData.amount} className="font-semibold" />
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
                      <CurrencyCell amount={balanceData.outstandingPrincipal} />
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Accrued Interest</span>
                      <CurrencyCell amount={balanceData.accruedInterest} />
                    </div>
                    <Separator className="my-1" />
                    <div className="flex justify-between font-semibold">
                      <span>Total Owed</span>
                      <CurrencyCell amount={balanceData.totalBalance} />
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
                  <Controller
                    name="paymentDate"
                    control={control}
                    rules={{ required: "Payment date is required" }}
                    render={({ field }) => (
                      <DatePicker
                        id="quick-record-date"
                        value={field.value}
                        onChange={field.onChange}
                      />
                    )}
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
          outstandingBalance={receiptData.totalBalanceBefore}
          depositLocation={receiptData.payment.depositLocationValue}
          officerName={session?.user?.name ?? "Officer"}
        />
      )}
    </PosReceiptModal>
    </>
  )
}
