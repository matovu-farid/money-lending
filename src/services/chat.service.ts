import { Effect } from "effect"
import { db } from "@/lib/db"
import { conversations, conversationParticipants } from "@/lib/db/schema/conversations"
import { messages, messageAttachments } from "@/lib/db/schema/messages"
import { user } from "@/lib/db/schema/auth"
import { eq, and, desc, sql, isNull, inArray, ilike, lt } from "drizzle-orm"
import { DatabaseError, ConversationNotFound, MessageNotFound, ValidationError, ForbiddenError } from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import { createNotification } from "./notification.service"
import type { ConversationListItem, MessageWithSender, ChatUser } from "@/types"

const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024
const MAX_ATTACHMENTS_PER_MESSAGE = 3
const ATTACHMENT_TTL_DAYS = 7
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

function escapeLikePattern(input: string): string {
  return input.replace(/%/g, "\\%").replace(/_/g, "\\_")
}

export const createConversation = (
  createdBy: string,
  participantIds: string[],
  name?: string
): Effect.Effect<{ id: string; name: string | null; isGroup: boolean; createdBy: string; createdAt: Date; updatedAt: Date }, DatabaseError | ValidationError> =>
  Effect.tryPromise({
    try: async () => {
      const allParticipants = Array.from(new Set([createdBy, ...participantIds]))
      const isGroup = allParticipants.length > 2

      // For 1:1 conversations, check if one already exists
      if (!isGroup && participantIds.length === 1) {
        const otherId = participantIds[0]
        const existingRows = await db.execute(sql`
          SELECT cp1.conversation_id
          FROM conversation_participants cp1
          JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
          JOIN conversations c ON c.id = cp1.conversation_id
          WHERE cp1.user_id = ${createdBy}
            AND cp2.user_id = ${otherId}
            AND c.is_group = false
          LIMIT 1
        `)
        const existing = Array.from(existingRows)

        if (existing.length > 0) {
          const conversationId = existing[0].conversation_id as string
          const [conv] = await db
            .select()
            .from(conversations)
            .where(eq(conversations.id, conversationId))
          return conv
        }
      }

      return await db.transaction(async (tx) => {
        const [conv] = await tx
          .insert(conversations)
          .values({
            name: name ?? null,
            isGroup,
            createdBy,
          })
          .returning()

        await tx.insert(conversationParticipants).values(
          allParticipants.map((userId) => ({
            conversationId: conv.id,
            userId,
          }))
        )

        return conv
      })
    },
    catch: (e) => {
      if (e instanceof ValidationError) return e
      return new DatabaseError({ cause: e })
    },
  })

export const getConversations = (
  userId: string
): Effect.Effect<ConversationListItem[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      // Get all conversations where user is a participant
      const userConversations = await db
        .select({
          id: conversations.id,
          name: conversations.name,
          isGroup: conversations.isGroup,
          updatedAt: conversations.updatedAt,
          lastReadAt: conversationParticipants.lastReadAt,
        })
        .from(conversations)
        .innerJoin(
          conversationParticipants,
          and(
            eq(conversationParticipants.conversationId, conversations.id),
            eq(conversationParticipants.userId, userId)
          )
        )
        .orderBy(desc(conversations.updatedAt))

      const results: ConversationListItem[] = []

      for (const conv of userConversations) {
        // Get participants with names
        const participants = await db
          .select({
            id: user.id,
            name: user.name,
          })
          .from(conversationParticipants)
          .innerJoin(user, eq(user.id, conversationParticipants.userId))
          .where(eq(conversationParticipants.conversationId, conv.id))

        // Get last message
        const lastMessages = await db
          .select({
            content: messages.content,
            createdAt: messages.createdAt,
            senderName: user.name,
          })
          .from(messages)
          .innerJoin(user, eq(user.id, messages.senderId))
          .where(
            and(
              eq(messages.conversationId, conv.id),
              isNull(messages.deletedAt)
            )
          )
          .orderBy(desc(messages.createdAt))
          .limit(1)

        const lastMessage = lastMessages[0]
          ? {
              content: lastMessages[0].content.slice(0, 100),
              senderName: lastMessages[0].senderName,
              createdAt: lastMessages[0].createdAt,
            }
          : null

        // Count unread messages
        const unreadConditions = [
          eq(messages.conversationId, conv.id),
          isNull(messages.deletedAt),
        ]
        if (conv.lastReadAt) {
          unreadConditions.push(sql`${messages.createdAt} > ${conv.lastReadAt}`)
        }

        const [unreadResult] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(messages)
          .where(and(...unreadConditions))

        results.push({
          id: conv.id,
          name: conv.name,
          isGroup: conv.isGroup,
          participants,
          lastMessage,
          unreadCount: conv.lastReadAt ? (unreadResult?.count ?? 0) : 0,
          updatedAt: conv.updatedAt,
        })
      }

      return results
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const getMessages = (
  conversationId: string,
  userId: string,
  cursor?: string,
  limit = 50
): Effect.Effect<MessageWithSender[], ConversationNotFound | ForbiddenError | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      // Validate conversation exists
      const [conv] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
      if (!conv) throw new ConversationNotFound({ id: conversationId })

      // Validate user is participant
      const [participant] = await db
        .select()
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, userId)
          )
        )
      if (!participant) throw new ForbiddenError({ action: "getMessages", role: "non-participant" })

      // Build cursor condition
      const conditions: ReturnType<typeof eq>[] = [eq(messages.conversationId, conversationId)]
      if (cursor) {
        conditions.push(sql`${messages.createdAt} < (SELECT created_at FROM messages WHERE id = ${cursor})` as any)
      }

      const rows = await db
        .select({
          id: messages.id,
          conversationId: messages.conversationId,
          senderId: messages.senderId,
          senderName: user.name,
          content: messages.content,
          mentions: messages.mentions,
          deletedAt: messages.deletedAt,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .innerJoin(user, eq(user.id, messages.senderId))
        .where(and(...conditions))
        .orderBy(desc(messages.createdAt))
        .limit(limit)

      const now = new Date()
      const result: MessageWithSender[] = []

      for (const msg of rows) {
        const attachments = await db
          .select()
          .from(messageAttachments)
          .where(eq(messageAttachments.messageId, msg.id))

        result.push({
          id: msg.id,
          conversationId: msg.conversationId,
          senderId: msg.senderId,
          senderName: msg.senderName,
          content: msg.content,
          mentions: msg.mentions,
          attachments: attachments.map((a) => ({
            id: a.id,
            mimeType: a.mimeType,
            fileName: a.fileName,
            fileSize: a.fileSize,
            data: a.data,
            expired: a.expiresAt < now,
          })),
          deletedAt: msg.deletedAt,
          createdAt: msg.createdAt,
        })
      }

      return result
    },
    catch: (e) => {
      if (e instanceof ConversationNotFound) return e
      if (e instanceof ForbiddenError) return e
      return new DatabaseError({ cause: e })
    },
  })

export const sendMessage = (
  conversationId: string,
  senderId: string,
  content: string,
  mentionIds: string[] = [],
  attachments: { data: string; mimeType: string; fileName: string; fileSize: number }[] = []
): Effect.Effect<MessageWithSender, ConversationNotFound | ForbiddenError | ValidationError | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      // Validate conversation exists
      const [conv] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
      if (!conv) throw new ConversationNotFound({ id: conversationId })

      // Validate sender is participant
      const [participant] = await db
        .select()
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, senderId)
          )
        )
      if (!participant) throw new ForbiddenError({ action: "sendMessage", role: "non-participant" })

      // Validate content
      if (!content.trim()) throw new ValidationError({ message: "Message content cannot be empty", field: "content" })

      // Validate attachments
      if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
        throw new ValidationError({
          message: `Maximum ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message`,
          field: "attachments",
        })
      }
      for (const att of attachments) {
        if (!ALLOWED_MIME_TYPES.includes(att.mimeType)) {
          throw new ValidationError({ message: `Unsupported file type: ${att.mimeType}`, field: "attachments" })
        }
        if (att.fileSize > MAX_ATTACHMENT_SIZE) {
          throw new ValidationError({ message: `File ${att.fileName} exceeds 5MB limit`, field: "attachments" })
        }
      }

      // Get sender name for notifications
      const [sender] = await db.select({ name: user.name }).from(user).where(eq(user.id, senderId))

      const now = new Date()
      const expiresAt = new Date(now.getTime() + ATTACHMENT_TTL_DAYS * 24 * 60 * 60 * 1000)

      const result = await db.transaction(async (tx) => {
        const [msg] = await tx
          .insert(messages)
          .values({
            conversationId,
            senderId,
            content,
            mentions: mentionIds,
          })
          .returning()

        const insertedAttachments = attachments.length > 0
          ? await tx
              .insert(messageAttachments)
              .values(
                attachments.map((att) => ({
                  messageId: msg.id,
                  data: att.data,
                  mimeType: att.mimeType,
                  fileName: att.fileName,
                  fileSize: att.fileSize,
                  expiresAt,
                }))
              )
              .returning()
          : []

        // Update conversation updatedAt
        await tx
          .update(conversations)
          .set({ updatedAt: now })
          .where(eq(conversations.id, conversationId))

        // Create notifications for @mentioned users
        for (const mentionedUserId of mentionIds) {
          await createNotification(
            mentionedUserId,
            "chat_mention",
            `${sender?.name ?? "Someone"} mentioned you in a message`,
            "conversation",
            conversationId,
            { conversationId, senderId, messageId: msg.id }
          )
        }

        return {
          msg,
          insertedAttachments,
        }
      })

      return {
        id: result.msg.id,
        conversationId: result.msg.conversationId,
        senderId: result.msg.senderId,
        senderName: sender?.name ?? "",
        content: result.msg.content,
        mentions: result.msg.mentions,
        attachments: result.insertedAttachments.map((a) => ({
          id: a.id,
          mimeType: a.mimeType,
          fileName: a.fileName,
          fileSize: a.fileSize,
          data: a.data,
          expired: false,
        })),
        deletedAt: result.msg.deletedAt,
        createdAt: result.msg.createdAt,
      }
    },
    catch: (e) => {
      if (e instanceof ConversationNotFound) return e
      if (e instanceof ForbiddenError) return e
      if (e instanceof ValidationError) return e
      return new DatabaseError({ cause: e })
    },
  })

export const deleteMessage = (
  messageId: string,
  deletedBy: string,
  role: string
): Effect.Effect<void, MessageNotFound | ForbiddenError | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      await db.transaction(async (tx) => {
        const [msg] = await tx
          .select()
          .from(messages)
          .where(eq(messages.id, messageId))

        if (!msg) throw new MessageNotFound({ id: messageId })

        const isAdmin = role === "admin" || role === "superAdmin"
        if (msg.senderId !== deletedBy && !isAdmin) {
          throw new ForbiddenError({ action: "deleteMessage", role })
        }

        const now = new Date()

        await tx
          .update(messages)
          .set({ deletedAt: now, deletedBy })
          .where(eq(messages.id, messageId))

        await writeAuditLog(tx, {
          actorId: deletedBy,
          action: "delete",
          entityType: "message",
          entityId: messageId,
          beforeValue: { senderId: msg.senderId, content: msg.content, conversationId: msg.conversationId },
          afterValue: { deletedAt: now.toISOString(), deletedBy },
        })
      })
    },
    catch: (e) => {
      if (e instanceof MessageNotFound) return e
      if (e instanceof ForbiddenError) return e
      return new DatabaseError({ cause: e })
    },
  })

export const markAsRead = (
  conversationId: string,
  userId: string
): Effect.Effect<void, DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db
        .update(conversationParticipants)
        .set({ lastReadAt: new Date() })
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, userId)
          )
        )
        .then(() => undefined),
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const searchUsers = (
  query: string,
  excludeUserId: string
): Effect.Effect<ChatUser[], DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db
        .select({ id: user.id, name: user.name, role: user.role })
        .from(user)
        .where(
          and(
            ilike(user.name, `%${escapeLikePattern(query)}%`),
            sql`${user.id} != ${excludeUserId}`,
            sql`${user.role} != 'unassigned' AND ${user.role} IS NOT NULL`
          )
        )
        .then((rows) =>
          rows.map((r) => ({ id: r.id, name: r.name, role: r.role ?? "" }))
        ),
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const addParticipants = (
  conversationId: string,
  userIds: string[],
  addedBy: string
): Effect.Effect<void, ConversationNotFound | ForbiddenError | ValidationError | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [conv] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))

      if (!conv) throw new ConversationNotFound({ id: conversationId })

      if (!conv.isGroup) {
        throw new ValidationError({ message: "Cannot add participants to a 1:1 conversation", field: "conversationId" })
      }

      // Validate adder is participant
      const [adderParticipant] = await db
        .select()
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, addedBy)
          )
        )

      if (!adderParticipant) {
        throw new ForbiddenError({ action: "addParticipants", role: "non-participant" })
      }

      await db
        .insert(conversationParticipants)
        .values(
          userIds.map((userId) => ({
            conversationId,
            userId,
          }))
        )
        .onConflictDoNothing()
    },
    catch: (e) => {
      if (e instanceof ConversationNotFound) return e
      if (e instanceof ForbiddenError) return e
      if (e instanceof ValidationError) return e
      return new DatabaseError({ cause: e })
    },
  })

export const cleanupExpiredAttachments = (): Effect.Effect<number, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const deleted = await db
        .delete(messageAttachments)
        .where(lt(messageAttachments.expiresAt, new Date()))
        .returning({ id: messageAttachments.id })
      return deleted.length
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const getConversationParticipants = (
  conversationId: string
): Effect.Effect<ChatUser[], ConversationNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [conv] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))

      if (!conv) throw new ConversationNotFound({ id: conversationId })

      const participants = await db
        .select({ id: user.id, name: user.name, role: user.role })
        .from(conversationParticipants)
        .innerJoin(user, eq(user.id, conversationParticipants.userId))
        .where(eq(conversationParticipants.conversationId, conversationId))

      return participants.map((p) => ({ id: p.id, name: p.name, role: p.role ?? "" }))
    },
    catch: (e) => {
      if (e instanceof ConversationNotFound) return e
      return new DatabaseError({ cause: e })
    },
  })
