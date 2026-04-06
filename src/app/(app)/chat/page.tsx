"use client"

import { useState } from "react"
import { useSession } from "@/lib/auth-client"
import { ConversationList } from "@/components/chat/conversation-list"
import { MessageThread } from "@/components/chat/message-thread"
import { useConversations } from "@/hooks/use-conversations"
import type { UserRole } from "@/types"
import type { ConversationListItem } from "@/types"

export default function ChatPage() {
  const { data: session } = useSession()
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const { data: conversations = [] } = useConversations()

  const user = session?.user
  const currentUserId = user?.id ?? ""
  const currentUserRole = (user?.role ?? "unassigned") as UserRole

  const activeConversation = conversations.find(
    (c: ConversationListItem) => c.id === activeConversationId
  ) ?? null

  if (!currentUserId) {
    return null
  }

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">
      {/* Left panel: conversation list */}
      <div className="w-80 border-r flex flex-col shrink-0">
        <ConversationList
          currentUserId={currentUserId}
          activeConversationId={activeConversationId}
          onSelectConversation={setActiveConversationId}
        />
      </div>

      {/* Right panel: message thread */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeConversation ? (
          <MessageThread
            conversation={activeConversation}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <svg
                className="h-8 w-8 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
                />
              </svg>
            </div>
            <p className="font-medium text-foreground mb-1">Select a conversation</p>
            <p className="text-sm text-muted-foreground">
              Choose a conversation from the list or start a new one.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
