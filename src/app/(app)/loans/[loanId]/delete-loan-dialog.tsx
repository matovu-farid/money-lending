"use client"

import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import {
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export interface DeleteLoanDialogProps {
  open: boolean
  reason: string
  isPending: boolean
  onReasonChange: (value: string) => void
  onSubmit: () => void
  onClose: () => void
}

export function DeleteLoanDialog({
  open,
  reason,
  isPending,
  onReasonChange,
  onSubmit,
  onClose,
}: DeleteLoanDialogProps) {
  return (
    <DrawerDialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DrawerDialogContent>
        <DialogHeader>
          <DialogTitle>Delete loan?</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This will permanently delete the loan and all associated payments. This action cannot be undone.
          </p>
          <div className="space-y-1">
            <Label htmlFor="loanDeleteReason">Reason for deletion</Label>
            <Textarea
              id="loanDeleteReason"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="Explain why this loan is being deleted"
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
            Keep Loan
          </Button>
          <Button
            variant="destructive"
            onClick={onSubmit}
            disabled={isPending || !reason.trim()}
          >
            {isPending ? (
              <>
                <Loader2 className="animate-spin h-4 w-4" />
                Deleting...
              </>
            ) : (
              "Delete Loan"
            )}
          </Button>
        </DialogFooter>
      </DrawerDialogContent>
    </DrawerDialog>
  )
}
