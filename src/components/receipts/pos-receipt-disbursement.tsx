"use client"

import { formatCurrency, formatDate } from "@/lib/utils"

interface PosReceiptDisbursementProps {
  receiptNumber: string
  date: string
  customerName: string
  customerNin?: string
  loanAmount: string
  issuanceFee?: string
  description?: string
  interestRate: string
  collateralNature: string
  collateralDescription?: string
  disbursementSource?: string
  officerName: string
}

export function PosReceiptDisbursement({
  receiptNumber,
  date,
  customerName,
  customerNin,
  loanAmount,
  issuanceFee,
  description,
  interestRate,
  collateralNature,
  collateralDescription,
  disbursementSource,
  officerName,
}: PosReceiptDisbursementProps) {
  const formattedSource = disbursementSource
    ? disbursementSource === "strong_room"
      ? "Strong Room"
      : disbursementSource.charAt(0).toUpperCase() + disbursementSource.slice(1)
    : undefined

  return (
    <div className="pos-receipt max-w-[300px] mx-auto font-mono text-[11px] leading-tight bg-white text-black p-4">
      {/* Header */}
      <div className="text-center font-bold text-sm uppercase tracking-wide">
        SOVEREIGN LEDGER
      </div>
      <div className="text-center text-[10px] mt-0.5">LOAN DISBURSEMENT</div>

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
        {customerNin && <div>NIN: {customerNin}</div>}
      </div>

      {/* Separator */}
      <div className="border-t border-dashed border-black my-2" />

      {/* Loan Details */}
      <div className="space-y-0.5">
        <div className="flex justify-between">
          <span>Amount:</span>
          <span>{formatCurrency(loanAmount)}</span>
        </div>
        {issuanceFee && (
          <div className="flex justify-between">
            <span>Issuance Fee:</span>
            <span>{formatCurrency(issuanceFee)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Interest Rate:</span>
          <span>{interestRate}</span>
        </div>
        {description && (
          <div>
            <span>Purpose: {description}</span>
          </div>
        )}
        <div>
          <span>Collateral: {collateralNature}</span>
        </div>
        {collateralDescription && (
          <div className="pl-2 text-[10px]">{collateralDescription}</div>
        )}
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

      {/* Footer */}
      <div className="border-t border-dashed border-black my-2" />
      <div className="text-center text-[10px]">Thank you for your business</div>
      <div className="text-center text-[10px] mt-0.5">--- Sovereign Ledger ---</div>
    </div>
  )
}
