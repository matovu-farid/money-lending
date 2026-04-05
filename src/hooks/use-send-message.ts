"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { sendMessageAction } from "@/actions/chat.actions"
import { queryKeys } from "./query-keys"
import type { MessageWithSender, SendMessageInput } from "@/types"

export function useSendMessage(conversationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: SendMessageInput) => sendMessageAction(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.chat.messages(conversationId) })

      const previousMessages = queryClient.getQueryData<MessageWithSender[]>(
        queryKeys.chat.messages(conversationId)
      )

      const optimistic: MessageWithSender = {
        id: `optimistic-${Date.now()}`,
        conversationId: input.conversationId,
        senderId: "optimistic",
        senderName: "",
        content: input.content ?? "",
        mentions: input.mentions ?? [],
        attachments: [],
        deletedAt: null,
        createdAt: new Date(),
      }

      queryClient.setQueryData<MessageWithSender[]>(
        queryKeys.chat.messages(conversationId),
        (old) => (old ? [optimistic, ...old] : [optimistic])
      )

      return { previousMessages }
    },
    onError: (_err, _input, context) => {
      if (context?.previousMessages !== undefined) {
        queryClient.setQueryData(queryKeys.chat.messages(conversationId), context.previousMessages)
      }
      toast.error("Failed to send message")
    },
    onSuccess: (result) => {
      if ("error" in result) {
        toast.error(result.error)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chat.messages(conversationId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.chat.conversations() })
    },
  })
}
