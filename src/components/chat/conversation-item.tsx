"use client"

import { cn } from "@/lib/utils"
import type { ConversationListItem } from "@/types"

interface ConversationItemProps {
  conversation: ConversationListItem
  isActive: boolean
  currentUserId: string
  onClick: () => void
}

function getDisplayName(conversation: ConversationListItem, currentUserId: string): string {
  if (conversation.name) return conversation.name
  const others = conversation.participants.filter((p) => p.id !== currentUserId)
  if (others.length === 0) return "Just you"
  return others.map((p) => p.name).join(", ")
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

function formatTimestamp(date: Date): string {
  const d = new Date(date)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" })
  return d.toLocaleDateString([], { month: "short", day: "numeric" })
}

export function ConversationItem({
  conversation,
  isActive,
  currentUserId,
  onClick,
}: ConversationItemProps) {
  const displayName = getDisplayName(conversation, currentUserId)
  const initials = getInitials(displayName)
  const timestamp = conversation.lastMessage
    ? formatTimestamp(conversation.lastMessage.createdAt)
    : conversation.updatedAt
    ? formatTimestamp(conversation.updatedAt)
    : ""

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors rounded-md",
        isActive
          ? "bg-accent text-accent-foreground"
          : "hover:bg-muted/50"
      )}
    >
      {/* Avatar */}
      <div className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold shrink-0">
        {initials}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="text-sm font-medium truncate">{displayName}</span>
          <span className="text-xs text-muted-foreground shrink-0">{timestamp}</span>
        </div>
        {conversation.lastMessage && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {conversation.lastMessage.senderName
              ? `${conversation.lastMessage.senderName}: `
              : ""}
            {conversation.lastMessage.content || "Sent an image"}
          </p>
        )}
      </div>

      {/* Unread badge */}
      {conversation.unreadCount > 0 && (
        <div className="h-5 min-w-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center px-1 shrink-0">
          {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
        </div>
      )}
    </button>
  )
}
