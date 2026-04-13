import type { DepositLocation } from "@/types"

export interface LoanFormValues {
  customerId: string
  principalAmount: string
  issuanceFee: string
  startDate: string
  interestRateDisplay: string
  disbursementSource: DepositLocation
  collateralNature: string
  collateralDescription: string
  backdateNote: string
}

export interface ReceiptData {
  receiptNumber: string
  customerId: string
  customerName: string
  loanAmount: string
  issuanceFee: string
  interestRate: string
  collateralNature: string
  collateralDescription: string
  disbursementSource: string
  date: string
  rolloverAmount?: string
  totalNewPrincipal?: string
}
