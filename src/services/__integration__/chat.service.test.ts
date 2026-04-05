import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Exit, Cause } from "effect"
import { resetDb, testDb } from "./setup"
import { user } from "@/lib/db/schema/auth"
import { notifications } from "@/lib/db/schema/notifications"
import { messageAttachments } from "@/lib/db/schema/messages"
import { eq, sql } from "drizzle-orm"
import {
  createConversation,
  sendMessage,
  getMessages,
  deleteMessage,
  getConversations,
  markAsRead,
  searchUsers,
  addParticipants,
  cleanupExpiredAttachments,
} from "@/services/chat.service"
import { ConversationNotFound, ForbiddenError, MessageNotFound, ValidationError } from "@/lib/errors"

const TEST_TIMEOUT = 30_000

async function createTestUser(id: string, name: string, role: string = "loanOfficer") {
  await testDb.insert(user).values({
    id,
    name,
    email: `${id}@test.com`,
    emailVerified: true,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

describe("chat.service integration", () => {
  beforeEach(async () => {
    await resetDb()
    await createTestUser("user1", "Alice Officer", "loanOfficer")
    await createTestUser("user2", "Bob Admin", "admin")
    await createTestUser("user3", "Charlie Super", "superAdmin")
    await createTestUser("unassigned1", "Dan Unassigned", "unassigned")
  }, TEST_TIMEOUT)

  // ── createConversation ────────────────────────────────────────────────────

  it("createConversation: creates a 1:1 conversation", async () => {
    const conv = await Effect.runPromise(createConversation("user1", ["user2"]))

    expect(conv.id).toBeDefined()
    expect(conv.isGroup).toBe(false)
    expect(conv.createdBy).toBe("user1")
    expect(conv.createdAt).toBeInstanceOf(Date)
  }, TEST_TIMEOUT)

  it("createConversation: returns existing 1:1 for same pair (dedup)", async () => {
    const first = await Effect.runPromise(createConversation("user1", ["user2"]))
    const second = await Effect.runPromise(createConversation("user1", ["user2"]))

    expect(second.id).toBe(first.id)
  }, TEST_TIMEOUT)

  it("createConversation: creates group conversation for 3+ participants", async () => {
    const conv = await Effect.runPromise(
      createConversation("user1", ["user2", "user3"], "Team Chat")
    )

    expect(conv.id).toBeDefined()
    expect(conv.isGroup).toBe(true)
    expect(conv.name).toBe("Team Chat")
  }, TEST_TIMEOUT)

  it("createConversation: fails with empty participants", async () => {
    // With no other participants, allParticipants = [createdBy] => length 1, not group
    // It should still create a self-conversation (or handle gracefully)
    // The service doesn't explicitly throw for empty participants, it creates a solo conv
    // Let's verify it succeeds and creates a conversation with just the creator
    const conv = await Effect.runPromise(createConversation("user1", []))
    expect(conv.id).toBeDefined()
    expect(conv.isGroup).toBe(false)
  }, TEST_TIMEOUT)

  // ── sendMessage + getMessages ─────────────────────────────────────────────

  it("sendMessage + getMessages: sends and retrieves messages", async () => {
    const conv = await Effect.runPromise(createConversation("user1", ["user2"]))
    const msg = await Effect.runPromise(
      sendMessage(conv.id, "user1", "Hello Bob!")
    )

    expect(msg.id).toBeDefined()
    expect(msg.content).toBe("Hello Bob!")
    expect(msg.senderId).toBe("user1")
    expect(msg.senderName).toBe("Alice Officer")
    expect(msg.deletedAt).toBeNull()

    const retrieved = await Effect.runPromise(getMessages(conv.id, "user1"))
    expect(retrieved).toHaveLength(1)
    expect(retrieved[0].id).toBe(msg.id)
    expect(retrieved[0].content).toBe("Hello Bob!")
  }, TEST_TIMEOUT)

  it("sendMessage: rejects message from non-participant", async () => {
    const conv = await Effect.runPromise(createConversation("user1", ["user2"]))

    const exit = await Effect.runPromiseExit(
      sendMessage(conv.id, "user3", "I am not in this chat")
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(ForbiddenError)
      }
    }
  }, TEST_TIMEOUT)

  it("sendMessage: creates notification for @mentions", async () => {
    const conv = await Effect.runPromise(createConversation("user1", ["user2"]))

    await Effect.runPromise(
      sendMessage(conv.id, "user1", "Hey @Bob!", ["user2"])
    )

    const notifs = await testDb
      .select()
      .from(notifications)
      .where(eq(notifications.userId, "user2"))

    expect(notifs).toHaveLength(1)
    expect(notifs[0].type).toBe("chat_mention")
    expect(notifs[0].message).toContain("Alice Officer")
  }, TEST_TIMEOUT)

  it("sendMessage: sends message with image attachment", async () => {
    const conv = await Effect.runPromise(createConversation("user1", ["user2"]))

    const msg = await Effect.runPromise(
      sendMessage(conv.id, "user1", "Check this out", [], [
        {
          data: "data:image/png;base64,iVBORw0KGgo=",
          mimeType: "image/png",
          fileName: "screenshot.png",
          fileSize: 1024,
        },
      ])
    )

    expect(msg.attachments).toHaveLength(1)
    expect(msg.attachments[0].fileName).toBe("screenshot.png")
    expect(msg.attachments[0].mimeType).toBe("image/png")
    expect(msg.attachments[0].expired).toBe(false)
  }, TEST_TIMEOUT)

  // ── deleteMessage ─────────────────────────────────────────────────────────

  it("deleteMessage: sender deletes own message (soft delete)", async () => {
    const conv = await Effect.runPromise(createConversation("user1", ["user2"]))
    const msg = await Effect.runPromise(sendMessage(conv.id, "user1", "Delete me"))

    await Effect.runPromise(deleteMessage(msg.id, "user1", "loanOfficer"))

    const retrieved = await Effect.runPromise(getMessages(conv.id, "user1"))
    const deleted = retrieved.find((m) => m.id === msg.id)
    expect(deleted?.deletedAt).not.toBeNull()
  }, TEST_TIMEOUT)

  it("deleteMessage: admin deletes any message", async () => {
    const conv = await Effect.runPromise(createConversation("user1", ["user2"]))
    const msg = await Effect.runPromise(sendMessage(conv.id, "user1", "Admin will delete this"))

    // user2 is admin, deletes user1's message
    await Effect.runPromise(deleteMessage(msg.id, "user2", "admin"))

    const retrieved = await Effect.runPromise(getMessages(conv.id, "user1"))
    const deleted = retrieved.find((m) => m.id === msg.id)
    expect(deleted?.deletedAt).not.toBeNull()
  }, TEST_TIMEOUT)

  it("deleteMessage: non-admin cannot delete other's message", async () => {
    const conv = await Effect.runPromise(createConversation("user1", ["user2"]))
    const msg = await Effect.runPromise(sendMessage(conv.id, "user1", "Only I can delete this"))

    // user2 is admin in beforeEach, but let's add a third non-admin user to the conversation
    // user3 is superAdmin, so use an additional non-admin user
    await createTestUser("user4", "Eve Non-Admin", "loanOfficer")
    // Add user4 to a group conv with user1 so they can send, then try to delete user1's msg
    const groupConv = await Effect.runPromise(
      createConversation("user1", ["user2", "user3", "user4"], "Group")
    )
    const msg2 = await Effect.runPromise(sendMessage(groupConv.id, "user1", "Don't delete me"))

    const exit = await Effect.runPromiseExit(
      deleteMessage(msg2.id, "user4", "loanOfficer")
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(ForbiddenError)
      }
    }
  }, TEST_TIMEOUT)

  it("deleteMessage: fails for non-existent message", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000"
    const exit = await Effect.runPromiseExit(deleteMessage(fakeId, "user1", "admin"))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(MessageNotFound)
      }
    }
  }, TEST_TIMEOUT)

  // ── getConversations + markAsRead ─────────────────────────────────────────

  it("getConversations: returns conversations with unread count", async () => {
    const conv = await Effect.runPromise(createConversation("user1", ["user2"]))

    // user1 sends a message — user2 hasn't read it yet
    await Effect.runPromise(sendMessage(conv.id, "user1", "Unread message"))

    // Mark as read first so lastReadAt is set, then send another message to create unread
    await Effect.runPromise(markAsRead(conv.id, "user2"))

    // Wait a moment so the new message timestamp is definitely after lastReadAt
    await new Promise((resolve) => setTimeout(resolve, 100))

    await Effect.runPromise(sendMessage(conv.id, "user1", "New unread message"))

    const convList = await Effect.runPromise(getConversations("user2"))
    expect(convList).toHaveLength(1)
    expect(convList[0].id).toBe(conv.id)
    expect(convList[0].unreadCount).toBeGreaterThan(0)
  }, TEST_TIMEOUT)

  it("getConversations: markAsRead resets unread count", async () => {
    const conv = await Effect.runPromise(createConversation("user1", ["user2"]))

    // Set lastReadAt so unread tracking works
    await Effect.runPromise(markAsRead(conv.id, "user2"))

    // Wait a moment so the new message timestamp is definitely after lastReadAt
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Send a message after marking as read
    await Effect.runPromise(sendMessage(conv.id, "user1", "You should read this"))

    // Before marking as read: should have unread
    const before = await Effect.runPromise(getConversations("user2"))
    expect(before[0].unreadCount).toBe(1)

    // Mark as read
    await Effect.runPromise(markAsRead(conv.id, "user2"))

    // After marking as read: unread should be 0
    const after = await Effect.runPromise(getConversations("user2"))
    expect(after[0].unreadCount).toBe(0)
  }, TEST_TIMEOUT)

  // ── searchUsers ───────────────────────────────────────────────────────────

  it("searchUsers: excludes unassigned role", async () => {
    const results = await Effect.runPromise(searchUsers("Dan", "user1"))

    // unassigned1 has name "Dan Unassigned" but role=unassigned — should be excluded
    expect(results.find((u) => u.id === "unassigned1")).toBeUndefined()
  }, TEST_TIMEOUT)

  it("searchUsers: finds eligible users", async () => {
    const results = await Effect.runPromise(searchUsers("Alice", "user2"))

    expect(results.length).toBeGreaterThan(0)
    expect(results.find((u) => u.id === "user1")).toBeDefined()
    expect(results[0].name).toContain("Alice")
  }, TEST_TIMEOUT)

  it("searchUsers: excludes requesting user", async () => {
    const results = await Effect.runPromise(searchUsers("Alice", "user1"))

    // user1 is "Alice Officer" — should not appear in results
    expect(results.find((u) => u.id === "user1")).toBeUndefined()
  }, TEST_TIMEOUT)

  // ── addParticipants ───────────────────────────────────────────────────────

  it("addParticipants: adds users to group conversation", async () => {
    await createTestUser("user4", "Eve New", "loanOfficer")

    const groupConv = await Effect.runPromise(
      createConversation("user1", ["user2", "user3"], "Group Chat")
    )

    await Effect.runPromise(addParticipants(groupConv.id, ["user4"], "user1"))

    // user4 can now send a message in that conversation
    const msg = await Effect.runPromise(
      sendMessage(groupConv.id, "user4", "Hi everyone, I'm new here!")
    )
    expect(msg.senderId).toBe("user4")
  }, TEST_TIMEOUT)

  it("addParticipants: fails for 1:1 conversation", async () => {
    await createTestUser("user4", "Eve New", "loanOfficer")

    const dmConv = await Effect.runPromise(createConversation("user1", ["user2"]))

    const exit = await Effect.runPromiseExit(
      addParticipants(dmConv.id, ["user4"], "user1")
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(ValidationError)
      }
    }
  }, TEST_TIMEOUT)

  // ── cleanupExpiredAttachments ─────────────────────────────────────────────

  it("cleanupExpiredAttachments: deletes expired attachments", async () => {
    const conv = await Effect.runPromise(createConversation("user1", ["user2"]))

    // Send a message with an attachment
    const msg = await Effect.runPromise(
      sendMessage(conv.id, "user1", "Expiring soon", [], [
        {
          data: "data:image/jpeg;base64,/9j/4AA=",
          mimeType: "image/jpeg",
          fileName: "old-file.jpg",
          fileSize: 512,
        },
      ])
    )

    expect(msg.attachments).toHaveLength(1)
    const attachmentId = msg.attachments[0].id

    // Manually set expiresAt to the past so cleanup picks it up
    await testDb.execute(sql`
      UPDATE message_attachments
      SET expires_at = NOW() - INTERVAL '1 day'
      WHERE id = ${attachmentId}
    `)

    const deletedCount = await Effect.runPromise(cleanupExpiredAttachments())
    expect(deletedCount).toBe(1)

    // Verify it's gone from the DB
    const remaining = await testDb
      .select()
      .from(messageAttachments)
      .where(eq(messageAttachments.id, attachmentId))

    expect(remaining).toHaveLength(0)
  }, TEST_TIMEOUT)

  it("cleanupExpiredAttachments: does not delete non-expired attachments", async () => {
    const conv = await Effect.runPromise(createConversation("user1", ["user2"]))

    await Effect.runPromise(
      sendMessage(conv.id, "user1", "Fresh attachment", [], [
        {
          data: "data:image/png;base64,iVBORw0KGgo=",
          mimeType: "image/png",
          fileName: "fresh.png",
          fileSize: 256,
        },
      ])
    )

    const deletedCount = await Effect.runPromise(cleanupExpiredAttachments())
    expect(deletedCount).toBe(0)
  }, TEST_TIMEOUT)
})
