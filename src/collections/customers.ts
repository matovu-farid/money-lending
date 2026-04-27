"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  changeCustomerStatusAction,
  createCustomerAction,
  updateCustomerAction,
} from "@/actions/customer.actions"
import type {
  Customer,
  CreateCustomerInput,
  CustomerStatus,
  UpdateCustomerInput,
} from "@/types/customer"
import { shapeUrl, shapeOnError } from "@/lib/electric"

// Side-channel for status-change reasons. The collection's `onUpdate` only
// sees the diff between original/changes, but a status change requires a
// reason that lives off-record (audit log only). We stash it here keyed by
// customer id so the handler can pull it out when it sees `status` changed.
const pendingStatusInputs = new Map<string, { status: CustomerStatus; reason: string }>()

export const customerCollection = createCollection(
  electricCollectionOptions<Customer>({
    id: "customers",
    getKey: (customer) => customer.id,
    shapeOptions: {
      url: shapeUrl("customers"),
      columnMapper: snakeCamelMapper(),
      onError: shapeOnError("customers"),
    },
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
      return { txid: result.txid }
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]

      // Status change path — requires reason + audit log
      if (changes.status !== undefined) {
        const pending = pendingStatusInputs.get(original.id)
        pendingStatusInputs.delete(original.id)
        const reason = pending?.reason
        const newStatus = (pending?.status ?? changes.status) as CustomerStatus
        if (!reason) {
          throw new Error(
            "Customer status changes must go through changeCustomerStatusWithInput",
          )
        }
        const result = await changeCustomerStatusAction({
          customerId: original.id,
          newStatus,
          reason,
        })
        if ("error" in result) {
          throw new Error(result.error)
        }
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
      return { txid: result.txid }
    },
  })
)

/**
 * Optimistic status change. Updates `customerCollection` immediately so the UI
 * reflects the new status, while the collection's `onUpdate` dispatches
 * `changeCustomerStatusAction` (with the reason supplied here) on the server.
 *
 * Throws if the server rejects the change so callers can surface a toast.
 */
export function changeCustomerStatusWithInput(
  customerId: string,
  newStatus: CustomerStatus,
  reason: string,
) {
  pendingStatusInputs.set(customerId, { status: newStatus, reason })
  try {
    customerCollection.update(customerId, (draft) => {
      draft.status = newStatus
    })
  } catch (err) {
    pendingStatusInputs.delete(customerId)
    throw err
  }
}
