"use client"

import { useState } from "react"
import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PosReceiptModal } from "./pos-receipt-modal"
import { PosReceiptRepayment } from "./pos-receipt-repayment"
import { generateReceiptNumber } from "@/lib/receipt-number"

export interface PaymentReceiptData {
  paymentDate: string | Date
  customerName: string
  loanReference: string
  amountPaid: string
  interestPortion: string
  principalPortion: string
  balanceAfter: string
  outstandingBalance?: string
  depositLocation?: string
  officerName: string
}

interface PaymentReceiptButtonProps {
  data: PaymentReceiptData
  /** Render as a ghost icon button (for table rows) */
  variant?: "icon" | "dropdown-item"
  /** Auto-download image + print when receipt opens */
  autoActions?: boolean
}

/**
 * Reusable button that opens a POS repayment receipt modal.
 * Use in any context where a payment row needs a "Print Receipt" action.
 */
export function PaymentReceiptButton({
  data,
  variant = "icon",
  autoActions = false,
}: PaymentReceiptButtonProps) {
  const [open, setOpen] = useState(false)
  const [receiptNumber] = useState(() => generateReceiptNumber())

  const dateStr =
    data.paymentDate instanceof Date
      ? data.paymentDate.toISOString()
      : String(data.paymentDate)

  if (variant === "dropdown-item") {
    return (
      <>
        <button
          type="button"
          className="relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 w-full"
          onClick={() => setOpen(true)}
        >
          <Printer className="h-4 w-4" />
          Print Receipt
        </button>
        <PosReceiptModal
          open={open}
          onClose={() => setOpen(false)}
          title="Payment Receipt"
          autoActions={autoActions}
        >
          <PosReceiptRepayment
            receiptNumber={receiptNumber}
            date={dateStr}
            customerName={data.customerName}
            loanReference={data.loanReference}
            amountPaid={data.amountPaid}
            interestPortion={data.interestPortion}
            principalPortion={data.principalPortion}
            balanceAfter={data.balanceAfter}
            outstandingBalance={data.outstandingBalance}
            depositLocation={data.depositLocation}
            officerName={data.officerName}
          />
        </PosReceiptModal>
      </>
    )
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label="Print payment receipt"
      >
        <Printer className="h-4 w-4" />
      </Button>
      <PosReceiptModal
        open={open}
        onClose={() => setOpen(false)}
        title="Payment Receipt"
        autoActions={autoActions}
      >
        <PosReceiptRepayment
          receiptNumber={receiptNumber}
          date={dateStr}
          customerName={data.customerName}
          loanReference={data.loanReference}
          amountPaid={data.amountPaid}
          interestPortion={data.interestPortion}
          principalPortion={data.principalPortion}
          balanceAfter={data.balanceAfter}
          depositLocation={data.depositLocation}
          officerName={data.officerName}
        />
      </PosReceiptModal>
    </>
  )
}
