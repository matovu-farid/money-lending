"use client"

import { useQuery } from "@tanstack/react-query"
import { getMessagesAction } from "@/actions/chat.actions"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import type { MessageWithSender } from "@/types"

export function useMessages(conversationId: string, cursor?: string) {
  return useQuery<MessageWithSender[]>({
    queryKey: queryKeys.chat.messages(conversationId),
    queryFn: async () => {
      const result = await getMessagesAction(conversationId, cursor)
      return unwrapAction(result as { data: MessageWithSender[] } | { error: string })
    },
    enabled: !!conversationId,
    refetchInterval: 5_000,
  })
}
