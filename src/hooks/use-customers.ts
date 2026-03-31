"use client"

import { useQuery } from "@tanstack/react-query"
import { searchCustomersAction } from "@/actions/customer.actions"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import type { Customer, CustomerSearchParams } from "@/types"

const PAGE_SIZE = 20

export function useCustomers(params: CustomerSearchParams, page: number) {
  return useQuery<{ rows: Customer[]; total: number }>({
    queryKey: queryKeys.customers.search(params, page),
    queryFn: async () => {
      const result = await searchCustomersAction({ ...params, page, pageSize: PAGE_SIZE })
      return unwrapAction(result as { data: { rows: Customer[]; total: number } } | { error: string })
    },
  })
}
