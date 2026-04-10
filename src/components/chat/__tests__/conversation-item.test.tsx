// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import "@testing-library/jest-dom/vitest"
import { render, screen } from "@testing-library/react"
import { ConversationItem } from "../conversation-item"
import type { ConversationListItem } from "@/types"

function makeConversation(overrides: Partial<ConversationListItem> = {}): ConversationListItem {
  return {
    id: "conv-1",
    name: null,
    participants: [
      { id: "user-1", name: "Alice" },
      { id: "user-2", name: "Bob" },
    ],
    lastMessage: {
      content: "Hey there",
      senderName: "Alice",
      createdAt: new Date("2026-04-10T10:00:00"),
    },
    unreadCount: 0,
    updatedAt: new Date("2026-04-10T10:00:00"),
    ...overrides,
  }
}

describe("ConversationItem", () => {
  it("shows participant names when no conversation name", () => {
    render(
      <ConversationItem
        conversation={makeConversation()}
        isActive={false}
        currentUserId="user-1"
        onClick={() => {}}
      />
    )
    // Current user is filtered out, so only "Bob" shows
    expect(screen.getByText("Bob")).toBeInTheDocument()
  })

  it("shows conversation name when set", () => {
    render(
      <ConversationItem
        conversation={makeConversation({ name: "Team Chat" })}
        isActive={false}
        currentUserId="user-1"
        onClick={() => {}}
      />
    )
    expect(screen.getByText("Team Chat")).toBeInTheDocument()
  })

  it("shows last message preview", () => {
    render(
      <ConversationItem
        conversation={makeConversation()}
        isActive={false}
        currentUserId="user-1"
        onClick={() => {}}
      />
    )
    expect(screen.getByText(/Alice:.*Hey there/)).toBeInTheDocument()
  })

  it("shows unread badge when unreadCount > 0", () => {
    render(
      <ConversationItem
        conversation={makeConversation({ unreadCount: 5 })}
        isActive={false}
        currentUserId="user-1"
        onClick={() => {}}
      />
    )
    expect(screen.getByText("5")).toBeInTheDocument()
  })

  it("caps unread badge at 99+", () => {
    render(
      <ConversationItem
        conversation={makeConversation({ unreadCount: 150 })}
        isActive={false}
        currentUserId="user-1"
        onClick={() => {}}
      />
    )
    expect(screen.getByText("99+")).toBeInTheDocument()
  })

  it("does not show unread badge when unreadCount is 0", () => {
    render(
      <ConversationItem
        conversation={makeConversation({ unreadCount: 0 })}
        isActive={false}
        currentUserId="user-1"
        onClick={() => {}}
      />
    )
    expect(screen.queryByText("0")).not.toBeInTheDocument()
  })
})
