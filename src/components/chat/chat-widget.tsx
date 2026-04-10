"use client"

import { useState } from "react"
import { MessageSquare, X, ArrowLeft } from "lucide-react"
import { useSession } from "@/lib/auth-client"
import { useConversations } from "@/hooks/use-conversations"
import { ConversationList } from "./conversation-list"
import { MessageThread } from "./message-thread"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { UserRole, ConversationListItem } from "@/types"

export function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const { data: session } = useSession()
  const { data: conversations = [] } = useConversations()

  const user = session?.user
  const currentUserId = user?.id ?? ""
  const currentUserRole = (user?.role ?? "unassigned") as UserRole

  const activeConversation = conversations.find(
    (c: ConversationListItem) => c.id === activeConversationId
  ) ?? null

  const totalUnread = conversations.reduce(
    (sum: number, c: ConversationListItem) => sum + (c.unreadCount ?? 0),
    0
  )

  if (!currentUserId) return null

  return (
    <>
      {/* Floating chat panel */}
      {open && (
        <div className="fixed bottom-20 right-4 z-50 w-[380px] h-[520px] bg-background border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-200 md:bottom-6 md:right-6">
          {/* Panel header */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b bg-muted/30 shrink-0">
            {activeConversation && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => setActiveConversationId(null)}
                aria-label="Back to conversations"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <h2 className="text-sm font-semibold flex-1 truncate">
              {activeConversation
                ? (activeConversation.name ||
                    activeConversation.participants
                      .filter((p) => p.id !== currentUserId)
                      .map((p) => p.name)
                      .join(", ") ||
                    "Conversation")
                : "Messages"}
            </h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Panel body */}
          <div className="flex-1 overflow-hidden">
            {activeConversation ? (
              <MessageThread
                conversation={activeConversation}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
              />
            ) : (
              <ConversationList
                currentUserId={currentUserId}
                activeConversationId={activeConversationId}
                onSelectConversation={setActiveConversationId}
              />
            )}
          </div>
        </div>
      )}

      {/* Floating action button */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "fixed bottom-20 right-4 z-50 h-12 w-12 rounded-full shadow-lg flex items-center justify-center transition-colors md:bottom-6 md:right-6",
          open
            ? "bg-muted text-muted-foreground hover:bg-muted/80"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        )}
        aria-label={open ? "Close chat" : "Open chat"}
      >
        {open ? (
          <X className="h-5 w-5" />
        ) : (
          <>
            <MessageSquare className="h-5 w-5" />
            {totalUnread > 0 && (
              <Badge variant="destructive" className="absolute -top-1 -right-1 rounded-full min-w-5 justify-center px-1 bg-destructive text-destructive-foreground">
                {totalUnread > 99 ? "99+" : totalUnread}
              </Badge>
            )}
          </>
        )}
      </button>
    </>
  )
}
