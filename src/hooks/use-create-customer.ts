"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createCustomerAction } from "@/actions/customer.actions"
import { queryKeys } from "./query-keys"
import type { Customer, CreateCustomerInput } from "@/types"

export function useCreateCustomer() {
  const queryClient = useQueryClient()
  const router = useRouter()

  return useMutation({
    mutationFn: (input: CreateCustomerInput) => createCustomerAction(input),
    onMutate: async (input) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: queryKeys.customers.all })

      // Snapshot all customer search caches for rollback
      const previousSearches = queryClient.getQueriesData<{
        rows: Customer[]
        total: number
      }>({ queryKey: queryKeys.customers.all })

      // Create an optimistic customer entry
      const optimistic: Customer = {
        id: `optimistic-${crypto.randomUUID()}`,
        fullName: input.fullName,
        nin: input.nin,
        contact: input.contact,
        address: input.address,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Add to all matching search caches (skip detail caches which are plain Customer objects)
      queryClient.setQueriesData<{ rows: Customer[]; total: number }>(
        { queryKey: queryKeys.customers.all },
        (old) => {
          if (!old || !Array.isArray(old.rows)) return old
          return {
            rows: [optimistic, ...old.rows],
            total: old.total + 1,
          }
        },
      )

      return { previousSearches, optimisticId: optimistic.id }
    },
    onError: (_err, _input, context) => {
      // Rollback all search caches
      if (context?.previousSearches) {
        for (const [queryKey, data] of context.previousSearches) {
          queryClient.setQueryData(queryKey, data)
        }
      }
      toast.error("Failed to create customer")
    },
    onSuccess: (result, _input, context) => {
      if ("error" in result) {
        // Server-side validation error — rollback
        if (context?.previousSearches) {
          for (const [queryKey, data] of context.previousSearches) {
            queryClient.setQueryData(queryKey, data)
          }
        }
        toast.error(result.error)
        return
      }

      // Seed the detail cache so the profile page loads instantly
      queryClient.setQueryData(
        queryKeys.customers.detail(result.data.id),
        result.data,
      )

      toast.success("Customer registered successfully")
      router.push(`/customers/${result.data.id}`)
    },
    onSettled: () => {
      // Refetch search lists but NOT the detail cache (which was seeded in onSuccess)
      queryClient.invalidateQueries({
        queryKey: queryKeys.customers.all,
        predicate: (query) =>
          // Only invalidate search queries (length > 2), not detail queries (length === 2)
          query.queryKey.length > 2,
      })
    },
  })
}
