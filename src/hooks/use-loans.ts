"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import { listLoansWithOverdueAction } from "@/actions/loan.actions"
import type { LoanListEntry } from "@/types"

export function useLoans() {
  return useQuery<LoanListEntry[]>({
    queryKey: queryKeys.loans.all,
    queryFn: async () => {
      const result = await listLoansWithOverdueAction()
      return unwrapAction<LoanListEntry[]>(
        result as { data: LoanListEntry[] } | { error: string }
      )
    },
  })
}
