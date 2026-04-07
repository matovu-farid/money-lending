"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { useForm, Controller } from "react-hook-form"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { recordPaymentAction } from "@/actions/payment.actions"
import { useSession } from "@/lib/auth-client"
import { generateReceiptNumber } from "@/lib/receipt-number"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MoneyInput } from "@/components/ui/money-input"
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
import { cn, formatCurrency, formatDate, formatNumberWithCommas } from "@/lib/utils"
import { PosReceiptModal } from "@/components/receipts/pos-receipt-modal"
import { PosReceiptRepayment } from "@/components/receipts/pos-receipt-repayment"
import type { Payment } from "@/types"

interface BalanceData {
  outstandingPrincipal: string
  accruedInterest: string
  totalBalance: string
}

interface RecordPaymentFormProps {
  loanId: string
  customerName: string
  loanReference: string
  balanceData: BalanceData
}

function todayISODate(): string {
  return new Date().toISOString().split("T")[0]
}

interface PaymentFormValues {
  paymentDate: string
  amount: string
  depositLocation: "cash" | "bank" | "strong_room"
  note: string
}

interface ReceiptPaymentData extends Payment {
  depositLocationValue: string
}

const AMOUNT_PRESETS = [
  { label: "50K", value: "50000" },
  { label: "100K", value: "100000" },
  { label: "200K", value: "200000" },
  { label: "500K", value: "500000" },
  { label: "1M", value: "1000000" },
  { label: "2M", value: "2000000" },
]

const DEPOSIT_LABELS: Record<string, string> = {
  cash: "Cash",
  bank: "Bank",
  strong_room: "Strong Room",
}

export function RecordPaymentForm({ loanId, customerName, loanReference, balanceData }: RecordPaymentFormProps) {
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
    setValue,
    watch,
    formState: { errors },
  } = useForm<PaymentFormValues>({
    defaultValues: {
      paymentDate: todayISODate(),
      amount: "",
      depositLocation: "cash",
      note: "",
    },
  })

  const currentAmount = watch("amount")

  function handlePresetClick(value: string) {
    setValue("amount", value, { shouldValidate: true })
  }

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
        <Link
          href={`/loans/${loanId}`}
          className={cn(buttonVariants({ variant: "outline" }), "mb-4 inline-flex")}
        >
          Back to Loan
        </Link>
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
          <div className="border-t my-2" />
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-muted-foreground">Outstanding Principal</span>
            <span className="font-mono tabular-nums text-sm">{formatCurrency(balanceData.outstandingPrincipal)}</span>
          </div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-muted-foreground">Accrued Interest</span>
            <span className="font-mono tabular-nums text-sm">{formatCurrency(balanceData.accruedInterest)}</span>
          </div>
          <div className="border-t my-2" />
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Total Balance Owed</span>
            <span className="font-mono tabular-nums font-bold text-lg">{formatCurrency(balanceData.totalBalance)}</span>
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
            />

            {/* Quick amount presets */}
            <div className="flex flex-wrap gap-2">
              {AMOUNT_PRESETS.map((preset) => (
                <Button
                  key={preset.value}
                  type="button"
                  variant={currentAmount === preset.value ? "default" : "outline"}
                  size="sm"
                  className="rounded-full text-xs px-3 h-7"
                  disabled={isPending}
                  onClick={() => handlePresetClick(preset.value)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>

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
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="bank">Bank</SelectItem>
                      <SelectItem value="strong_room">Strong Room</SelectItem>
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
              <div className="rounded-lg border p-4 space-y-2 text-sm">
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
                  <span>{DEPOSIT_LABELS[pendingData.depositLocation] ?? pendingData.depositLocation}</span>
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
              </div>
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
          router.push(`/loans/${loanId}`)
        }}
        title="Payment Receipt"
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
            interestPortion={receiptData.payment.interestPortion}
            principalPortion={receiptData.payment.principalPortion}
            balanceAfter={receiptData.payment.principalBalanceAfter}
            depositLocation={receiptData.payment.depositLocationValue}
            officerName={session?.user?.name ?? "Officer"}
          />
        )}
      </PosReceiptModal>
    </div>
  )
}
