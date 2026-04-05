"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import type { ChatUser } from "@/types"

interface MentionPopoverProps {
  users: ChatUser[]
  query: string
  onSelect: (user: ChatUser) => void
  selectedIndex: number
  onSelectedIndexChange: (index: number) => void
}

export function MentionPopover({
  users,
  query,
  onSelect,
  selectedIndex,
  onSelectedIndexChange,
}: MentionPopoverProps) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  if (users.length === 0) return null

  const filtered = query
    ? users.filter((u) => u.name.toLowerCase().includes(query.toLowerCase()))
    : users

  if (filtered.length === 0) return null

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1 bg-popover border rounded-md shadow-md overflow-y-auto max-h-48 z-50"
      role="listbox"
      aria-label="Mention suggestions"
    >
      {filtered.map((user, index) => (
        <button
          key={user.id}
          role="option"
          aria-selected={index === selectedIndex}
          onClick={() => onSelect(user)}
          onMouseEnter={() => onSelectedIndexChange(index)}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors",
            index === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"
          )}
        >
          <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold shrink-0">
            {user.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
          </div>
          <span className="font-medium">{user.name}</span>
          <span className="text-muted-foreground text-xs capitalize ml-1">{user.role}</span>
        </button>
      ))}
    </div>
  )
}
