"use client"

import { formatCurrency, formatDate } from "@/lib/utils"

export interface ReceiptLine {
  label: string
  value: string
  emphasized?: boolean
}

export interface TransactionReceiptData {
  receiptNumber: string
  date: string
  headerTitle: string
  amount: string
  /** Optional pretext line beneath the title (e.g. category, transfer kind) */
  subtitle?: string
  /** Label like "Customer", "Creditor", "Paid to", "Received from" */
  counterpartyLabel?: string
  counterpartyName?: string
  counterpartyContact?: string
  /** Pre-formatted detail rows shown above the total */
  breakdownLines?: ReceiptLine[]
  /** Loan officer / cashier / actor that recorded the transaction */
  actorName: string
  /** Source/destination location label, e.g. "Cash on Hand", "Bank — KCB ****1234" */
  location?: string
  /** Optional free-form note */
  notes?: string
  /** Whether to show a customer-signature line */
  showSignature?: boolean
}

interface Props {
  data: TransactionReceiptData
}

/**
 * Generic POS receipt for any money-movement event recorded in the ledger.
 * Reused by expenses, income, creditor activity, fund transfers, capital
 * injections, settlements, and daily collections. Loan disbursement and
 * loan payments keep their dedicated components (richer custom layouts).
 */
export function PosReceiptTransaction({ data }: Props) {
  return (
    <div className="pos-receipt max-w-[300px] mx-auto font-mono text-[11px] leading-tight bg-white text-black p-4">
      <div className="text-center font-bold text-sm uppercase tracking-wide">KAKS CREDIT</div>
      <div className="text-center text-[10px] mt-0.5 uppercase">{data.headerTitle}</div>
      {data.subtitle && <div className="text-center text-[10px] mt-0.5">{data.subtitle}</div>}

      <div className="border-t border-dashed border-black my-2" />

      <div>{data.receiptNumber}</div>
      <div>{formatDate(data.date)}</div>
      <div>Recorded by: {data.actorName}</div>

      {data.counterpartyName && (
        <>
          <div className="border-t border-dashed border-black my-2" />
          <div>{data.counterpartyLabel ?? "Party"}: {data.counterpartyName}</div>
          {data.counterpartyContact && <div>Contact: {data.counterpartyContact}</div>}
        </>
      )}

      <div className="border-t border-dashed border-black my-2" />

      <div className="space-y-0.5">
        {data.breakdownLines?.map((line, i) => (
          <div
            key={`${line.label}-${i}`}
            className={`flex justify-between${line.emphasized ? " font-bold" : ""}`}
          >
            <span>{line.label}:</span>
            <span>{line.value}</span>
          </div>
        ))}
        <div className="border-t border-dotted border-black my-1" />
        <div className="flex justify-between font-bold">
          <span>Amount:</span>
          <span>{formatCurrency(data.amount)}</span>
        </div>
        {data.location && (
          <div className="flex justify-between">
            <span>Location:</span>
            <span>{data.location}</span>
          </div>
        )}
      </div>

      {data.notes && (
        <>
          <div className="border-t border-dashed border-black my-2" />
          <div className="text-[10px]">{data.notes}</div>
        </>
      )}

      {data.showSignature && (
        <>
          <div className="border-t border-dashed border-black my-2" />
          <div className="mt-6">
            <div className="border-b border-black mb-1 h-6" />
            <div className="text-[10px] text-center">Signature</div>
          </div>
        </>
      )}

      <div className="border-t border-dashed border-black my-2" />
      <div className="text-center text-[10px]">Thank you</div>
      <div className="text-center text-[10px] mt-0.5">--- Kaks Credit ---</div>
    </div>
  )
}
