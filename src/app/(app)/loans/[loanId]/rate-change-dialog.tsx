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
import { ROLE_LEVELS } from "@/types"
import type { UserRole, Loan } from "@/types"
import { formatRate } from "@/lib/utils"
import { getBaseRate } from "@/lib/interest/effective-rate"

export interface RateChangeDialogProps {
  open: boolean
  loan: Loan
  userRole: UserRole
  newRate: string
  isPending: boolean
  onNewRateChange: (value: string) => void
  onSubmit: () => void
  onClose: () => void
}

export function RateChangeDialog({
  open,
  loan,
  userRole,
  newRate,
  isPending,
  onNewRateChange,
  onSubmit,
  onClose,
}: RateChangeDialogProps) {
  return (
    <DrawerDialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DrawerDialogContent>
        <DialogHeader>
          <DialogTitle>Request Interest Rate Change</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Current rate: {formatRate(getBaseRate(loan), 1)} per month.
            {ROLE_LEVELS[userRole] >= ROLE_LEVELS.supervisor
              ? " As a supervisor or above, rates between 8-10% will be applied immediately."
              : " Your request will be sent for supervisor or admin approval."}
          </p>
          <div className="space-y-1">
            <Label htmlFor="newRate">New Rate (% per month)</Label>
            <Input
              id="newRate"
              type="number"
              min="0.1"
              max="99.9"
              step="0.1"
              value={newRate}
              onChange={(e) => onNewRateChange(e.target.value)}
              disabled={isPending}
              placeholder="e.g. 8.0"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {newRate && parseFloat(newRate) >= 10
                ? "No approval required."
                : newRate && parseFloat(newRate) >= 8 && parseFloat(newRate) < 10
                  ? "Requires supervisor approval (or higher)."
                  : newRate && parseFloat(newRate) > 0 && parseFloat(newRate) < 8
                    ? "Requires admin approval (or higher)."
                    : "Enter the new monthly interest rate."}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={isPending || !newRate.trim() || parseFloat(newRate) <= 0}
          >
            {isPending ? (
              <>
                <Loader2 className="animate-spin mr-2 h-4 w-4" />
                Submitting...
              </>
            ) : (
              "Submit Request"
            )}
          </Button>
        </DialogFooter>
      </DrawerDialogContent>
    </DrawerDialog>
  )
}
