"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { createConversationAction } from "@/actions/chat.actions"
import { queryKeys } from "./query-keys"
import type { CreateConversationInput } from "@/types"

export function useCreateConversation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateConversationInput) => createConversationAction(input),
    onError: () => {
      toast.error("Failed to create conversation")
    },
    onSuccess: (result) => {
      if ("error" in result) {
        toast.error(result.error)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chat.conversations() })
    },
  })
}
