import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import {
  searchCustomersAction,
  createCustomerAction,
  updateCustomerAction,
} from "@/actions/customer.actions"
import type { Customer, CreateCustomerInput } from "@/types/customer"
import { getQueryClient } from "@/lib/query-client"

export const customerCollection = createCollection(
  queryCollectionOptions<Customer>({
    queryKey: ["customers"],
    queryClient: getQueryClient(),
    queryFn: async (): Promise<Array<Customer>> => {
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
      const result = await updateCustomerAction(original.id, changes)
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
  })
)
