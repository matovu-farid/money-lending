"use client"

import { formatCurrency, formatDate } from "@/lib/utils"

interface PosReceiptDisbursementProps {
  receiptNumber: string
  date: string
  customerName: string
  customerNin?: string
  loanAmount: string
  issuanceFee?: string
  interestRate: string
  collateralNature: string
  disbursementSource?: string
  officerName: string
  rolloverAmount?: string
  totalNewPrincipal?: string
}

export function PosReceiptDisbursement({
  receiptNumber,
  date,
  customerName,
  customerNin,
  loanAmount,
  issuanceFee,
  interestRate,
  collateralNature,
  disbursementSource,
  officerName,
  rolloverAmount,
  totalNewPrincipal,
}: PosReceiptDisbursementProps) {
  const formattedSource = disbursementSource
    ? disbursementSource === "strong_room"
      ? "Strong Room"
      : disbursementSource.charAt(0).toUpperCase() + disbursementSource.slice(1)
    : undefined

  const isRollover = !!rolloverAmount && !!totalNewPrincipal

  return (
    <div className="pos-receipt max-w-[300px] mx-auto font-mono text-[11px] leading-tight bg-white text-black p-4">
      {/* Header */}
      <div className="text-center font-bold text-sm uppercase tracking-wide">
        SOVEREIGN LEDGER
      </div>
      <div className="text-center text-[10px] mt-0.5">LOAN DISBURSEMENT</div>

      {/* Separator */}
      <div className="border-t border-dashed border-black my-2" />

      {/* Receipt # and Date on separate lines */}
      <div>{receiptNumber}</div>
      <div>{formatDate(date)}</div>

      {/* Separator */}
      <div className="border-t border-dashed border-black my-2" />

      {/* Customer */}
      <div>
        <div>Customer: {customerName}</div>
        {customerNin && <div>NIN: {customerNin}</div>}
      </div>

      {/* Separator */}
      <div className="border-t border-dashed border-black my-2" />

      {/* Loan Details */}
      <div className="space-y-0.5">
        {isRollover ? (
          <>
            <div className="flex justify-between">
              <span>Fresh Disbursement:</span>
              <span>{formatCurrency(loanAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span>Rolled Over:</span>
              <span>{formatCurrency(rolloverAmount)}</span>
            </div>
            <div className="border-t border-dotted border-black my-1" />
            <div className="flex justify-between font-bold">
              <span>New Principal:</span>
              <span>{formatCurrency(totalNewPrincipal)}</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between">
              <span>Amount:</span>
              <span>{formatCurrency(loanAmount)}</span>
            </div>
            {issuanceFee && parseFloat(issuanceFee) > 0 && (
              <div className="flex justify-between">
                <span>Issuance Fee:</span>
                <span>{formatCurrency(issuanceFee)}</span>
              </div>
            )}
          </>
        )}
        <div className="flex justify-between">
          <span>Interest Rate:</span>
          <span>{interestRate}</span>
        </div>
        <div className="flex justify-between">
          <span>Collateral:</span>
          <span>{collateralNature}</span>
        </div>

        {formattedSource && (
          <div className="flex justify-between">
            <span>Source:</span>
            <span>{formattedSource}</span>
          </div>
        )}
      </div>

      {/* Separator */}
      <div className="border-t border-dashed border-black my-2" />

      {/* Officer */}
      <div>Issued by: {officerName}</div>

      {/* Signature */}
      <div className="mt-6">
        <div className="border-b border-black mb-1 h-6" />
        <div className="text-[10px] text-center">Customer Signature</div>
      </div>

      {/* Footer */}
      <div className="border-t border-dashed border-black my-2" />
      <div className="text-center text-[10px]">Thank you for your business</div>
      <div className="text-center text-[10px] mt-0.5">--- Sovereign Ledger ---</div>
    </div>
  )
}
