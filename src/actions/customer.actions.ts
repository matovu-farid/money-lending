"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { createCustomer, getCustomer, updateCustomer, listCustomers, searchCustomers, changeCustomerStatus } from "@/services/customer.service"
import { CustomerNotFound, DatabaseError } from "@/lib/errors"
import type { CreateCustomerInput, UpdateCustomerInput, CustomerSearchParams, ChangeStatusInput } from "@/types"

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

  // Runtime validation -- TypeScript types are erased at runtime
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

  if (!input.reason?.trim() || input.reason.trim().length < 10) {
    return { error: "Reason must be at least 10 characters" }
  }

  try {
    const data = await Effect.runPromise(
      changeCustomerStatus(input.customerId, input.newStatus, input.reason, session.user.id)
    )
    return { data }
  } catch (error) {
    if (error instanceof CustomerNotFound) {
      return { error: "Customer not found" }
    }
    return { error: "Internal server error" }
  }
}
