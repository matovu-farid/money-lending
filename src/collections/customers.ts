"use client"

import { createCollection, BasicIndex } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  changeCustomerStatusAction,
  createCustomerAction,
  updateCustomerAction,
  listCustomersAction,
} from "@/actions/customer.actions"
import type {
  CreateCustomerInput,
  CustomerStatus,
  UpdateCustomerInput,
} from "@/types/customer"
import { customerSchema } from "@/lib/schemas/collections"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { emitTableChange } from "@/lib/table-events"

/**
 * Metadata routed through `customerCollection.update(id, { metadata }, draft)`.
 * The status-change path needs an audit `reason` that isn't a column, so the
 * caller passes it via metadata and the handler dispatches the dedicated
 * server action with reason + status.
 */
type CustomerUpdateMetadata = {
  intent: "change-status"
  reason: string
}

export const customerCollection = createCollection(
  queryCollectionOptions({
    id: "customers",
    schema: customerSchema,
    getKey: (customer) => customer.id,
    autoIndex: "eager",
    defaultIndexType: BasicIndex,
    queryKey: [...queryKeys.customers.all],
    queryClient: getQueryClient(),
    queryFn: async () => {
      const result = await listCustomersAction()
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
    staleTime: 30_000,
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
      emitTableChange("customers")
      return { txid: result.txid }
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes, metadata } = transaction.mutations[0]
      const meta = metadata as CustomerUpdateMetadata | undefined

      // Status change path — requires reason + audit log
      if (meta?.intent === "change-status") {
        const newStatus = changes.status as CustomerStatus | undefined
        if (!newStatus) {
          throw new Error(
            "change-status update must include a draft.status change",
          )
        }
        const result = await changeCustomerStatusAction({
          customerId: original.id,
          newStatus,
          reason: meta.reason,
        })
        if ("error" in result) {
          throw new Error(result.error)
        }
        emitTableChange("customers")
        return { txid: result.txid }
      }

      // Regular profile update path
      const input: UpdateCustomerInput = {}
      if (changes.fullName !== undefined) input.fullName = changes.fullName
      if (changes.nin !== undefined) input.nin = changes.nin
      if (changes.contact !== undefined) input.contact = changes.contact
      if (changes.address !== undefined) input.address = changes.address
      const result = await updateCustomerAction(original.id, input)
      if ("error" in result) {
        throw new Error(result.error)
      }
      emitTableChange("customers")
      return { txid: result.txid }
    },
  })
)
