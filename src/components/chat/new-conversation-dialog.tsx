"use client"

import { useState } from "react"
import { X, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useSearchUsers } from "@/hooks/use-search-users"
import { useCreateConversation } from "@/hooks/use-create-conversation"
import { cn } from "@/lib/utils"
import type { ChatUser } from "@/types"

interface NewConversationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (conversationId: string) => void
}

export function NewConversationDialog({
  open,
  onOpenChange,
  onCreated,
}: NewConversationDialogProps) {
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
      handleClose()
    }
  }

  function handleClose() {
    setQuery("")
    setSelected([])
    setGroupName("")
    onOpenChange(false)
  }

  const filteredResults = searchResults.filter(
    (u) => !selected.some((s) => s.id === u.id)
  )

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Conversation</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Selected users */}
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selected.map((user) => (
                <span
                  key={user.id}
                  className="inline-flex items-center gap-1 bg-primary/10 text-primary text-sm rounded-full px-2.5 py-0.5"
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
              autoFocus
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Search results */}
          {query.length >= 2 && (
            <div className="border rounded-md overflow-hidden max-h-48 overflow-y-auto">
              {filteredResults.length === 0 && !isSearching && (
                <p className="text-sm text-muted-foreground text-center py-4">No users found</p>
              )}
              {filteredResults.map((user) => (
                <button
                  key={user.id}
                  onClick={() => toggleUser(user)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors text-sm"
                >
                  <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold shrink-0">
                    {user.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium">{user.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Group name field */}
          {isGroup && (
            <Input
              placeholder="Group name (optional)"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handleClose} disabled={isPending}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={selected.length === 0 || isPending}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Start Chat
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
