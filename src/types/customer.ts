import type { InferSelectModel, InferInsertModel } from "drizzle-orm"
import type { customers } from "@/lib/db/schema/customers"
import type { LoanStatus } from "./loan"
import type { CustomerStatus } from "@/lib/constants"

export type Customer = InferSelectModel<typeof customers>
export type NewCustomer = InferInsertModel<typeof customers>

// `CustomerStatus` is derived from `VALID_CUSTOMER_STATUSES` in `@/lib/constants`
// (single source of truth). Re-exported so `import type { CustomerStatus } from "@/types"`
// keeps working.
export type { CustomerStatus }

export interface CreateCustomerInput {
  id?: string
  fullName: string
  nin: string
  contact: string
  address: string
}

export interface UpdateCustomerInput {
  fullName?: string
  nin?: string
  contact?: string
  address?: string
}

export interface ChangeStatusInput {
  customerId: string
  newStatus: CustomerStatus
  reason: string
}

export interface CustomerSearchParams {
  name?: string
  status?: CustomerStatus[]
  loanStatus?: LoanStatus[]
  daysRemainingFilter?: "any" | "due_within_30" | "overdue_30_plus"
  sortByRecent?: boolean
  page?: number
  pageSize?: number
}
