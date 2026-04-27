"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  createCustomerAction,
  updateCustomerAction,
} from "@/actions/customer.actions"
import type { Customer, CreateCustomerInput, UpdateCustomerInput } from "@/types/customer"
import { shapeUrl, shapeOnError } from "@/lib/electric"

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
