"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatDateTime, formatRate } from "@/lib/utils"
import type { LoanRateChangeHistoryEntry } from "@/types"

interface LoanRateHistoryDialogProps {
  open: boolean
  history: LoanRateChangeHistoryEntry[]
  onClose: () => void
}

export function LoanRateHistoryDialog({
  open,
  history,
  onClose,
}: LoanRateHistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Interest Rate History</DialogTitle>
          <DialogDescription>
            Applied changes to this loan&apos;s monthly interest rate.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {history.map((change) => (
            <div key={change.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono font-semibold">
                  {formatRate(change.fromRate, 1)} → {formatRate(change.toRate, 1)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(change.changedAt)}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Changed by <span className="font-medium text-foreground">{change.actorName ?? "Unknown user"}</span>
              </p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
