"use client"

import { useRef, useState, useCallback, KeyboardEvent, ChangeEvent } from "react"
import { Paperclip, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { MentionPopover } from "./mention-popover"
import { cn } from "@/lib/utils"
import type { ChatUser } from "@/types"

interface Attachment {
  data: string
  mimeType: string
  fileName: string
  fileSize: number
  preview: string
}

interface MessageInputProps {
  participants: ChatUser[]
  onSend: (content: string, mentions: string[], attachments: Omit<Attachment, "preview">[]) => void
  disabled?: boolean
}

const MAX_ATTACHMENTS = 3
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export function MessageInput({ participants, onSend, disabled }: MessageInputProps) {
  const [content, setContent] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStartIndex, setMentionStartIndex] = useState<number>(-1)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const filteredParticipants = mentionQuery !== null
    ? participants.filter((u) => u.name.toLowerCase().includes(mentionQuery.toLowerCase()))
    : []

  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setContent(val)
    autoResize()

    // Detect @ mention
    const cursor = e.target.selectionStart ?? 0
    const textBefore = val.slice(0, cursor)
    const atMatch = textBefore.match(/@(\w*)$/)
    if (atMatch) {
      setMentionQuery(atMatch[1])
      setMentionStartIndex(cursor - atMatch[0].length)
      setSelectedMentionIndex(0)
    } else {
      setMentionQuery(null)
      setMentionStartIndex(-1)
    }
  }

  function handleSelectMention(user: ChatUser) {
    if (mentionStartIndex < 0) return
    const before = content.slice(0, mentionStartIndex)
    const cursor = textareaRef.current?.selectionStart ?? content.length
    const after = content.slice(cursor)
    const newContent = `${before}@${user.name} ${after}`
    setContent(newContent)
    setMentionQuery(null)
    setMentionStartIndex(-1)
    setTimeout(() => {
      autoResize()
      textareaRef.current?.focus()
    }, 0)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && filteredParticipants.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedMentionIndex((i) => Math.min(i + 1, filteredParticipants.length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedMentionIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        handleSelectMention(filteredParticipants[selectedMentionIndex])
        return
      }
      if (e.key === "Escape") {
        setMentionQuery(null)
        return
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return

    const remaining = MAX_ATTACHMENTS - attachments.length
    if (remaining <= 0) {
      toast.error(`Maximum ${MAX_ATTACHMENTS} attachments allowed`)
      return
    }

    const toProcess = files.slice(0, remaining)
    const newAttachments: Attachment[] = []

    for (const file of toProcess) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} exceeds the 5MB limit`)
        continue
      }
      const data = await fileToBase64(file)
      newAttachments.push({
        data,
        mimeType: file.type,
        fileName: file.name,
        fileSize: file.size,
        preview: URL.createObjectURL(file),
      })
    }

    setAttachments((prev) => [...prev, ...newAttachments])
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => {
      const next = [...prev]
      URL.revokeObjectURL(next[index].preview)
      next.splice(index, 1)
      return next
    })
  }

  function handleSend() {
    const trimmed = content.trim()
    if (!trimmed && attachments.length === 0) return

    // Extract @mentions from content
    const mentionMatches = trimmed.match(/@([\w\s]+?)(?=\s|$)/g) ?? []
    const mentionedNames = mentionMatches.map((m) => m.slice(1).trim())
    const mentions = participants
      .filter((p) => mentionedNames.includes(p.name))
      .map((p) => p.id)

    onSend(
      trimmed,
      mentions,
      attachments.map(({ data, mimeType, fileName, fileSize }) => ({
        data,
        mimeType,
        fileName,
        fileSize,
      }))
    )

    setContent("")
    setAttachments([])
    setMentionQuery(null)
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }

  const canSend = (content.trim().length > 0 || attachments.length > 0) && !disabled

  return (
    <div className="border-t bg-background p-3">
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {attachments.map((att, i) => (
            <div key={i} className="relative group">
              <img
                src={att.preview}
                alt={att.fileName}
                className="h-16 w-16 object-cover rounded-md border"
              />
              <button
                onClick={() => removeAttachment(i)}
                className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={`Remove ${att.fileName}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="relative flex items-end gap-2">
        {/* Mention popover */}
        {mentionQuery !== null && filteredParticipants.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-2">
            <MentionPopover
              users={filteredParticipants}
              query={mentionQuery}
              onSelect={handleSelectMention}
              selectedIndex={selectedMentionIndex}
              onSelectedIndexChange={setSelectedMentionIndex}
            />
          </div>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-muted-foreground"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
          aria-label="Attach image"
          type="button"
        >
          <Paperclip className="h-4 w-4" />
        </Button>

        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... Use @ to mention someone"
          disabled={disabled}
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:opacity-50 min-h-[36px] max-h-[160px] overflow-y-auto"
          )}
        />

        <Button
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
          type="button"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileChange}
        aria-hidden
      />
    </div>
  )
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
