"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Loader2, ShieldAlert } from "lucide-react"
import { settleLoanWithCollateral } from "@/collections/loans"
import { formatCurrency } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import { DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

interface SettleCollateralDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  loanId: string
  outstandingPrincipal: string
  accruedInterest: string
  collateralNature: string
  collateralDescription: string | null
}

export function SettleCollateralDialog({
  open,
  onOpenChange,
  loanId,
  outstandingPrincipal,
  accruedInterest,
  collateralNature,
  collateralDescription,
}: SettleCollateralDialogProps) {
  const [reason, setReason] = useState("")
  const isPending = false

  const totalWriteOff = (
    parseFloat(outstandingPrincipal) + parseFloat(accruedInterest)
  ).toFixed(0)

  function handleSubmit() {
    if (!reason.trim()) {
      toast.error("Reason is required")
      return
    }

    settleLoanWithCollateral(loanId, reason.trim())
    toast.success("Loan settled with collateral")
    onOpenChange(false)
    setReason("")
  }

  return (
    <DrawerDialog open={open} onOpenChange={onOpenChange}>
      <DrawerDialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            Settle Loan with Collateral
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            This will seize the collateral and close the loan. The full outstanding balance will be written off.
          </p>

          <Card>
            <CardContent className="p-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Outstanding Principal</span>
                <span className="font-medium">{formatCurrency(outstandingPrincipal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Accrued Interest</span>
                <span className="font-medium">{formatCurrency(accruedInterest)}</span>
              </div>
              <Separator className="my-2" />
              <div className="flex justify-between font-semibold">
                <span>Total Written Off</span>
                <span>{formatCurrency(totalWriteOff)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-3 space-y-1 text-sm">
              <p className="font-medium">Collateral to Seize</p>
              <p className="text-muted-foreground">{collateralNature}</p>
              {collateralDescription && (
                <p className="text-muted-foreground text-xs">{collateralDescription}</p>
              )}
            </CardContent>
          </Card>

          <div className="space-y-2">
            <Label htmlFor="settle-reason">Reason for Settlement</Label>
            <Textarea
              id="settle-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2500}
              placeholder="Why is this loan being settled with collateral?"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={isPending || !reason.trim()}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirm Settlement
          </Button>
        </DialogFooter>
      </DrawerDialogContent>
    </DrawerDialog>
  )
}
