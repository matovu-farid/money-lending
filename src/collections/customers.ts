"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import {
  searchCustomersAction,
  createCustomerAction,
  updateCustomerAction,
} from "@/actions/customer.actions"
import type { Customer, CreateCustomerInput, UpdateCustomerInput } from "@/types/customer"
import { getQueryClient } from "@/lib/query-client"

export const customerCollection = createCollection(
  queryCollectionOptions<Customer>({
    queryKey: ["customers"],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<Customer>> => {
      const result = await searchCustomersAction({ page: 1, pageSize: 10000 })
      if ("error" in result) {
        throw new Error(result.error)
      }
      return result.data.rows
    },
    getKey: (customer) => customer.id,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const input: CreateCustomerInput = {
        id: modified.id,
        fullName: modified.fullName,
        nin: modified.nin,
        contact: modified.contact,
        address: modified.address,
      }
      const result = await createCustomerAction(input)
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      const input: UpdateCustomerInput = {}
      if (changes.fullName !== undefined) input.fullName = changes.fullName
      if (changes.nin !== undefined) input.nin = changes.nin
      if (changes.contact !== undefined) input.contact = changes.contact
      if (changes.address !== undefined) input.address = changes.address
      const result = await updateCustomerAction(original.id, input)
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
  })
)
