"use client"

import { useQuery } from "@tanstack/react-query"
import { getCustomerAction } from "@/actions/customer.actions"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import type { Customer } from "@/types"

export function useCustomer(id: string) {
  return useQuery<Customer>({
    queryKey: queryKeys.customers.detail(id),
    queryFn: async () => {
      const result = await getCustomerAction(id)
      return unwrapAction(result as { data: Customer } | { error: string })
    },
    enabled: !!id,
  })
}
