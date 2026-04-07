"use client"

import { useQuery } from "@tanstack/react-query"
import { searchUsersAction } from "@/actions/chat.actions"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import { useDebouncedValue } from "./use-debounced-value"
import type { ChatUser } from "@/types"

export function useSearchUsers(query: string) {
  const debouncedQuery = useDebouncedValue(query, 250)

  return useQuery<ChatUser[]>({
    queryKey: queryKeys.chat.users(debouncedQuery),
    queryFn: async () => {
      const result = await searchUsersAction(debouncedQuery)
      return unwrapAction(result as { data: ChatUser[] } | { error: string })
    },
    enabled: debouncedQuery.length >= 2,
  })
}
