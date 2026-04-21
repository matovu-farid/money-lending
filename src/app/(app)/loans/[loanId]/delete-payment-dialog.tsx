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

export interface DeletePaymentDialogProps {
  open: boolean
  reason: string
  isPending: boolean
  onReasonChange: (value: string) => void
  onSubmit: () => void
  onClose: () => void
}

export function DeletePaymentDialog({
  open,
  reason,
  isPending,
  onReasonChange,
  onSubmit,
  onClose,
}: DeletePaymentDialogProps) {
  return (
    <DrawerDialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DrawerDialogContent>
        <DialogHeader>
          <DialogTitle>Delete payment?</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This payment will be marked as deleted. The record is not permanently removed. All
            subsequent balances will be recalculated.
          </p>
          <div className="space-y-1">
            <Label htmlFor="deleteReason">Reason for deletion</Label>
            <Textarea
              id="deleteReason"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="Explain why this payment is being deleted"
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
            Keep Payment
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
              "Delete Payment"
            )}
          </Button>
        </DialogFooter>
      </DrawerDialogContent>
    </DrawerDialog>
  )
}
