"use server"

import { Effect } from "effect"
import { getSession, requireRole, getErrorTag } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { createCustomer, getCustomer, updateCustomer, listCustomers, searchCustomers, changeCustomerStatus } from "@/services/customer.service"
import type { CreateCustomerInput, UpdateCustomerInput, CustomerSearchParams, ChangeStatusInput, CustomerStatus } from "@/types"

export async function listCustomersAction() {
  const session = await getSession()
  if (!session) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(listCustomers())
    return { data }
  } catch (error) {
    if (getErrorTag(error) === "DatabaseError") {
      return { error: "Database error" }
    }
    return { error: "Internal server error" }
  }
}

export async function createCustomerAction(input: CreateCustomerInput) {
  const session = await getSession()
  if (!session) return { error: "Unauthorized" }

  if (!input.fullName?.trim() || input.fullName.trim().split(/\s+/).length < 2) {
    return { error: "Full name with first and last name is required" }
  }
  if (!input.nin?.trim() || !/^[CA][MF]\d{8}[A-Z0-9]{4}$/.test(input.nin.trim().toUpperCase())) {
    return { error: "Valid NIN is required (e.g. CM97027102X4CU)" }
  }
  if (!input.contact?.trim() || !/^(07\d{8}|\+2567\d{8})$/.test(input.contact.trim().replace(/\s/g, ""))) {
    return { error: "Valid Ugandan mobile number is required (e.g. 0771234567)" }
  }
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
}

export async function getCustomerAction(id: string) {
  const session = await getSession()
  if (!session) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(getCustomer(id))
    return { data }
  } catch (error) {
    if (getErrorTag(error) === "CustomerNotFound") {
      return { error: "Customer not found" }
    }
    return { error: "Internal server error" }
  }
}

export async function updateCustomerAction(
  id: string,
  input: UpdateCustomerInput
) {
  const session = await getSession()
  if (!session) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(updateCustomer(id, input))
    revalidatePath("/customers")
    revalidatePath(`/customers/${id}`)
    return { data }
  } catch (error) {
    if (getErrorTag(error) === "CustomerNotFound") {
      return { error: "Customer not found" }
    }
    return { error: "Internal server error" }
  }
}

export async function searchCustomersAction(params: CustomerSearchParams) {
  const session = await getSession()
  if (!session) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(searchCustomers(params))
    return { data }
  } catch (error) {
    console.error("[searchCustomersAction] error:", error)
    if (getErrorTag(error) === "DatabaseError") {
      return { error: "Database error" }
    }
    return { error: "Internal server error" }
  }
}

export async function changeCustomerStatusAction(input: ChangeStatusInput) {
  const session = await getSession()
  if (!session) return { error: "Unauthorized" }

  const forbidden = requireRole(session, "admin")
  if (forbidden) return { error: forbidden }

  if (!input.customerId?.trim()) {
    return { error: "Customer ID is required" }
  }
  const validStatuses: CustomerStatus[] = ["active", "blacklisted", "inactive"]
  if (!input.newStatus || !validStatuses.includes(input.newStatus)) {
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
}
