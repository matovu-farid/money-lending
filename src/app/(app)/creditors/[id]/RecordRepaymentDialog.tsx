"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { recordCreditorRepaymentAction } from "@/app/(app)/creditors/actions"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import {
  DialogHeader,
  DialogTitle,
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
import { formatNumberWithCommas, stripCommas } from "@/lib/utils"
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
    <>
      <Button variant="default" onClick={() => setOpen(true)}>
        Record Repayment
      </Button>
      <DrawerDialog open={open} onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) resetForm()
      }}>
      <DrawerDialogContent>
        <DialogHeader>
          <DialogTitle>Record Repayment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Outstanding balance reference */}
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Outstanding Balance: </span>
            <span className="font-medium font-mono tabular-nums">{formatUGX(outstandingBalance)}</span>
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
                    <span className="font-mono tabular-nums">{formatUGX(inv.amount)}</span>{" — "}<span className="font-mono tabular-nums">{new Date(inv.investmentDate).toLocaleDateString("en-UG")}</span>
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
                type="text"
                inputMode="numeric"
                value={formatNumberWithCommas(amount)}
                onChange={(e) => setAmount(stripCommas(e.target.value).replace(/[^0-9.]/g, ""))}
                placeholder="e.g. 500,000"
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
      </DrawerDialogContent>
      </DrawerDialog>
    </>
  )
}
