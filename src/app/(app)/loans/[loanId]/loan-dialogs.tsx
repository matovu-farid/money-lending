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
import { ROLE_LEVELS } from "@/types"
import type { UserRole, Loan } from "@/types"
import { formatRate } from "@/lib/utils"

export interface LoanDialogsProps {
  loan: Loan
  userRole: UserRole
  // Edit Payment
  editingPayment: boolean
  editAmount: string
  editDate: string
  editReason: string
  isEditPending: boolean
  onEditAmountChange: (value: string) => void
  onEditDateChange: (value: string) => void
  onEditReasonChange: (value: string) => void
  onEditSubmit: () => void
  onEditClose: () => void
  // Delete Payment
  deletingPayment: boolean
  deleteReason: string
  isDeletePending: boolean
  onDeleteReasonChange: (value: string) => void
  onDeleteSubmit: () => void
  onDeleteClose: () => void
  // Edit Loan
  editingLoan: boolean
  loanPrincipal: string
  loanInterestRate: string
  loanStartDate: string
  loanEditReason: string
  isLoanEditPending: boolean
  onLoanPrincipalChange: (value: string) => void
  onLoanInterestRateChange: (value: string) => void
  onLoanStartDateChange: (value: string) => void
  onLoanEditReasonChange: (value: string) => void
  onLoanEditSubmit: () => void
  onLoanEditClose: () => void
  // Delete Loan
  deletingLoan: boolean
  loanDeleteReason: string
  isLoanDeletePending: boolean
  onLoanDeleteReasonChange: (value: string) => void
  onLoanDeleteSubmit: () => void
  onLoanDeleteClose: () => void
  // Rate Change
  requestingRateChange: boolean
  newRate: string
  isRateChangePending: boolean
  onNewRateChange: (value: string) => void
  onRateChangeSubmit: () => void
  onRateChangeClose: () => void
}

export function LoanDialogs({
  loan,
  userRole,
  editingPayment,
  editAmount,
  editDate,
  editReason,
  isEditPending,
  onEditAmountChange,
  onEditDateChange,
  onEditReasonChange,
  onEditSubmit,
  onEditClose,
  deletingPayment,
  deleteReason,
  isDeletePending,
  onDeleteReasonChange,
  onDeleteSubmit,
  onDeleteClose,
  editingLoan,
  loanPrincipal,
  loanInterestRate,
  loanStartDate,
  loanEditReason,
  isLoanEditPending,
  onLoanPrincipalChange,
  onLoanInterestRateChange,
  onLoanStartDateChange,
  onLoanEditReasonChange,
  onLoanEditSubmit,
  onLoanEditClose,
  deletingLoan,
  loanDeleteReason,
  isLoanDeletePending,
  onLoanDeleteReasonChange,
  onLoanDeleteSubmit,
  onLoanDeleteClose,
  requestingRateChange,
  newRate,
  isRateChangePending,
  onNewRateChange,
  onRateChangeSubmit,
  onRateChangeClose,
}: LoanDialogsProps) {
  return (
    <>
      {/* Edit Payment Dialog */}
      <DrawerDialog open={editingPayment} onOpenChange={(open) => { if (!open) onEditClose() }}>
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
                value={editAmount}
                onChange={(e) => onEditAmountChange(e.target.value)}
                disabled={isEditPending}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="editDate">Payment Date</Label>
              <Input
                id="editDate"
                type="date"
                value={editDate}
                onChange={(e) => onEditDateChange(e.target.value)}
                disabled={isEditPending}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="editReason">Reason for edit</Label>
              <Textarea
                id="editReason"
                value={editReason}
                onChange={(e) => onEditReasonChange(e.target.value)}
                placeholder="Explain what is being corrected and why"
                disabled={isEditPending}
                maxLength={2500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={onEditClose}
              disabled={isEditPending}
            >
              Discard Changes
            </Button>
            <Button
              onClick={onEditSubmit}
              disabled={isEditPending || !editReason.trim()}
            >
              {isEditPending ? (
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

      {/* Delete Payment Dialog */}
      <DrawerDialog open={deletingPayment} onOpenChange={(open) => { if (!open) onDeleteClose() }}>
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
                value={deleteReason}
                onChange={(e) => onDeleteReasonChange(e.target.value)}
                placeholder="Explain why this payment is being deleted"
                disabled={isDeletePending}
                maxLength={2500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={onDeleteClose}
              disabled={isDeletePending}
            >
              Keep Payment
            </Button>
            <Button
              variant="destructive"
              onClick={onDeleteSubmit}
              disabled={isDeletePending || !deleteReason.trim()}
            >
              {isDeletePending ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  Deleting...
                </>
              ) : (
                "Delete Payment"
              )}
            </Button>
          </DialogFooter>
        </DrawerDialogContent>
      </DrawerDialog>

      {/* Edit Loan Dialog */}
      <DrawerDialog open={editingLoan} onOpenChange={(open) => { if (!open) onLoanEditClose() }}>
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
                value={loanPrincipal}
                onChange={(e) => onLoanPrincipalChange(e.target.value)}
                disabled={isLoanEditPending}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="loanInterestRate">Interest Rate (% per month)</Label>
              <Input
                id="loanInterestRate"
                type="number"
                min="0"
                step="0.1"
                value={loanInterestRate}
                onChange={(e) => onLoanInterestRateChange(e.target.value)}
                disabled={isLoanEditPending}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="loanStartDate">Start Date</Label>
              <Input
                id="loanStartDate"
                type="date"
                value={loanStartDate}
                onChange={(e) => onLoanStartDateChange(e.target.value)}
                disabled={isLoanEditPending}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="loanEditReason">Reason for edit</Label>
              <Textarea
                id="loanEditReason"
                value={loanEditReason}
                onChange={(e) => onLoanEditReasonChange(e.target.value)}
                placeholder="Explain what is being corrected and why"
                disabled={isLoanEditPending}
                maxLength={2500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={onLoanEditClose}
              disabled={isLoanEditPending}
            >
              Discard Changes
            </Button>
            <Button
              onClick={onLoanEditSubmit}
              disabled={isLoanEditPending || !loanEditReason.trim()}
            >
              {isLoanEditPending ? (
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

      {/* Delete Loan Dialog */}
      <DrawerDialog open={deletingLoan} onOpenChange={(open) => { if (!open) onLoanDeleteClose() }}>
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
                value={loanDeleteReason}
                onChange={(e) => onLoanDeleteReasonChange(e.target.value)}
                placeholder="Explain why this loan is being deleted"
                disabled={isLoanDeletePending}
                maxLength={2500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={onLoanDeleteClose}
              disabled={isLoanDeletePending}
            >
              Keep Loan
            </Button>
            <Button
              variant="destructive"
              onClick={onLoanDeleteSubmit}
              disabled={isLoanDeletePending || !loanDeleteReason.trim()}
            >
              {isLoanDeletePending ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  Deleting...
                </>
              ) : (
                "Delete Loan"
              )}
            </Button>
          </DialogFooter>
        </DrawerDialogContent>
      </DrawerDialog>

      {/* Rate Change Request Dialog */}
      <DrawerDialog open={requestingRateChange} onOpenChange={(open) => { if (!open) onRateChangeClose() }}>
        <DrawerDialogContent>
          <DialogHeader>
            <DialogTitle>Request Interest Rate Change</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Current rate: {formatRate(loan.interestRate, 1)} per month.
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
                disabled={isRateChangePending}
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
              onClick={onRateChangeClose}
              disabled={isRateChangePending}
            >
              Cancel
            </Button>
            <Button
              onClick={onRateChangeSubmit}
              disabled={isRateChangePending || !newRate.trim() || parseFloat(newRate) <= 0}
            >
              {isRateChangePending ? (
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
    </>
  )
}
