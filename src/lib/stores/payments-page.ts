import { create } from "zustand"
import { devtools } from "zustand/middleware"
import type { PaymentWithCustomer } from "@/types"

interface PaymentsPageFilters {
  customerName: string
  dateFrom: string
  dateTo: string
  amountMin: string
  amountMax: string
  page: number
}

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

  // Filters
  filters: PaymentsPageFilters
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

  setFilter: <K extends keyof PaymentsPageFilters>(key: K, value: PaymentsPageFilters[K]) => void
  clearFilters: () => void
  setPage: (page: number) => void
  initFilters: (params: Partial<PaymentsPageFilters>) => void
}

const defaultFilters: PaymentsPageFilters = {
  customerName: "",
  dateFrom: "",
  dateTo: "",
  amountMin: "",
  amountMax: "",
  page: 1,
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
  filters: { ...defaultFilters },

  // Quick record
  openQuickRecord: () => set({ quickRecordOpen: true }),
  closeQuickRecord: () => set({ quickRecordOpen: false }),

  // Edit
  openEdit: (payment) =>
    set({
      editOpen: true,
      editTarget: payment,
      editAmount: payment.amount,
      editDate: payment.paymentDate instanceof Date
        ? payment.paymentDate.toISOString().slice(0, 10)
        : String(payment.paymentDate).slice(0, 10),
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

  // Filters
  setFilter: (key, value) =>
    set((s) => ({ filters: { ...s.filters, [key]: value, ...(key !== "page" ? { page: 1 } : {}) } })),
  clearFilters: () => set({ filters: { ...defaultFilters } }),
  setPage: (page) => set((s) => ({ filters: { ...s.filters, page } })),
  initFilters: (params) => set((s) => ({ filters: { ...s.filters, ...params } })),
}), { name: "payments-page" }))
