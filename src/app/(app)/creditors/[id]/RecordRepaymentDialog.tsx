"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { recordCreditorRepaymentAction } from "@/app/(app)/creditors/actions"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { CreditorInvestment } from "@/types"

function formatUGX(amount: string | null | undefined): string {
  if (!amount) return "UGX 0"
  const num = parseFloat(amount)
  if (isNaN(num)) return "UGX 0"
  return `UGX ${new Intl.NumberFormat("en-UG", { style: "decimal", maximumFractionDigits: 0 }).format(num)}`
}

interface Props {
  creditorId: string
  investments: CreditorInvestment[]
  outstandingBalance: string
}

export function RecordRepaymentDialog({ creditorId, investments, outstandingBalance }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [investmentId, setInvestmentId] = useState("")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0])
  const [errors, setErrors] = useState<Record<string, string>>({})

  function resetForm() {
    setInvestmentId("")
    setAmount("")
    setDate(new Date().toISOString().split("T")[0])
    setErrors({})
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const newErrors: Record<string, string> = {}
    if (!investmentId) newErrors.investmentId = "Please select an investment"
    if (!amount.trim() || isNaN(Number(amount)) || Number(amount) <= 0) {
      newErrors.amount = "Valid amount is required"
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setErrors({})

    startTransition(async () => {
      try {
        await recordCreditorRepaymentAction({
          investmentId,
          amount: amount.trim(),
          repaymentDate: date,
        })

        toast.success("Repayment recorded successfully")
        setOpen(false)
        resetForm()
        router.refresh()
      } catch (err: any) {
        toast.error(err?.message ?? "Failed to record repayment")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen)
      if (!isOpen) resetForm()
    }}>
      <DialogTrigger render={<Button variant="default" />}>
        Record Repayment
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Repayment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Outstanding balance reference */}
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Outstanding Balance: </span>
            <span className="font-medium">{formatUGX(outstandingBalance)}</span>
          </div>

          <div className="space-y-1">
            <Label htmlFor="repay-investment">Investment</Label>
            <Select
              value={investmentId}
              onValueChange={(value) => setInvestmentId(value ?? "")}
            >
              <SelectTrigger id="repay-investment" className="w-full">
                <SelectValue placeholder="Select investment" />
              </SelectTrigger>
              <SelectContent>
                {investments.map((inv) => (
                  <SelectItem key={inv.id} value={inv.id}>
                    {formatUGX(inv.amount)} — {new Date(inv.investmentDate).toLocaleDateString("en-UG")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.investmentId && (
              <p className="text-destructive text-xs">{errors.investmentId}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="repay-amount">Amount</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-medium w-10 shrink-0">UGX</span>
              <Input
                id="repay-amount"
                type="number"
                min="1"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 500000"
                disabled={isPending}
                className="flex-1"
              />
            </div>
            {errors.amount && (
              <p className="text-destructive text-xs">{errors.amount}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="repay-date">Date</Label>
            <Input
              id="repay-date"
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
                  Recording...
                </>
              ) : (
                "Record Repayment"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
