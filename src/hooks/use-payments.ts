"use client"

import { useQuery } from "@tanstack/react-query"
import { listPaymentsAction, getPaymentsByLoanAction } from "@/actions/payment.actions"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import type { Payment, PaymentWithCustomer, ListPaymentsInput } from "@/types"

const PAGE_SIZE = 25

export type PaymentFilterParams = Omit<ListPaymentsInput, "page" | "pageSize">

export function usePayments(
  params: PaymentFilterParams,
  page: number,
  enabled = true,
) {
  return useQuery<{ rows: PaymentWithCustomer[]; total: number }>({
    queryKey: queryKeys.payments.list(params, page),
    queryFn: async () => {
      const result = await listPaymentsAction({
        ...params,
        page,
        pageSize: PAGE_SIZE,
      })
      return unwrapAction(result as { data: { rows: PaymentWithCustomer[]; total: number } } | { error: string })
    },
    staleTime: 30_000,
    enabled,
  })
}

export function useLoanPayments(loanId: string, enabled = true, initialData?: Payment[]) {
  return useQuery<Payment[]>({
    queryKey: queryKeys.payments.byLoan(loanId),
    queryFn: async () => {
      const result = await getPaymentsByLoanAction(loanId)
      return unwrapAction(result as { data: Payment[] } | { error: string })
    },
    enabled,
    initialData,
    initialDataUpdatedAt: Date.now(),
    staleTime: 30_000,
  })
}
