"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatRate } from "@/lib/utils"

interface AdminRateAdjustmentDialogProps {
  open: boolean
  currentRate: string
  isPending: boolean
  onSubmit: (newRate: string) => void
  onClose: () => void
}

export function AdminRateAdjustmentDialog({
  open,
  currentRate,
  isPending,
  onSubmit,
  onClose,
}: AdminRateAdjustmentDialogProps) {
  const [ratePercent, setRatePercent] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setRatePercent((Number(currentRate) * 100).toFixed(1))
      setError(null)
    }
  }, [open, currentRate])

  function handleSubmit() {
    const percent = Number(ratePercent)
    const currentPercent = Number(currentRate) * 100
    if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
      setError("Rate must be between 0% and 100%.")
      return
    }
    if (Math.abs(percent - currentPercent) < 0.000001) {
      setError("New rate must be different from the current rate.")
      return
    }
    setError(null)
    onSubmit((percent / 100).toFixed(4))
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust Interest Rate</DialogTitle>
          <DialogDescription>
            The current rate is {formatRate(currentRate, 1)} per month. This change applies immediately and is audited.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="admin-new-rate">New Rate (% per month)</Label>
          <Input
            id="admin-new-rate"
            aria-label="New Rate (% per month)"
            type="number"
            min="0.1"
            max="99.9"
            step="0.1"
            value={ratePercent}
            onChange={(event) => {
              setRatePercent(event.target.value)
              setError(null)
            }}
            disabled={isPending}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : "Save Rate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
