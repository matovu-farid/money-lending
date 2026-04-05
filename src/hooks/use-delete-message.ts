"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { deleteMessageAction } from "@/actions/chat.actions"
import { queryKeys } from "./query-keys"
import type { MessageWithSender } from "@/types"

export function useDeleteMessage(conversationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (messageId: string) => deleteMessageAction(messageId),
    onMutate: async (messageId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.chat.messages(conversationId) })

      const previousMessages = queryClient.getQueryData<MessageWithSender[]>(
        queryKeys.chat.messages(conversationId)
      )

      // Optimistic removal: set deletedAt on the message
      queryClient.setQueryData<MessageWithSender[]>(
        queryKeys.chat.messages(conversationId),
        (old) =>
          old
            ? old.map((msg) =>
                msg.id === messageId ? { ...msg, deletedAt: new Date() } : msg
              )
            : old
      )

      return { previousMessages }
    },
    onError: (_err, _messageId, context) => {
      if (context?.previousMessages !== undefined) {
        queryClient.setQueryData(queryKeys.chat.messages(conversationId), context.previousMessages)
      }
      toast.error("Failed to delete message")
    },
    onSuccess: (result) => {
      if ("error" in result) {
        toast.error(result.error)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chat.messages(conversationId) })
    },
  })
}
