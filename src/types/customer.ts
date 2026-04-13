import type { InferSelectModel, InferInsertModel } from "drizzle-orm"
import type { customers } from "@/lib/db/schema/customers"
import type { LoanStatus } from "./loan"

export type Customer = InferSelectModel<typeof customers>
export type NewCustomer = InferInsertModel<typeof customers>

export type CustomerStatus = "active" | "blacklisted" | "inactive"

export interface CreateCustomerInput {
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
