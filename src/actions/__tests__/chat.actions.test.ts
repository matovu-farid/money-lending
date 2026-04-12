import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// ---------- Mocks ----------

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

vi.mock("@/lib/action-utils", () => ({
  getErrorTag: (error: unknown): string | undefined => {
    if (error == null || typeof error !== "object") return undefined
    if ("_tag" in error && typeof (error as any)._tag === "string") {
      return (error as any)._tag
    }
    const cause = (error as any)[Symbol.for("effect/Runtime/FiberFailure/Cause")] ?? (error as any).cause
    if (cause && typeof cause === "object") {
      const inner = cause.failure ?? cause.error
      if (inner && typeof inner === "object" && "_tag" in inner) {
        return inner._tag as string
      }
    }
    return undefined
  },
  getErrorField: (error: unknown, field: string): unknown => {
    if (error == null || typeof error !== "object") return undefined
    if ("_tag" in error && field in error) return (error as any)[field]
    const cause = (error as any)[Symbol.for("effect/Runtime/FiberFailure/Cause")] ?? (error as any).cause
    if (cause && typeof cause === "object") {
      const inner = cause.failure ?? cause.error
      if (inner && typeof inner === "object" && field in inner) {
        return (inner as any)[field]
      }
    }
    return undefined
  },
}))

vi.mock("@/services/chat.service", () => ({
  createConversation: vi.fn(),
  getConversations: vi.fn(),
  getMessages: vi.fn(),
  sendMessage: vi.fn(),
  deleteMessage: vi.fn(),
  markAsRead: vi.fn(),
  searchUsers: vi.fn(),
  addParticipants: vi.fn(),
  getConversationParticipants: vi.fn(),
  getAttachmentData: vi.fn(),
}))

// ---------- Imports ----------

import { auth } from "@/lib/auth"
import {
  createConversation,
  getConversations,
  getMessages,
  sendMessage,
  deleteMessage,
  markAsRead,
  searchUsers,
  addParticipants,
  getConversationParticipants,
} from "@/services/chat.service"
import { ConversationNotFound, ForbiddenError, MessageNotFound } from "@/lib/errors"

import {
  createConversationAction,
  getConversationsAction,
  getMessagesAction,
  sendMessageAction,
  deleteMessageAction,
  markAsReadAction as chatMarkAsReadAction,
  searchUsersAction,
  addParticipantsAction,
  getConversationParticipantsAction,
} from "../chat.actions"

import { fakeSession, lowRoleSession } from "./test-utils"
const mockGetSession = vi.mocked(auth.api.getSession)
const mockCreateConversation = vi.mocked(createConversation)
const mockGetConversations = vi.mocked(getConversations)
const mockGetMessages = vi.mocked(getMessages)
const mockSendMessage = vi.mocked(sendMessage)
const mockDeleteMessage = vi.mocked(deleteMessage)
const mockMarkAsRead = vi.mocked(markAsRead)
const mockSearchUsers = vi.mocked(searchUsers)
const mockAddParticipants = vi.mocked(addParticipants)
const mockGetConversationParticipants = vi.mocked(getConversationParticipants)

// ---------- Tests ----------

describe("Chat Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===== createConversationAction =====
  describe("createConversationAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await createConversationAction({ participantIds: ["u2"] } as any)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error for low role (below loanOfficer)", async () => {
      mockGetSession.mockResolvedValue(lowRoleSession)
      const result = await createConversationAction({ participantIds: ["u2"] } as any)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error for empty participants", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await createConversationAction({ participantIds: [] } as any)
      expect(result).toEqual({ error: "At least one participant is required" })
    })

    it("creates conversation on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const conv = { id: "conv1" }
      mockCreateConversation.mockReturnValue(Effect.succeed(conv) as any)

      const result = await createConversationAction({ participantIds: ["u2"] } as any)
      expect(result).toEqual({ data: conv })
    })
  })

  // ===== getConversationsAction =====
  describe("getConversationsAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await getConversationsAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns conversations on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const convs = [{ id: "conv1" }]
      mockGetConversations.mockReturnValue(Effect.succeed(convs) as any)
      const result = await getConversationsAction()
      expect(result).toEqual({ data: convs })
    })
  })

  // ===== getMessagesAction =====
  describe("getMessagesAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await getMessagesAction("conv1")
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns messages on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const msgs = { messages: [{ id: "m1" }], nextCursor: null }
      mockGetMessages.mockReturnValue(Effect.succeed(msgs) as any)
      const result = await getMessagesAction("conv1")
      expect(result).toEqual({ data: msgs })
    })

    it("returns error when conversation not found", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetMessages.mockReturnValue(
        Effect.fail(new ConversationNotFound({ id: "conv1" })) as any,
      )
      const result = await getMessagesAction("conv1")
      expect(result).toEqual({ error: "Conversation not found" })
    })
  })

  // ===== sendMessageAction =====
  describe("sendMessageAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await sendMessageAction({ conversationId: "conv1", content: "hi" } as any)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error for empty content and no attachments", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await sendMessageAction({ conversationId: "conv1", content: "" } as any)
      expect(result).toEqual({ error: "Message must have content or attachments" })
    })

    it("sends message on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const msg = { id: "m1", content: "hi" }
      mockSendMessage.mockReturnValue(Effect.succeed(msg) as any)
      const result = await sendMessageAction({ conversationId: "conv1", content: "hi" } as any)
      expect(result).toEqual({ data: msg })
    })
  })

  // ===== deleteMessageAction =====
  describe("deleteMessageAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await deleteMessageAction("m1")
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("deletes message on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockDeleteMessage.mockReturnValue(Effect.succeed(undefined) as any)
      const result = await deleteMessageAction("m1")
      expect(result).toEqual({ data: null })
    })

    it("returns error when message not found", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockDeleteMessage.mockReturnValue(
        Effect.fail(new MessageNotFound({ id: "m1" })) as any,
      )
      const result = await deleteMessageAction("m1")
      expect(result).toEqual({ error: "Message not found" })
    })
  })

  // ===== searchUsersAction =====
  describe("searchUsersAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await searchUsersAction("test")
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns empty for short query", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await searchUsersAction("t")
      expect(result).toEqual({ data: [] })
    })

    it("returns users on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const users = [{ id: "u2", name: "Jane" }]
      mockSearchUsers.mockReturnValue(Effect.succeed(users) as any)
      const result = await searchUsersAction("jane")
      expect(result).toEqual({ data: users })
    })
  })

  // ===== getConversationParticipantsAction =====
  describe("getConversationParticipantsAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await getConversationParticipantsAction("conv1")
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns Forbidden when user is not a member", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const participants = [{ id: "u99", name: "Other" }]
      mockGetConversationParticipants.mockReturnValue(Effect.succeed(participants) as any)
      const result = await getConversationParticipantsAction("conv1")
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("returns participants when user is a member", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const participants = [{ id: "u1", name: "Test" }, { id: "u2", name: "Jane" }]
      mockGetConversationParticipants.mockReturnValue(Effect.succeed(participants) as any)
      const result = await getConversationParticipantsAction("conv1")
      expect(result).toEqual({ data: participants })
    })
  })
})
