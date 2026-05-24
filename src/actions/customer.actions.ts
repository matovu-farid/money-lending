"use server"

import { Effect } from "effect"
import { withAction, type Session } from "@/lib/with-action"
import { getErrorTag } from "@/lib/action-utils"
import { validateFullName, validateNIN, validateUgandanPhone } from "@/lib/validators"
import { revalidatePath } from "next/cache"
import { createCustomerWithTxid, getCustomer, updateCustomerWithTxid, listCustomers, searchCustomers, changeCustomerStatusWithTxid } from "@/services/customer.service"
import type { CreateCustomerInput, UpdateCustomerInput, CustomerSearchParams, ChangeStatusInput } from "@/types"
import { VALID_CUSTOMER_STATUSES } from "@/lib/constants"
import { getUniqueConstraintName, isUniqueConstraintError } from "@/lib/db-errors"

export const listCustomersAction = withAction({
  permission: "customer:read",
  effect: () => listCustomers(),
  errors: { DatabaseError: "Database error" },
})

export const createCustomerAction = withAction({
  permission: "customer:create",
  action: async (_session: Session, input: CreateCustomerInput) => {
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
      const { customer, txid } = await Effect.runPromise(createCustomerWithTxid(input))
      revalidatePath("/customers")
      return { data: customer, txid }
    } catch (error) {
      // Unwrap the underlying cause from DatabaseError
      const errObj = error as { cause?: { cause?: unknown } } | null | undefined
      const cause = errObj?.cause?.cause ?? errObj?.cause ?? error
      if (isUniqueConstraintError(cause)) {
        const constraint = getUniqueConstraintName(cause)
        if (constraint === "uq_customers_nin") {
          return { error: "A customer with this NIN already exists" }
        }
        return { error: "A customer with these details already exists" }
      }
      console.error("[createCustomerAction] Database error:", cause)
      if (getErrorTag(error) === "DatabaseError") {
        return { error: "Database error — check server logs for details" }
      }
      return { error: "Internal server error" }
    }
  },
})

export const getCustomerAction = withAction({
  permission: "customer:read",
  effect: (_session: Session, id: string) => getCustomer(id),
  errors: { CustomerNotFound: "Customer not found" },
})

export async function updateCustomerAction(
  id: string,
  input: UpdateCustomerInput
) {
  return updateCustomerWrapped({ id, input })
}

const updateCustomerWrapped = withAction({
  permission: "customer:update",
  action: async (_session: Session, { id, input }: { id: string; input: UpdateCustomerInput }) => {
    try {
      const { customer, txid } = await Effect.runPromise(updateCustomerWithTxid(id, input))
      revalidatePath("/customers")
      revalidatePath(`/customers/${id}`)
      return { data: customer, txid }
    } catch (error) {
      if (getErrorTag(error) === "CustomerNotFound") {
        return { error: "Customer not found" }
      }
      console.error("[updateCustomerAction]", error)
      return { error: "Internal server error" }
    }
  },
})

export const searchCustomersAction = withAction({
  permission: "customer:read",
  effect: (_session: Session, params: CustomerSearchParams) => searchCustomers(params),
  errors: { DatabaseError: "Database error" },
})

export const changeCustomerStatusAction = withAction({
  permission: "user:ban",
  action: async (session: Session, input: ChangeStatusInput) => {
    if (!input.customerId?.trim()) {
      return { error: "Customer ID is required" }
    }
    if (!input.newStatus || !(VALID_CUSTOMER_STATUSES as readonly string[]).includes(input.newStatus)) {
      return { error: "Invalid status" }
    }
    if (!input.reason?.trim() || input.reason.trim().length < 10) {
      return { error: "Reason must be at least 10 characters" }
    }

    try {
      const { customer, txid } = await Effect.runPromise(
        changeCustomerStatusWithTxid(input.customerId, input.newStatus, input.reason, session.user.id)
      )
      revalidatePath("/customers")
      revalidatePath(`/customers/${input.customerId}`)
      return { data: customer, txid }
    } catch (error) {
      if (getErrorTag(error) === "CustomerNotFound") {
        return { error: "Customer not found" }
      }
      return { error: "Internal server error" }
    }
  },
})
