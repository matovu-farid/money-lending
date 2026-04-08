"use client"

import { useState } from "react"
import { X, Loader2, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSearchUsers } from "@/hooks/use-search-users"
import { useCreateConversation } from "@/hooks/use-create-conversation"
import type { ChatUser } from "@/types"

interface NewConversationInlineProps {
  onCreated?: (conversationId: string) => void
  onCancel: () => void
}

export function NewConversationInline({
  onCreated,
  onCancel,
}: NewConversationInlineProps) {
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<ChatUser[]>([])
  const [groupName, setGroupName] = useState("")

  const { data: searchResults = [], isLoading: isSearching } = useSearchUsers(query)
  const { mutateAsync: createConversation, isPending } = useCreateConversation()

  const isGroup = selected.length >= 2

  function toggleUser(user: ChatUser) {
    setSelected((prev) => {
      const exists = prev.some((u) => u.id === user.id)
      return exists ? prev.filter((u) => u.id !== user.id) : [...prev, user]
    })
  }

  function removeUser(userId: string) {
    setSelected((prev) => prev.filter((u) => u.id !== userId))
  }

  async function handleSubmit() {
    if (selected.length === 0) return
    const result = await createConversation({
      participantIds: selected.map((u) => u.id),
      name: isGroup && groupName.trim() ? groupName.trim() : undefined,
    })
    if (result && "data" in result && result.data) {
      onCreated?.(result.data.id)
    }
  }

  const filteredResults = searchResults.filter(
    (u) => !selected.some((s) => s.id === u.id)
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onCancel}
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-sm font-semibold">New Conversation</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Selected users */}
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((user) => (
              <span
                key={user.id}
                className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs rounded-full px-2 py-0.5"
              >
                {user.name}
                <button
                  onClick={() => removeUser(user.id)}
                  className="hover:text-destructive transition-colors"
                  aria-label={`Remove ${user.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Search box */}
        <div className="relative">
          <Input
            placeholder="Search by name..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 text-sm"
            autoFocus
          />
          {isSearching && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Group name field */}
        {isGroup && (
          <Input
            placeholder="Group name (optional)"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            className="h-8 text-sm"
          />
        )}

        {/* Search results */}
        {query.length >= 2 && (
          <div className="border rounded-md overflow-hidden">
            {filteredResults.length === 0 && !isSearching && (
              <p className="text-xs text-muted-foreground text-center py-4">No users found</p>
            )}
            {filteredResults.map((user) => (
              <button
                key={user.id}
                onClick={() => toggleUser(user)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/50 transition-colors text-sm"
              >
                <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold shrink-0">
                  {user.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{user.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Actions pinned to bottom */}
      <div className="flex justify-end gap-2 p-3 border-t shrink-0">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={selected.length === 0 || isPending}
        >
          {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Start Chat
        </Button>
      </div>
    </div>
  )
}
