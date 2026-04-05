"use client"

import { useEffect, useRef, useState } from "react"
import { Users } from "lucide-react"
import { useMessages } from "@/hooks/use-messages"
import { useSendMessage } from "@/hooks/use-send-message"
import { useDeleteMessage } from "@/hooks/use-delete-message"
import { markAsReadAction, getConversationParticipantsAction } from "@/actions/chat.actions"
import { MessageBubble } from "./message-bubble"
import { MessageInput } from "./message-input"
import { cn } from "@/lib/utils"
import type { UserRole, ChatUser, ConversationListItem } from "@/types"
import type { SendMessageInput } from "@/types"

interface MessageThreadProps {
  conversation: ConversationListItem
  currentUserId: string
  currentUserRole: UserRole
}

export function MessageThread({
  conversation,
  currentUserId,
  currentUserRole,
}: MessageThreadProps) {
  const { data: messages = [], isLoading } = useMessages(conversation.id)
  const { mutate: sendMessage, isPending: isSending } = useSendMessage(conversation.id)
  const { mutate: deleteMessage } = useDeleteMessage(conversation.id)
  const [participants, setParticipants] = useState<ChatUser[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const prevMessageCount = useRef(0)

  // Load full participants list
  useEffect(() => {
    getConversationParticipantsAction(conversation.id).then((result) => {
      if (result && "data" in result && result.data) {
        setParticipants(result.data)
      }
    })
  }, [conversation.id])

  // Mark as read on open
  useEffect(() => {
    markAsReadAction(conversation.id)
  }, [conversation.id])

  // Scroll to bottom and mark as read when new messages arrive
  useEffect(() => {
    if (messages.length > prevMessageCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
      if (messages.length > 0 && prevMessageCount.current > 0) {
        markAsReadAction(conversation.id)
      }
    }
    prevMessageCount.current = messages.length
  }, [messages.length, conversation.id])

  // Scroll to bottom on initial load
  useEffect(() => {
    if (!isLoading && messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" })
    }
  }, [isLoading])

  function handleSend(
    content: string,
    mentions: string[],
    attachments: { data: string; mimeType: string; fileName: string; fileSize: number }[]
  ) {
    const input: SendMessageInput = {
      conversationId: conversation.id,
      content,
      mentions,
      attachments,
    }
    sendMessage(input)
  }

  const headerTitle = conversation.name
    ? conversation.name
    : conversation.participants
        .filter((p) => p.id !== currentUserId)
        .map((p) => p.name)
        .join(", ") || "Conversation"

  const participantCount = conversation.participants.length

  // Messages sorted oldest first for display
  const sortedMessages = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center gap-3 shrink-0">
        <div className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold shrink-0">
          {headerTitle.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{headerTitle}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Users className="h-3 w-3" />
            {participantCount} participant{participantCount !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {isLoading && (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "flex gap-2 animate-pulse",
                  i % 2 === 0 ? "flex-row" : "flex-row-reverse"
                )}
              >
                <div className="h-7 w-7 rounded-full bg-muted shrink-0" />
                <div className="space-y-1">
                  <div className="h-3 w-24 bg-muted rounded" />
                  <div className="h-10 w-48 bg-muted rounded-2xl" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && sortedMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-muted-foreground text-sm">
              No messages yet. Say hello!
            </p>
          </div>
        )}

        {!isLoading &&
          sortedMessages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              onDelete={deleteMessage}
            />
          ))}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <MessageInput
        participants={participants.filter((p) => p.id !== currentUserId)}
        onSend={handleSend}
        disabled={isSending}
      />
    </div>
  )
}
