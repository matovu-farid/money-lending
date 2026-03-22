"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { recordPaymentAction } from "@/actions/payment.actions"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface RecordPaymentFormProps {
  loanId: string
}

function todayISODate(): string {
  return new Date().toISOString().split("T")[0]
}

export function RecordPaymentForm({ loanId }: RecordPaymentFormProps) {
  const router = useRouter()

  const [paymentDate, setPaymentDate] = useState(todayISODate())
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [isPending, startTransition] = useTransition()

  const [errors, setErrors] = useState<{ amount?: string; paymentDate?: string }>({})

  function validate(): boolean {
    const nextErrors: { amount?: string; paymentDate?: string } = {}
    if (!paymentDate.trim()) {
      nextErrors.paymentDate = "Payment date is required"
    }
    if (!amount.trim() || !/^\d+(\.\d{1,2})?$/.test(amount.trim())) {
      nextErrors.amount = "Amount must be a valid number (e.g. 150000 or 150000.50)"
    }
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return

    startTransition(async () => {
      const result = await recordPaymentAction({
        loanId,
        paymentDate: paymentDate + "T00:00:00.000Z",
        amount: amount.trim(),
        note: note.trim() || undefined,
      })

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      toast.success("Payment recorded successfully")
      router.push(`/loans/${loanId}`)
    })
  }

  return (
    <div className="p-6 max-w-xl">
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
          <CardTitle>Payment Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Payment Date */}
            <div className="space-y-1">
              <Label htmlFor="paymentDate">Payment Date</Label>
              <Input
                id="paymentDate"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                disabled={isPending}
              />
              {errors.paymentDate && (
                <p className="text-destructive text-xs">{errors.paymentDate}</p>
              )}
            </div>

            {/* Amount */}
            <div className="space-y-1">
              <Label htmlFor="amount">Amount (UGX)</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground font-medium px-2 py-2 bg-muted rounded-lg border border-input select-none">
                  UGX
                </span>
                <Input
                  id="amount"
                  type="text"
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 150000"
                  disabled={isPending}
                  className="flex-1"
                />
              </div>
              {errors.amount && (
                <p className="text-destructive text-xs">{errors.amount}</p>
              )}
            </div>

            {/* Note (optional) */}
            <div className="space-y-1">
              <Label htmlFor="note">Note</Label>
              <Textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note"
                disabled={isPending}
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
