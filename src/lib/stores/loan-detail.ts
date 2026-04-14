import { create } from "zustand"
import { devtools } from "zustand/middleware"
import type { PaymentWithCustomer } from "@/types"

interface LoanDetailState {
  // Payment edit dialog
  editingPayment: PaymentWithCustomer | null
  editAmount: string
  editDate: string
  editReason: string

  // Payment delete dialog
  deletingPayment: PaymentWithCustomer | null
  deleteReason: string

  // Loan edit dialog
  editingLoan: boolean
  loanPrincipal: string
  loanInterestRate: string
  loanStartDate: string
  loanEditReason: string

  // Loan delete dialog
  deletingLoan: boolean
  loanDeleteReason: string

  // Collateral settlement
  settlingCollateral: boolean

  // Rate change dialog
  requestingRateChange: boolean
  newRate: string

  // Penalty adjustment
  adjustingPenalty: boolean
  penaltyMultiplierInput: string
}

interface LoanDetailActions {
  // Payment edit
  openPaymentEdit: (payment: PaymentWithCustomer) => void
  closePaymentEdit: () => void
  setEditAmount: (v: string) => void
  setEditDate: (v: string) => void
  setEditReason: (v: string) => void

  // Payment delete
  openPaymentDelete: (payment: PaymentWithCustomer) => void
  closePaymentDelete: () => void
  setDeleteReason: (v: string) => void

  // Loan edit
  openLoanEdit: (loan: { principalAmount: string; interestRate: string; interestRateOverride?: string | null; startDate: Date | string }) => void
  closeLoanEdit: () => void
  setLoanPrincipal: (v: string) => void
  setLoanInterestRate: (v: string) => void
  setLoanStartDate: (v: string) => void
  setLoanEditReason: (v: string) => void

  // Loan delete
  openLoanDelete: () => void
  closeLoanDelete: () => void
  setLoanDeleteReason: (v: string) => void

  // Collateral settlement
  openSettleCollateral: () => void
  closeSettleCollateral: () => void

  // Rate change
  openRateChange: (currentRate: string) => void
  closeRateChange: () => void
  setNewRate: (v: string) => void

  // Penalty
  openPenaltyAdjust: () => void
  closePenaltyAdjust: () => void
  setPenaltyMultiplierInput: (v: string) => void

  // Reset all state (when navigating away)
  reset: () => void
}

function formatDateForInput(date: Date | string | null | undefined): string {
  if (!date) return ""
  const d = typeof date === "string" ? new Date(date) : date
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

const initialState: LoanDetailState = {
  editingPayment: null,
  editAmount: "",
  editDate: "",
  editReason: "",
  deletingPayment: null,
  deleteReason: "",
  editingLoan: false,
  loanPrincipal: "",
  loanInterestRate: "",
  loanStartDate: "",
  loanEditReason: "",
  deletingLoan: false,
  loanDeleteReason: "",
  settlingCollateral: false,
  requestingRateChange: false,
  newRate: "",
  adjustingPenalty: false,
  penaltyMultiplierInput: "",
}

export const useLoanDetailStore = create<LoanDetailState & LoanDetailActions>()(devtools((set) => ({
  ...initialState,

  // Payment edit
  openPaymentEdit: (payment) =>
    set({
      editingPayment: payment,
      editAmount: payment.amount,
      editDate: formatDateForInput(payment.paymentDate),
      editReason: "",
    }),
  closePaymentEdit: () =>
    set({ editingPayment: null, editAmount: "", editDate: "", editReason: "" }),
  setEditAmount: (v) => set({ editAmount: v }),
  setEditDate: (v) => set({ editDate: v }),
  setEditReason: (v) => set({ editReason: v }),

  // Payment delete
  openPaymentDelete: (payment) =>
    set({ deletingPayment: payment, deleteReason: "" }),
  closePaymentDelete: () => set({ deletingPayment: null, deleteReason: "" }),
  setDeleteReason: (v) => set({ deleteReason: v }),

  // Loan edit
  openLoanEdit: (loan) =>
    set({
      editingLoan: true,
      loanPrincipal: loan.principalAmount,
      loanInterestRate: (Number(loan.interestRateOverride ?? loan.interestRate) * 100).toFixed(1),
      loanStartDate: formatDateForInput(loan.startDate),
      loanEditReason: "",
    }),
  closeLoanEdit: () =>
    set({ editingLoan: false, loanPrincipal: "", loanInterestRate: "", loanStartDate: "", loanEditReason: "" }),
  setLoanPrincipal: (v) => set({ loanPrincipal: v }),
  setLoanInterestRate: (v) => set({ loanInterestRate: v }),
  setLoanStartDate: (v) => set({ loanStartDate: v }),
  setLoanEditReason: (v) => set({ loanEditReason: v }),

  // Loan delete
  openLoanDelete: () => set({ deletingLoan: true, loanDeleteReason: "" }),
  closeLoanDelete: () => set({ deletingLoan: false, loanDeleteReason: "" }),
  setLoanDeleteReason: (v) => set({ loanDeleteReason: v }),

  // Collateral
  openSettleCollateral: () => set({ settlingCollateral: true }),
  closeSettleCollateral: () => set({ settlingCollateral: false }),

  // Rate change
  openRateChange: (currentRate) =>
    set({ requestingRateChange: true, newRate: (Number(currentRate) * 100).toFixed(1) }),
  closeRateChange: () => set({ requestingRateChange: false, newRate: "" }),
  setNewRate: (v) => set({ newRate: v }),

  // Penalty
  openPenaltyAdjust: () => set({ adjustingPenalty: true }),
  closePenaltyAdjust: () => set({ adjustingPenalty: false }),
  setPenaltyMultiplierInput: (v) => set({ penaltyMultiplierInput: v }),

  // Reset
  reset: () => set(initialState),
}), { name: "loan-detail" }))
