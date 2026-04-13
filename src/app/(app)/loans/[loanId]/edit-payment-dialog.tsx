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

export interface EditPaymentDialogProps {
  open: boolean
  amount: string
  date: string
  reason: string
  isPending: boolean
  onAmountChange: (value: string) => void
  onDateChange: (value: string) => void
  onReasonChange: (value: string) => void
  onSubmit: () => void
  onClose: () => void
}

export function EditPaymentDialog({
  open,
  amount,
  date,
  reason,
  isPending,
  onAmountChange,
  onDateChange,
  onReasonChange,
  onSubmit,
  onClose,
}: EditPaymentDialogProps) {
  return (
    <DrawerDialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DrawerDialogContent>
        <DialogHeader>
          <DialogTitle>Edit Payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="editAmount">Amount (UGX)</Label>
            <Input
              id="editAmount"
              type="text"
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              disabled={isPending}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="editDate">Payment Date</Label>
            <Input
              id="editDate"
              type="date"
              value={date}
              onChange={(e) => onDateChange(e.target.value)}
              disabled={isPending}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="editReason">Reason for edit</Label>
            <Textarea
              id="editReason"
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
