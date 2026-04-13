"use client"

import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import {
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export interface EditLoanDialogProps {
  open: boolean
  principal: string
  interestRate: string
  startDate: string
  reason: string
  isPending: boolean
  onPrincipalChange: (value: string) => void
  onInterestRateChange: (value: string) => void
  onStartDateChange: (value: string) => void
  onReasonChange: (value: string) => void
  onSubmit: () => void
  onClose: () => void
}

export function EditLoanDialog({
  open,
  principal,
  interestRate,
  startDate,
  reason,
  isPending,
  onPrincipalChange,
  onInterestRateChange,
  onStartDateChange,
  onReasonChange,
  onSubmit,
  onClose,
}: EditLoanDialogProps) {
  return (
    <DrawerDialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DrawerDialogContent>
        <DialogHeader>
          <DialogTitle>Edit Loan</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="loanPrincipal">Principal Amount (UGX)</Label>
            <Input
              id="loanPrincipal"
              type="text"
              value={principal}
              onChange={(e) => onPrincipalChange(e.target.value)}
              disabled={isPending}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="loanInterestRate">Interest Rate (% per month)</Label>
            <Input
              id="loanInterestRate"
              type="number"
              min="0"
              step="0.1"
              value={interestRate}
              onChange={(e) => onInterestRateChange(e.target.value)}
              disabled={isPending}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="loanStartDate">Start Date</Label>
            <Input
              id="loanStartDate"
              type="date"
              value={startDate}
              onChange={(e) => onStartDateChange(e.target.value)}
              disabled={isPending}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="loanEditReason">Reason for edit</Label>
            <Textarea
              id="loanEditReason"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="Explain what is being corrected and why"
              disabled={isPending}
              maxLength={2500}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isPending}
          >
            Discard Changes
          </Button>
          <Button
            onClick={onSubmit}
            disabled={isPending || !reason.trim()}
          >
            {isPending ? (
              <>
                <Loader2 className="animate-spin mr-2 h-4 w-4" />
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </DialogFooter>
      </DrawerDialogContent>
    </DrawerDialog>
  )
}
