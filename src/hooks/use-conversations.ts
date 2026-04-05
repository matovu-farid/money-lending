"use client"

import { useQuery } from "@tanstack/react-query"
import { getConversationsAction } from "@/actions/chat.actions"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import type { ConversationListItem } from "@/types"

export function useConversations() {
  return useQuery<ConversationListItem[]>({
    queryKey: queryKeys.chat.conversations(),
    queryFn: async () => {
      const result = await getConversationsAction()
      return unwrapAction(result as { data: ConversationListItem[] } | { error: string })
    },
    refetchInterval: 30_000,
  })
}
