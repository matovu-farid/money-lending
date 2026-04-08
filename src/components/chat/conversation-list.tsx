"use client"

import { useState } from "react"
import { Plus, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useConversations } from "@/hooks/use-conversations"
import { ConversationItem } from "./conversation-item"
import { NewConversationInline } from "./new-conversation-inline"
import type { ConversationListItem } from "@/types"

interface ConversationListProps {
  currentUserId: string
  activeConversationId: string | null
  onSelectConversation: (id: string) => void
}

function matchesSearch(
  conversation: ConversationListItem,
  query: string,
  currentUserId: string
): boolean {
  const q = query.toLowerCase()
  if (conversation.name?.toLowerCase().includes(q)) return true
  return conversation.participants
    .filter((p) => p.id !== currentUserId)
    .some((p) => p.name.toLowerCase().includes(q))
}

export function ConversationList({
  currentUserId,
  activeConversationId,
  onSelectConversation,
}: ConversationListProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const { data: conversations = [], isLoading } = useConversations()

  const filtered = searchQuery
    ? conversations.filter((c) => matchesSearch(c, searchQuery, currentUserId))
    : conversations

  function handleCreated(id: string) {
    onSelectConversation(id)
    setDialogOpen(false)
  }

  // Show inline new-conversation panel instead of a modal dialog
  if (dialogOpen) {
    return (
      <NewConversationInline
        onCreated={handleCreated}
        onCancel={() => setDialogOpen(false)}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">Messages</h2>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={() => setDialogOpen(true)}
            aria-label="New conversation"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {isLoading && (
          <>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 animate-pulse">
                <div className="h-10 w-10 rounded-full bg-muted shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-32 bg-muted rounded" />
                  <div className="h-3 w-48 bg-muted rounded" />
                </div>
              </div>
            ))}
          </>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8 px-4">
            {searchQuery
              ? "No conversations match your search"
              : "No conversations yet. Start a new chat!"}
          </div>
        )}

        {!isLoading &&
          filtered.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              isActive={conversation.id === activeConversationId}
              currentUserId={currentUserId}
              onClick={() => onSelectConversation(conversation.id)}
            />
          ))}
      </div>
    </div>
  )
}
