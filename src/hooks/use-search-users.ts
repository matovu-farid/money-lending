"use client"

import { useQuery } from "@tanstack/react-query"
import { searchUsersAction } from "@/actions/chat.actions"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import type { ChatUser } from "@/types"

export function useSearchUsers(query: string) {
  return useQuery<ChatUser[]>({
    queryKey: queryKeys.chat.users(query),
    queryFn: async () => {
      const result = await searchUsersAction(query)
      return unwrapAction(result as { data: ChatUser[] } | { error: string })
    },
    enabled: query.length >= 2,
  })
}
