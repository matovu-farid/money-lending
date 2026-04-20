import { create } from "zustand"
import { devtools } from "zustand/middleware"
import type { PaymentWithCustomer } from "@/types"

interface PaymentsPageState {
  // Quick record dialog
  quickRecordOpen: boolean

  // Edit sheet
  editOpen: boolean
  editTarget: PaymentWithCustomer | null
  editAmount: string
  editDate: string
  editReason: string

  // Delete dialog
  deleteOpen: boolean
  deleteTarget: PaymentWithCustomer | null
  deleteReason: string

  // Mark as wrong dialog
  markWrongOpen: boolean
  markWrongTarget: PaymentWithCustomer | null
  markWrongReason: string
}

interface PaymentsPageActions {
  openQuickRecord: () => void
  closeQuickRecord: () => void

  openEdit: (payment: PaymentWithCustomer) => void
  closeEdit: () => void
  setEditAmount: (v: string) => void
  setEditDate: (v: string) => void
  setEditReason: (v: string) => void

  openDelete: (payment: PaymentWithCustomer) => void
  closeDelete: () => void
  setDeleteReason: (v: string) => void

  openMarkWrong: (payment: PaymentWithCustomer) => void
  closeMarkWrong: () => void
  setMarkWrongReason: (v: string) => void
}

export const usePaymentsPageStore = create<PaymentsPageState & PaymentsPageActions>()(devtools((set) => ({
  // Initial state
  quickRecordOpen: false,
  editOpen: false,
  editTarget: null,
  editAmount: "",
  editDate: "",
  editReason: "",
  deleteOpen: false,
  deleteTarget: null,
  deleteReason: "",
  markWrongOpen: false,
  markWrongTarget: null,
  markWrongReason: "",

  // Quick record
  openQuickRecord: () => set({ quickRecordOpen: true }),
  closeQuickRecord: () => set({ quickRecordOpen: false }),

  // Edit
  openEdit: (payment) =>
    set({
      editOpen: true,
      editTarget: payment,
      editAmount: payment.amount,
      editDate: (() => {
        const d = payment.paymentDate instanceof Date
          ? payment.paymentDate
          : new Date(String(payment.paymentDate))
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, "0")
        const day = String(d.getDate()).padStart(2, "0")
        return `${y}-${m}-${day}`
      })(),
      editReason: "",
    }),
  closeEdit: () => set({ editOpen: false, editTarget: null }),
  setEditAmount: (v) => set({ editAmount: v }),
  setEditDate: (v) => set({ editDate: v }),
  setEditReason: (v) => set({ editReason: v }),

  // Delete
  openDelete: (payment) =>
    set({ deleteOpen: true, deleteTarget: payment, deleteReason: "" }),
  closeDelete: () => set({ deleteOpen: false, deleteTarget: null }),
  setDeleteReason: (v) => set({ deleteReason: v }),

  // Mark as wrong
  openMarkWrong: (payment) =>
    set({ markWrongOpen: true, markWrongTarget: payment, markWrongReason: "" }),
  closeMarkWrong: () => set({ markWrongOpen: false, markWrongTarget: null }),
  setMarkWrongReason: (v) => set({ markWrongReason: v }),
}), { name: "payments-page" }))
