"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { createCustomer, getCustomer, updateCustomer, listCustomers, searchCustomers, changeCustomerStatus } from "@/services/customer.service"
import { CustomerNotFound, DatabaseError } from "@/lib/errors"
import { ROLE_LEVELS, type UserRole } from "@/types"
import type { CreateCustomerInput, UpdateCustomerInput, CustomerSearchParams, ChangeStatusInput, CustomerStatus } from "@/types"

export async function listCustomersAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  try {
    const data = await Effect.runPromise(listCustomers())
    return { data }
  } catch (error) {
    if (error instanceof DatabaseError) {
      return { error: "Database error" }
    }
    return { error: "Internal server error" }
  }
}

export async function createCustomerAction(input: CreateCustomerInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  if (!input.fullName?.trim()) {
    return { error: "Full name is required" }
  }
  if (!input.contact?.trim()) {
    return { error: "Contact is required" }
  }
  if (!input.address?.trim()) {
    return { error: "Address is required" }
  }

  try {
    const data = await Effect.runPromise(createCustomer(input))
    revalidatePath("/customers")
    return { data }
  } catch (error) {
    if (error instanceof DatabaseError) {
      return { error: "Database error" }
    }
    return { error: "Internal server error" }
  }
}

export async function getCustomerAction(id: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  try {
    const data = await Effect.runPromise(getCustomer(id))
    return { data }
  } catch (error) {
    if (error instanceof CustomerNotFound) {
      return { error: "Customer not found" }
    }
    return { error: "Internal server error" }
  }
}

export async function updateCustomerAction(
  id: string,
  input: UpdateCustomerInput
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  try {
    const data = await Effect.runPromise(updateCustomer(id, input))
    revalidatePath("/customers")
    revalidatePath(`/customers/${id}`)
    return { data }
  } catch (error) {
    if (error instanceof CustomerNotFound) {
      return { error: "Customer not found" }
    }
    return { error: "Internal server error" }
  }
}

export async function searchCustomersAction(params: CustomerSearchParams) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  try {
    const data = await Effect.runPromise(searchCustomers(params))
    return { data }
  } catch (error) {
    if (error instanceof DatabaseError) {
      return { error: "Database error" }
    }
    return { error: "Internal server error" }
  }
}

export async function changeCustomerStatusAction(input: ChangeStatusInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.admin) {
    return { error: "Forbidden" }
  }

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
    if (error instanceof CustomerNotFound) {
      return { error: "Customer not found" }
    }
    return { error: "Internal server error" }
  }
}
