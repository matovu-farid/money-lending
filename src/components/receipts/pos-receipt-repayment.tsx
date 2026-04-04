"use client"

import { formatCurrency, formatDate } from "@/lib/utils"

interface PosReceiptRepaymentProps {
  receiptNumber: string
  date: string
  customerName: string
  loanReference: string
  amountPaid: string
  interestPortion: string
  principalPortion: string
  balanceAfter: string
  depositLocation?: string
  officerName: string
}

export function PosReceiptRepayment({
  receiptNumber,
  date,
  customerName,
  loanReference,
  amountPaid,
  interestPortion,
  principalPortion,
  balanceAfter,
  depositLocation,
  officerName,
}: PosReceiptRepaymentProps) {
  const formattedLocation = depositLocation
    ? depositLocation === "strong_room"
      ? "Strong Room"
      : depositLocation.charAt(0).toUpperCase() + depositLocation.slice(1)
    : undefined

  return (
    <div className="pos-receipt max-w-[300px] mx-auto font-mono text-[11px] leading-tight bg-white text-black p-4">
      {/* Header */}
      <div className="text-center font-bold text-sm uppercase tracking-wide">
        SOVEREIGN LEDGER
      </div>
      <div className="text-center text-[10px] mt-0.5">PAYMENT RECEIPT</div>

      {/* Separator */}
      <div className="border-t border-dashed border-black my-2" />

      {/* Receipt # and Date */}
      <div className="flex justify-between">
        <span>{receiptNumber}</span>
        <span>{formatDate(date)}</span>
      </div>

      {/* Separator */}
      <div className="border-t border-dashed border-black my-2" />

      {/* Customer */}
      <div>
        <div>Customer: {customerName}</div>
        <div>Loan Ref: {loanReference}</div>
      </div>

      {/* Separator */}
      <div className="border-t border-dashed border-black my-2" />

      {/* Payment Breakdown */}
      <div className="space-y-0.5">
        <div className="flex justify-between">
          <span>Amount Paid:</span>
          <span>{formatCurrency(amountPaid)}</span>
        </div>
        <div className="flex justify-between">
          <span>Interest:</span>
          <span>{formatCurrency(interestPortion)}</span>
        </div>
        <div className="flex justify-between">
          <span>Principal:</span>
          <span>{formatCurrency(principalPortion)}</span>
        </div>
        {formattedLocation && (
          <div className="flex justify-between">
            <span>Deposit:</span>
            <span>{formattedLocation}</span>
          </div>
        )}
      </div>

      {/* Separator */}
      <div className="border-t border-dashed border-black my-2" />

      {/* Balance After */}
      <div className="flex justify-between font-bold">
        <span>Balance After:</span>
        <span>{formatCurrency(balanceAfter)}</span>
      </div>

      {/* Separator */}
      <div className="border-t border-dashed border-black my-2" />

      {/* Officer */}
      <div>Received by: {officerName}</div>

      {/* Footer */}
      <div className="border-t border-dashed border-black my-2" />
      <div className="text-center text-[10px]">Thank you for your business</div>
      <div className="text-center text-[10px] mt-0.5">--- Sovereign Ledger ---</div>
    </div>
  )
}
