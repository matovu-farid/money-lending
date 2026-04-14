"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import { getErrorTag } from "@/lib/action-utils"
import { validateFullName, validateNIN, validateUgandanPhone } from "@/lib/validators"
import { revalidatePath } from "next/cache"
import { createCustomer, getCustomer, updateCustomer, listCustomers, searchCustomers, changeCustomerStatus } from "@/services/customer.service"
import type { CreateCustomerInput, UpdateCustomerInput, CustomerSearchParams, ChangeStatusInput } from "@/types"
import { VALID_CUSTOMER_STATUSES } from "@/lib/constants"

export const listCustomersAction = withAction({
  permission: "customer:read",
  effect: () => listCustomers(),
  errors: { DatabaseError: "Database error" },
})

export const createCustomerAction = withAction<CreateCustomerInput, any>({
  permission: "customer:create",
  action: async (_session, input) => {
    const nameErr = validateFullName(input.fullName)
    if (nameErr) return { error: nameErr }
    const ninErr = validateNIN(input.nin)
    if (ninErr) return { error: ninErr }
    const phoneErr = validateUgandanPhone(input.contact)
    if (phoneErr) return { error: phoneErr }
    if (!input.address?.trim() || input.address.trim().length < 5) {
      return { error: "Address is required (at least 5 characters)" }
    }

    try {
      const data = await Effect.runPromise(createCustomer(input))
      revalidatePath("/customers")
      return { data }
    } catch (error) {
      if (getErrorTag(error) === "DatabaseError") {
        return { error: "Database error" }
      }
      return { error: "Internal server error" }
    }
  },
})

export const getCustomerAction = withAction<string, any>({
  permission: "customer:read",
  effect: (_session, id) => getCustomer(id),
  errors: { CustomerNotFound: "Customer not found" },
})

export async function updateCustomerAction(
  id: string,
  input: UpdateCustomerInput
) {
  return updateCustomerWrapped({ id, input })
}

const updateCustomerWrapped = withAction<{ id: string; input: UpdateCustomerInput }, any>({
  permission: "customer:update",
  effect: (_session, { id, input }) => updateCustomer(id, input),
  revalidate: (input) => ["/customers", `/customers/${input.id}`],
  errors: { CustomerNotFound: "Customer not found" },
})

export const searchCustomersAction = withAction<CustomerSearchParams, any>({
  permission: "customer:read",
  effect: (_session, params) => searchCustomers(params),
  errors: { DatabaseError: "Database error" },
})

export const changeCustomerStatusAction = withAction<ChangeStatusInput, any>({
  permission: "user:ban",
  action: async (session, input) => {
    if (!input.customerId?.trim()) {
      return { error: "Customer ID is required" }
    }
    if (!input.newStatus || !VALID_CUSTOMER_STATUSES.includes(input.newStatus as any)) {
      return { error: "Invalid status" }
    }
    if (!input.reason?.trim() || input.reason.trim().length < 10) {
      return { error: "Reason must be at least 10 characters" }
    }

    try {
      const data = await Effect.runPromise(
        changeCustomerStatus(input.customerId, input.newStatus, input.reason, session.user.id)
      )
      revalidatePath("/customers")
      revalidatePath(`/customers/${input.customerId}`)
      return { data }
    } catch (error) {
      if (getErrorTag(error) === "CustomerNotFound") {
        return { error: "Customer not found" }
      }
      return { error: "Internal server error" }
    }
  },
})
