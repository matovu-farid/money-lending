"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { useForm, Controller } from "react-hook-form"
import { ArrowLeft } from "lucide-react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { recordPaymentAction, getPaymentsByLoanAction, getLoanBalanceAction } from "@/actions/payment.actions"
import { useSession } from "@/lib/auth-client"
import { generateReceiptNumber } from "@/lib/receipt-number"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MoneyInput } from "@/components/ui/money-input"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { queryKeys } from "@/hooks/query-keys"
import { InfoPopover } from "@/components/ui/info-popover"
import { formatCurrency, formatDate, formatNumberWithCommas, todayDateString } from "@/lib/utils"
import { PosReceiptModal } from "@/components/receipts/pos-receipt-modal"
import { PosReceiptRepayment } from "@/components/receipts/pos-receipt-repayment"
import type { ReceiptPaymentData, DepositLocation } from "@/types"
import { DEPOSIT_LOCATION_SHORT_LABELS, AMOUNT_PRESETS, DEPOSIT_LOCATION_OPTIONS } from "@/lib/constants"

interface BalanceData {
  outstandingPrincipal: string
  accruedInterest: string
  totalBalance: string
}

interface RecordPaymentFormProps {
  loanId: string
  customerName: string
  loanReference: string
  balanceData: BalanceData | null
  balanceLoading?: boolean
}


interface PaymentFormValues {
  paymentDate: string
  amount: string
  depositLocation: DepositLocation
  note: string
}

function BalanceSkeleton() {
  return <span className="inline-block h-4 w-24 rounded bg-muted-foreground/10 animate-pulse align-middle" />
}

export function RecordPaymentForm({ loanId, customerName, loanReference, balanceData, balanceLoading }: RecordPaymentFormProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const [isPending, startTransition] = useTransition()
  const [receiptData, setReceiptData] = useState<{ payment: ReceiptPaymentData; receiptNumber: string } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingData, setPendingData] = useState<PaymentFormValues | null>(null)

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<PaymentFormValues>({
    defaultValues: {
      paymentDate: todayDateString(),
      amount: "",
      depositLocation: "cash",
      note: "",
    },
  })

  function onFormSubmit(data: PaymentFormValues) {
    // Show confirmation dialog instead of submitting directly
    setPendingData(data)
    setConfirmOpen(true)
  }

  function handleConfirmedSubmit() {
    if (!pendingData) return
    setConfirmOpen(false)

    startTransition(async () => {
      const result = await recordPaymentAction({
        loanId,
        paymentDate: pendingData.paymentDate + "T12:00:00",
        amount: pendingData.amount.trim(),
        depositLocation: pendingData.depositLocation,
        note: pendingData.note.trim() || undefined,
      })

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      toast.success("Payment recorded successfully")
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.payments.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.loans.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
      ])

      setReceiptData({
        payment: { ...result.data, depositLocationValue: pendingData.depositLocation },
        receiptNumber: generateReceiptNumber(),
      })
      setPendingData(null)
    })
  }

  return (
    <div className="p-4 md:p-6 max-w-xl">
      <div className="mb-4">
        <Button
          variant="outline"
          className="mb-4"
          onClick={() => router.back()}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      <h1 className="text-2xl font-semibold mb-6">Record Payment</h1>

      {/* Loan Balance Summary */}
      <Card className="mb-4">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Customer</span>
            <span className="font-medium">{customerName}</span>
          </div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Loan Ref</span>
            <span className="font-mono text-sm">{loanReference}</span>
          </div>
          <Separator className="my-2" />
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-muted-foreground">Outstanding Principal</span>
            {balanceLoading || !balanceData ? <BalanceSkeleton /> : (
              <span className="font-mono tabular-nums text-sm">{formatCurrency(balanceData.outstandingPrincipal)}</span>
            )}
          </div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-muted-foreground">Accrued Interest</span>
            {balanceLoading || !balanceData ? <BalanceSkeleton /> : (
              <span className="font-mono tabular-nums text-sm">{formatCurrency(balanceData.accruedInterest)}</span>
            )}
          </div>
          <Separator className="my-2" />
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Total Balance Owed</span>
            {balanceLoading || !balanceData ? (
              <span className="inline-block h-6 w-32 rounded bg-muted-foreground/10 animate-pulse align-middle" />
            ) : (
              <span className="font-mono tabular-nums font-bold text-lg">{formatCurrency(balanceData.totalBalance)}</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-1">
            Payment Details
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">How Payments Are Allocated</p>
              <p className="text-xs text-muted-foreground mb-2">
                Every payment is split automatically: interest is paid first, then any remainder reduces the principal balance.
              </p>
              <p className="text-xs font-mono bg-muted rounded px-2 py-1 mb-2">
                Payment → Interest portion + Principal portion
              </p>
              <p className="text-xs text-muted-foreground mb-2">
                A minimum of 30 days interest is always charged, even if paying early. Any amount is accepted — there is no minimum payment.
              </p>
              <div className="bg-muted/50 rounded-md p-2 text-xs space-y-1">
                <p className="font-medium">Example:</p>
                <p>Balance: UGX 1,000,000 at 10%/month</p>
                <p>After 30 days interest = UGX 100,000</p>
                <p>Pay UGX 150,000 → UGX 100,000 interest + UGX 50,000 principal</p>
              </div>
            </InfoPopover>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="paymentDate">Payment Date</Label>
              <Input
                id="paymentDate"
                type="date"
                disabled={isPending}
                {...register("paymentDate", { required: "Payment date is required" })}
              />
              {errors.paymentDate && (
                <p className="text-sm text-destructive">{errors.paymentDate.message}</p>
              )}
            </div>

            <MoneyInput
              name="amount"
              control={control}
              label="Amount (UGX)"
              required="Amount must be a valid number (e.g. 150000 or 150000.50)"
              disabled={isPending}
              id="amount"
              presets={AMOUNT_PRESETS}
            />

            <div className="space-y-1">
              <Label htmlFor="depositLocation">Deposit Location</Label>
              <Controller
                name="depositLocation"
                control={control}
                rules={{ required: "Deposit location is required" }}
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isPending}
                  >
                    <SelectTrigger id="depositLocation">
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                    <SelectContent>
                      {DEPOSIT_LOCATION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.depositLocation && (
                <p className="text-sm text-destructive">{errors.depositLocation.message}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="note">Note</Label>
              <Textarea
                id="note"
                placeholder="Optional note"
                disabled={isPending}
                maxLength={2500}
                {...register("note")}
              />
            </div>

            <div className="pt-2">
              <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
                {isPending ? (
                  <>
                    <Loader2 className="animate-spin mr-2 h-4 w-4" />
                    Recording...
                  </>
                ) : (
                  "Record Payment"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <DrawerDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DrawerDialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Payment</DialogTitle>
            <DialogDescription>
              Please review the payment details below before submitting.
            </DialogDescription>
          </DialogHeader>
          {pendingData && (
            <div className="space-y-3 py-2">
              <Card>
                <CardContent className="p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Customer</span>
                    <span className="font-medium">{customerName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Loan Reference</span>
                    <span className="font-mono">{loanReference}</span>
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
                  {pendingData.note.trim() && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Note</span>
                      <span className="text-right max-w-[60%]">{pendingData.note.trim()}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmedSubmit} disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  Recording...
                </>
              ) : (
                "Confirm & Record"
              )}
            </Button>
          </DialogFooter>
        </DrawerDialogContent>
      </DrawerDialog>

      {/* POS Receipt Modal */}
      <PosReceiptModal
        open={receiptData !== null}
        onClose={() => {
          setReceiptData(null)
          // Invalidate stale data so loan detail page loads with fresh data
          queryClient.invalidateQueries({ queryKey: queryKeys.payments.byLoan(loanId) })
          queryClient.invalidateQueries({ queryKey: queryKeys.loans.balance(loanId) })
          queryClient.invalidateQueries({ queryKey: queryKeys.payments.portions(loanId) })
          queryClient.prefetchQuery({
            queryKey: queryKeys.payments.byLoan(loanId),
            queryFn: () => getPaymentsByLoanAction(loanId),
          })
          queryClient.prefetchQuery({
            queryKey: queryKeys.loans.balance(loanId),
            queryFn: () => getLoanBalanceAction(loanId),
          })
          router.prefetch(`/loans/${loanId}`)
          router.push(`/loans/${loanId}`)
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
            customerName={customerName}
            loanReference={loanReference}
            amountPaid={receiptData.payment.amount}
            interestPortion={receiptData.payment.allocation?.interestPortion ?? "0"}
            principalPortion={receiptData.payment.allocation?.principalPortion ?? "0"}
            balanceAfter={receiptData.payment.allocation?.principalBalanceAfter ?? "0"}
            outstandingBalance={receiptData.payment.allocation?.principalBalanceBefore}
            depositLocation={receiptData.payment.depositLocationValue}
            officerName={session?.user?.name ?? "Officer"}
          />
        )}
      </PosReceiptModal>
    </div>
  )
}
