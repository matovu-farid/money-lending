"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { addInvestmentAction } from "@/app/(app)/creditors/actions"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatNumberWithCommas, stripCommas } from "@/lib/utils"

interface Props {
  creditorId: string
}

export function AddInvestmentDialog({ creditorId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [amount, setAmount] = useState("")
  const [interestRate, setInterestRate] = useState("10")
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0])
  const [errors, setErrors] = useState<Record<string, string>>({})

  function resetForm() {
    setAmount("")
    setInterestRate("10")
    setDate(new Date().toISOString().split("T")[0])
    setErrors({})
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const newErrors: Record<string, string> = {}
    if (!amount.trim() || isNaN(Number(amount)) || Number(amount) <= 0) {
      newErrors.amount = "Valid amount is required"
    }
    if (!interestRate.trim() || isNaN(Number(interestRate))) {
      newErrors.interestRate = "Valid interest rate is required"
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setErrors({})

    startTransition(async () => {
      try {
        await addInvestmentAction({
          creditorId,
          amount: amount.trim(),
          interestRateMonthly: (Number(interestRate) / 100).toString(),
          investmentDate: date,
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
    <Dialog open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen)
      if (!isOpen) resetForm()
    }}>
      <DialogTrigger render={<Button variant="outline" />}>
        Add Investment
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Investment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="inv-amount">Amount</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-medium w-10 shrink-0">UGX</span>
              <Input
                id="inv-amount"
                type="text"
                inputMode="numeric"
                value={formatNumberWithCommas(amount)}
                onChange={(e) => setAmount(stripCommas(e.target.value).replace(/[^0-9.]/g, ""))}
                placeholder="e.g. 5,000,000"
                disabled={isPending}
                className="flex-1"
              />
            </div>
            {errors.amount && (
              <p className="text-destructive text-xs">{errors.amount}</p>
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
                value={interestRate}
                onChange={(e) => setInterestRate(e.target.value)}
                disabled={isPending}
                className="flex-1"
              />
              <span className="text-sm text-muted-foreground font-medium w-6 shrink-0">%</span>
            </div>
            {errors.interestRate && (
              <p className="text-destructive text-xs">{errors.interestRate}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="inv-date">Date</Label>
            <Input
              id="inv-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={isPending}
            />
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
      </DialogContent>
    </Dialog>
  )
}
