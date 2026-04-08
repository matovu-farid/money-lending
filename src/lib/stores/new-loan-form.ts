import { create } from "zustand"
import { devtools, persist, createJSONStorage } from "zustand/middleware"
import type { LoanType, DepositLocation } from "@/types"

interface NewLoanFormData {
  customerId: string
  principalAmount: string
  issuanceFee: string
  startDate: string
  interestRateDisplay: string
  disbursementSource: DepositLocation
  collateralNature: string
  collateralDescription: string
  loanType: LoanType
  termMonths: string
  step: number
}

interface NewLoanFormState extends NewLoanFormData {
  setField: <K extends keyof NewLoanFormData>(key: K, value: NewLoanFormData[K]) => void
  setFields: (fields: Partial<NewLoanFormData>) => void
  clear: () => void
}

const defaults: NewLoanFormData = {
  customerId: "",
  principalAmount: "",
  issuanceFee: "50000",
  startDate: "",
  interestRateDisplay: "10",
  disbursementSource: "cash",
  collateralNature: "",
  collateralDescription: "",
  loanType: "perpetual",
  termMonths: "",
  step: 1,
}

export const useNewLoanFormStore = create<NewLoanFormState>()(
  devtools(
    persist(
      (set) => ({
        ...defaults,
        setField: (key, value) => set({ [key]: value }),
        setFields: (fields) => set(fields),
        clear: () => set(defaults),
      }),
      {
        name: "new-loan-draft",
        storage: createJSONStorage(() => sessionStorage),
      }
    ),
    { name: "new-loan-form" }
  )
)
