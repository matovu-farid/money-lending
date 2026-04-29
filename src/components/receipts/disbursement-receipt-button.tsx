"use client"

import { useState } from "react"
import { Loader2, Printer } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { PosReceiptModal } from "./pos-receipt-modal"
import { PosReceiptDisbursement } from "./pos-receipt-disbursement"
import { getLoanReceiptDataAction } from "@/actions/loan.actions"

interface DisbursementReceiptData {
  receiptNumber: string
  date: string
  customerName: string
  customerNin?: string
  customerPhone?: string
  loanAmount: string
  issuanceFee: string
  interestRate: string
  collateralNature: string
  disbursementSource: string
  officerName: string
  rolloverAmount?: string
  totalNewPrincipal?: string
}

interface DisbursementReceiptButtonProps {
  loanId: string
  /** Auto-download image + print when receipt opens */
  autoActions?: boolean
}

/**
 * Reusable button that fetches loan data and shows a POS disbursement receipt modal.
 * Use in any context where a loan needs a "POS receipt" action.
 */
export function DisbursementReceiptButton({
  loanId,
  autoActions = false,
}: DisbursementReceiptButtonProps) {
  const [receiptData, setReceiptData] = useState<DisbursementReceiptData | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    const result = await getLoanReceiptDataAction(loanId)
    setLoading(false)
    if ("error" in result) {
      toast.error(result.error)
      return
    }
    setReceiptData(result.data)
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handleClick}
        disabled={loading}
        aria-label="POS receipt"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
      </Button>
      <PosReceiptModal
        open={receiptData !== null}
        onClose={() => setReceiptData(null)}
        title="Loan Disbursement Receipt"
        autoActions={autoActions}
      >
        {receiptData && (
          <PosReceiptDisbursement
            receiptNumber={receiptData.receiptNumber}
            date={receiptData.date}
            customerName={receiptData.customerName}
            customerNin={receiptData.customerNin}
            customerPhone={receiptData.customerPhone}
            loanAmount={receiptData.loanAmount}
            issuanceFee={receiptData.issuanceFee}
            interestRate={receiptData.interestRate}
            collateralNature={receiptData.collateralNature}
            disbursementSource={receiptData.disbursementSource}
            officerName={receiptData.officerName}
            rolloverAmount={receiptData.rolloverAmount}
            totalNewPrincipal={receiptData.totalNewPrincipal}
          />
        )}
      </PosReceiptModal>
    </>
  )
}
