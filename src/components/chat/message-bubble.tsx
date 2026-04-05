"use client"

import { useState } from "react"
import { Trash2, ImageOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ImageLightbox } from "./image-lightbox"
import { cn } from "@/lib/utils"
import { ROLE_LEVELS, type UserRole } from "@/types"
import type { MessageWithSender } from "@/types"

interface MessageBubbleProps {
  message: MessageWithSender
  currentUserId: string
  currentUserRole: UserRole
  onDelete?: (messageId: string) => void
}

function renderContent(content: string, mentions: string[]): React.ReactNode {
  if (!content) return null
  // Simple @mention highlighting — highlight @Word patterns
  const parts = content.split(/(@\S+)/g)
  return parts.map((part, i) => {
    if (part.startsWith("@")) {
      return (
        <span key={i} className="text-primary font-medium">
          {part}
        </span>
      )
    }
    return part
  })
}

export function MessageBubble({
  message,
  currentUserId,
  currentUserRole,
  onDelete,
}: MessageBubbleProps) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  const isOwn = message.senderId === currentUserId
  const isDeleted = !!message.deletedAt
  const canDelete =
    isOwn || ROLE_LEVELS[currentUserRole] >= ROLE_LEVELS.admin

  const timestamp = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })

  return (
    <div
      className={cn(
        "group flex gap-2 mb-3",
        isOwn ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar (only for others) */}
      {!isOwn && (
        <div className="h-7 w-7 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-semibold shrink-0 mt-1">
          {message.senderName
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </div>
      )}

      <div className={cn("flex flex-col max-w-[70%]", isOwn ? "items-end" : "items-start")}>
        {/* Sender name for others */}
        {!isOwn && (
          <span className="text-xs text-muted-foreground mb-0.5 px-1">{message.senderName}</span>
        )}

        <div className="relative group/bubble">
          <div
            className={cn(
              "rounded-2xl px-3 py-2 text-sm",
              isOwn
                ? "bg-primary text-primary-foreground rounded-tr-sm"
                : "bg-muted text-foreground rounded-tl-sm",
              isDeleted && "opacity-60"
            )}
          >
            {isDeleted ? (
              <span className="italic text-muted-foreground text-xs">
                This message was deleted
              </span>
            ) : (
              <>
                {/* Text content */}
                {message.content && (
                  <p className="whitespace-pre-wrap break-words leading-relaxed">
                    {renderContent(message.content, message.mentions)}
                  </p>
                )}

                {/* Attachments */}
                {message.attachments.length > 0 && (
                  <div
                    className={cn(
                      "flex flex-wrap gap-1.5",
                      message.content ? "mt-2" : ""
                    )}
                  >
                    {message.attachments.map((att) => (
                      <div key={att.id}>
                        {att.expired ? (
                          <div className="h-24 w-24 rounded-md bg-muted flex flex-col items-center justify-center gap-1 border border-dashed">
                            <ImageOff className="h-6 w-6 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground text-center px-1">
                              Expired
                            </span>
                          </div>
                        ) : (
                          <button
                            onClick={() => setLightboxSrc(att.data)}
                            className="block hover:opacity-90 transition-opacity"
                            aria-label={`View ${att.fileName}`}
                          >
                            <img
                              src={att.data}
                              alt={att.fileName}
                              className="h-24 w-24 object-cover rounded-md"
                            />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Delete button */}
          {!isDeleted && canDelete && onDelete && (
            <button
              onClick={() => onDelete(message.id)}
              className={cn(
                "absolute top-1 opacity-0 group-hover/bubble:opacity-100 transition-opacity",
                "h-6 w-6 rounded-full bg-background border shadow-sm flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground hover:border-destructive",
                isOwn ? "-left-8" : "-right-8"
              )}
              aria-label="Delete message"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>

        <span className="text-xs text-muted-foreground mt-0.5 px-1">{timestamp}</span>
      </div>

      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </div>
  )
}
