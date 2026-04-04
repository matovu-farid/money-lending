"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { useForm, Controller } from "react-hook-form"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { recordPaymentAction } from "@/actions/payment.actions"
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
import { queryKeys } from "@/hooks/query-keys"
import { InfoPopover } from "@/components/ui/info-popover"
import { cn } from "@/lib/utils"

interface RecordPaymentFormProps {
  loanId: string
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

export function RecordPaymentForm({ loanId }: RecordPaymentFormProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<PaymentFormValues>({
    defaultValues: {
      paymentDate: todayISODate(),
      amount: "",
      depositLocation: "cash",
      note: "",
    },
  })

  function onSubmit(data: PaymentFormValues) {
    startTransition(async () => {
      const result = await recordPaymentAction({
        loanId,
        paymentDate: data.paymentDate + "T12:00:00",
        amount: data.amount.trim(),
        depositLocation: data.depositLocation,
        note: data.note.trim() || undefined,
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
      router.push(`/loans/${loanId}`)
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
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
    </div>
  )
}
