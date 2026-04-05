# Chat Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal messaging system where app users (loanOfficer+) can send 1:1 and group messages with @mentions, image attachments, and admin moderation.

**Architecture:** Polling-based chat using React Query `refetchInterval` (5s active chat, 30s conversation list). Four new DB tables (conversations, conversation_participants, messages, message_attachments) plus a rearchitected notifications table. Follows existing Service (Effect) → Server Action → React Query Hook → Page pattern.

**Tech Stack:** Next.js 16, Drizzle ORM, PostgreSQL, Effect, React Query, shadcn/ui, Cypress

---

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/lib/db/schema/conversations.ts` | conversations + conversation_participants tables |
| `src/lib/db/schema/messages.ts` | messages + message_attachments tables |
| `src/services/chat.service.ts` | All chat business logic (Effect functions) |
| `src/actions/chat.actions.ts` | Server actions wrapping chat service |
| `src/hooks/use-conversations.ts` | Query hook: conversation list with polling |
| `src/hooks/use-messages.ts` | Query hook: messages with polling |
| `src/hooks/use-send-message.ts` | Mutation hook: send message with optimistic update |
| `src/hooks/use-create-conversation.ts` | Mutation hook: create conversation |
| `src/hooks/use-delete-message.ts` | Mutation hook: delete message |
| `src/hooks/use-search-users.ts` | Query hook: user search for mentions/new chat |
| `src/app/(app)/chat/page.tsx` | Main chat page (two-panel layout) |
| `src/components/chat/conversation-list.tsx` | Left panel: conversation list + search |
| `src/components/chat/conversation-item.tsx` | Single conversation row |
| `src/components/chat/message-thread.tsx` | Right panel: message display |
| `src/components/chat/message-bubble.tsx` | Single message with attachments |
| `src/components/chat/message-input.tsx` | Text area + attach + mention + send |
| `src/components/chat/mention-popover.tsx` | @ triggered user picker |
| `src/components/chat/new-conversation-dialog.tsx` | User search + multi-select |
| `src/components/chat/image-lightbox.tsx` | Click-to-expand image viewer |
| `src/app/api/cron/attachment-cleanup/route.ts` | Cron: delete expired attachments |
| `src/services/__tests__/chat.service.test.ts` | Unit tests |
| `src/services/__integration__/chat.service.test.ts` | Integration tests |
| `cypress/e2e/chat.cy.ts` | E2E tests |

### Modified Files
| File | Change |
|---|---|
| `src/lib/db/schema/notifications.ts` | Rearchitect: drop loan-specific columns, add referenceType/referenceId/metadata |
| `src/lib/db/schema/index.ts` | Add exports for conversations and messages |
| `src/lib/errors.ts` | Add ConversationNotFound, MessageNotFound |
| `src/types/index.ts` | Add chat types, update Notification type |
| `src/hooks/query-keys.ts` | Add chat query keys |
| `src/services/notification.service.ts` | Update to new notifications schema |
| `src/actions/notification.actions.ts` | Update to new notifications schema |
| `src/app/api/cron/overdue/route.ts` | Update createNotificationsForLoan calls |
| `src/components/layout/sidebar.tsx` | Add Chat nav item |
| `src/services/__integration__/setup.ts` | Add new tables to TRUNCATE |
| `cypress.config.ts` | Add new tables to db:reset |

---

## Task 1: Rearchitect Notifications Schema

**Files:**
- Modify: `src/lib/db/schema/notifications.ts`
- Modify: `src/types/index.ts`
- Modify: `src/services/notification.service.ts`
- Modify: `src/actions/notification.actions.ts`
- Modify: `src/app/api/cron/overdue/route.ts`
- Modify: `src/services/__integration__/setup.ts`
- Modify: `cypress.config.ts`

- [ ] **Step 1: Rewrite notifications schema**

Replace the entire contents of `src/lib/db/schema/notifications.ts`:

```typescript
import { pgTable, uuid, text, boolean, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core"

export const notificationTypeEnum = pgEnum("notification_type", [
  "loan_due_soon",
  "chat_mention",
])

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  type: notificationTypeEnum("type").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})
```

- [ ] **Step 2: Update Notification type in types/index.ts**

Replace the Notification type imports and definitions. Remove the `import type { notifications }` from `"@/lib/db/schema/notifications"` line and the `Notification`/`NewNotification` type aliases (around lines 7, 145-146), then add the new type:

```typescript
// In the imports section, update the notifications import:
import type { notifications } from "@/lib/db/schema/notifications"

// Replace the old Notification/NewNotification types with:
export type Notification = InferSelectModel<typeof notifications>
export type NewNotification = InferInsertModel<typeof notifications>
```

The shape changes automatically via InferSelectModel since we changed the schema.

- [ ] **Step 3: Update notification.service.ts**

Replace the entire contents of `src/services/notification.service.ts`:

```typescript
import { Effect } from "effect"
import { db } from "@/lib/db"
import { notifications } from "@/lib/db/schema/notifications"
import { eq, and, desc, sql } from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import type { Notification } from "@/types"

export const getNotifications = (
  userId: string
): Effect.Effect<Notification[], DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(20),
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const getUnreadCount = (
  userId: string
): Effect.Effect<number, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [result] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
      return result.count
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const markAsRead = (
  notificationId: string,
  userId: string
): Effect.Effect<void, DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(eq(notifications.id, notificationId), eq(notifications.userId, userId))
        )
        .then(() => undefined),
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const markAllAsRead = (
  userId: string
): Effect.Effect<void, DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db
        .update(notifications)
        .set({ isRead: true })
        .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
        .then(() => undefined),
    catch: (e) => new DatabaseError({ cause: e }),
  })

export async function createNotification(
  userId: string,
  type: "loan_due_soon" | "chat_mention",
  message: string,
  referenceType?: string,
  referenceId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await db.insert(notifications).values({
    userId,
    type,
    message,
    referenceType: referenceType ?? null,
    referenceId: referenceId ?? null,
    metadata: metadata ?? null,
  })
}

export async function createNotificationsForLoan(
  loanId: string,
  message: string,
  dueDate: Date,
  targetUserIds: string[]
): Promise<void> {
  if (targetUserIds.length === 0) return

  for (const userId of targetUserIds) {
    // Dedup: check for existing notification with same reference
    const existing = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.referenceType, "loan"),
          eq(notifications.referenceId, loanId),
          sql`(${notifications.metadata}->>'dueDate')::date = ${dueDate.toISOString().split("T")[0]}::date`
        )
      )
      .limit(1)

    if (existing.length === 0) {
      await createNotification(
        userId,
        "loan_due_soon",
        message,
        "loan",
        loanId,
        { dueDate: dueDate.toISOString(), loanId }
      )
    }
  }
}
```

- [ ] **Step 4: Update notification.actions.ts if it references old columns**

Check `src/actions/notification.actions.ts` — if it references `loanId` or `dueDate` columns directly, update those references. The actions mostly delegate to the service, so they should work unchanged. Verify by reading the file.

- [ ] **Step 5: Update the overdue cron route**

The cron route at `src/app/api/cron/overdue/route.ts` calls `createNotificationsForLoan` — this function signature is unchanged, so no modifications needed. Verify by reading the file.

- [ ] **Step 6: Generate and run Drizzle migration**

```bash
npx drizzle-kit generate
```

Then manually edit the generated migration SQL to:
1. Drop the old `notifications` table: `DROP TABLE IF EXISTS "notifications";`
2. Drop the old enum: `DROP TYPE IF EXISTS "notification_type";`
3. Then let the generated CREATE statements run

```bash
npx drizzle-kit migrate
```

- [ ] **Step 7: Update integration test setup.ts**

The TRUNCATE in `src/services/__integration__/setup.ts` already includes `notifications` — no change needed yet. The new chat tables will be added in a later task.

- [ ] **Step 8: Run existing notification tests to verify**

```bash
npx vitest run src/services/__tests__/notification --reporter=verbose
npx vitest run src/services/__integration__/notification --reporter=verbose
```

Fix any failures caused by the schema change.

- [ ] **Step 9: Commit**

```bash
git add src/lib/db/schema/notifications.ts src/types/index.ts src/services/notification.service.ts src/actions/notification.actions.ts drizzle/
git commit -m "refactor: rearchitect notifications table to be generic and extensible

Replace loan-specific loanId/dueDate columns with polymorphic
referenceType/referenceId + jsonb metadata pattern."
```

---

## Task 2: Chat Database Schema

**Files:**
- Create: `src/lib/db/schema/conversations.ts`
- Create: `src/lib/db/schema/messages.ts`
- Modify: `src/lib/db/schema/index.ts`
- Modify: `src/lib/errors.ts`
- Modify: `src/types/index.ts`
- Modify: `src/services/__integration__/setup.ts`
- Modify: `cypress.config.ts`

- [ ] **Step 1: Create conversations schema**

Create `src/lib/db/schema/conversations.ts`:

```typescript
import { pgTable, uuid, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { user } from "./auth"

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  isGroup: boolean("is_group").notNull().default(false),
  createdBy: text("created_by").notNull().references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("conv_participant_unique").on(table.conversationId, table.userId),
  ]
)
```

- [ ] **Step 2: Create messages schema**

Create `src/lib/db/schema/messages.ts`:

```typescript
import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core"
import { conversations } from "./conversations"
import { user } from "./auth"

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    senderId: text("sender_id").notNull().references(() => user.id),
    content: text("content").notNull(),
    mentions: text("mentions").array().notNull().default([]),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("msg_conversation_idx").on(table.conversationId),
    index("msg_created_at_idx").on(table.createdAt),
  ]
)

export const messageAttachments = pgTable("message_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  data: text("data").notNull(),
  mimeType: text("mime_type").notNull(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})
```

- [ ] **Step 3: Update schema index.ts**

Add to `src/lib/db/schema/index.ts`:

```typescript
export * from "./conversations"
export * from "./messages"
```

- [ ] **Step 4: Add error types**

Add to `src/lib/errors.ts`:

```typescript
export class ConversationNotFound extends Data.TaggedError("ConversationNotFound")<{ id: string }> {}
export class MessageNotFound extends Data.TaggedError("MessageNotFound")<{ id: string }> {}
```

- [ ] **Step 5: Add chat types to types/index.ts**

Add these imports at the top of `src/types/index.ts`:

```typescript
import type { conversations, conversationParticipants } from "@/lib/db/schema/conversations"
import type { messages, messageAttachments } from "@/lib/db/schema/messages"
```

Add these types at the bottom:

```typescript
// --- Chat types ---
export type Conversation = InferSelectModel<typeof conversations>
export type ConversationParticipant = InferSelectModel<typeof conversationParticipants>
export type Message = InferSelectModel<typeof messages>
export type MessageAttachment = InferSelectModel<typeof messageAttachments>

export interface ConversationListItem {
  id: string
  name: string | null
  isGroup: boolean
  participants: { id: string; name: string }[]
  lastMessage: { content: string; senderName: string; createdAt: Date } | null
  unreadCount: number
  updatedAt: Date
}

export interface MessageWithSender {
  id: string
  conversationId: string
  senderId: string
  senderName: string
  content: string
  mentions: string[]
  attachments: { id: string; mimeType: string; fileName: string; fileSize: number; data: string; expired: boolean }[]
  deletedAt: Date | null
  createdAt: Date
}

export interface SendMessageInput {
  conversationId: string
  content: string
  mentions?: string[]
  attachments?: { data: string; mimeType: string; fileName: string; fileSize: number }[]
}

export interface CreateConversationInput {
  participantIds: string[]
  name?: string
}

export interface ChatUser {
  id: string
  name: string
  role: string
}
```

- [ ] **Step 6: Update integration test setup.ts**

In `src/services/__integration__/setup.ts`, update the TRUNCATE to include new tables. Add them before `notifications`:

```sql
TRUNCATE TABLE
  message_attachments,
  messages,
  conversation_participants,
  conversations,
  transactions,
  ...rest stays the same
```

- [ ] **Step 7: Update cypress.config.ts db:reset task**

In `cypress.config.ts`, add DELETE statements for new tables before the existing ones:

```sql
DELETE FROM message_attachments;
DELETE FROM messages;
DELETE FROM conversation_participants;
DELETE FROM conversations;
DELETE FROM financial_snapshots;
...rest stays the same
```

- [ ] **Step 8: Generate and run migration**

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/db/schema/conversations.ts src/lib/db/schema/messages.ts src/lib/db/schema/index.ts src/lib/errors.ts src/types/index.ts src/services/__integration__/setup.ts cypress.config.ts drizzle/
git commit -m "feat: add chat database schema

Add conversations, conversation_participants, messages, and
message_attachments tables with indexes and constraints."
```

---

## Task 3: Chat Service

**Files:**
- Create: `src/services/chat.service.ts`

- [ ] **Step 1: Create chat service with createConversation**

Create `src/services/chat.service.ts`:

```typescript
import { Effect } from "effect"
import { db } from "@/lib/db"
import { conversations, conversationParticipants } from "@/lib/db/schema/conversations"
import { messages, messageAttachments } from "@/lib/db/schema/messages"
import { user } from "@/lib/db/schema/auth"
import { notifications } from "@/lib/db/schema/notifications"
import { eq, and, desc, sql, isNull, inArray, ilike, notInArray } from "drizzle-orm"
import { DatabaseError, ConversationNotFound, MessageNotFound, ValidationError, ForbiddenError } from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import { createNotification } from "./notification.service"
import type { ConversationListItem, MessageWithSender, ChatUser } from "@/types"

const UNASSIGNED_ROLE = "unassigned"
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_ATTACHMENTS_PER_MESSAGE = 3
const ATTACHMENT_TTL_DAYS = 7
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

export const createConversation = (
  createdBy: string,
  participantIds: string[],
  name?: string
): Effect.Effect<{ id: string }, DatabaseError | ValidationError> =>
  Effect.tryPromise({
    try: async () => {
      if (participantIds.length === 0) {
        throw new ValidationError({ message: "At least one participant is required" })
      }

      // All participants including the creator
      const allParticipantIds = [...new Set([createdBy, ...participantIds])]
      const isGroup = allParticipantIds.length > 2

      // For 1:1, check if conversation already exists
      if (!isGroup) {
        const otherId = participantIds.find((id) => id !== createdBy) ?? participantIds[0]
        const existing = await db.execute(sql`
          SELECT cp1.conversation_id
          FROM conversation_participants cp1
          JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
          JOIN conversations c ON c.id = cp1.conversation_id
          WHERE cp1.user_id = ${createdBy}
            AND cp2.user_id = ${otherId}
            AND c.is_group = false
          LIMIT 1
        `)
        if ((existing as unknown as { conversation_id: string }[]).length > 0) {
          return { id: (existing as unknown as { conversation_id: string }[])[0].conversation_id }
        }
      }

      // Create conversation
      const [conv] = await db
        .insert(conversations)
        .values({
          name: name ?? null,
          isGroup,
          createdBy,
        })
        .returning({ id: conversations.id })

      // Add participants
      await db.insert(conversationParticipants).values(
        allParticipantIds.map((userId) => ({
          conversationId: conv.id,
          userId,
        }))
      )

      return { id: conv.id }
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
      // Get all conversation IDs the user participates in
      const participantRows = await db
        .select({ conversationId: conversationParticipants.conversationId, lastReadAt: conversationParticipants.lastReadAt })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.userId, userId))

      if (participantRows.length === 0) return []

      const convIds = participantRows.map((r) => r.conversationId)
      const lastReadMap = new Map(participantRows.map((r) => [r.conversationId, r.lastReadAt]))

      // Get conversations
      const convs = await db
        .select()
        .from(conversations)
        .where(inArray(conversations.id, convIds))
        .orderBy(desc(conversations.updatedAt))

      const result: ConversationListItem[] = []

      for (const conv of convs) {
        // Get participants
        const parts = await db
          .select({ userId: conversationParticipants.userId, userName: user.name })
          .from(conversationParticipants)
          .innerJoin(user, eq(conversationParticipants.userId, user.id))
          .where(eq(conversationParticipants.conversationId, conv.id))

        // Get last message
        const [lastMsg] = await db
          .select({
            content: messages.content,
            senderName: user.name,
            createdAt: messages.createdAt,
          })
          .from(messages)
          .innerJoin(user, eq(messages.senderId, user.id))
          .where(and(eq(messages.conversationId, conv.id), isNull(messages.deletedAt)))
          .orderBy(desc(messages.createdAt))
          .limit(1)

        // Count unread
        const lastRead = lastReadMap.get(conv.id)
        const [{ count: unreadCount }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, conv.id),
              isNull(messages.deletedAt),
              lastRead ? sql`${messages.createdAt} > ${lastRead}` : sql`true`
            )
          )

        result.push({
          id: conv.id,
          name: conv.name,
          isGroup: conv.isGroup,
          participants: parts.map((p) => ({ id: p.userId, name: p.userName })),
          lastMessage: lastMsg
            ? { content: lastMsg.content.substring(0, 100), senderName: lastMsg.senderName, createdAt: lastMsg.createdAt }
            : null,
          unreadCount,
          updatedAt: conv.updatedAt,
        })
      }

      return result
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const getMessages = (
  conversationId: string,
  userId: string,
  cursor?: string,
  limit: number = 50
): Effect.Effect<MessageWithSender[], ConversationNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      // Validate participant
      const [participant] = await db
        .select({ id: conversationParticipants.id })
        .from(conversationParticipants)
        .where(and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId)
        ))

      if (!participant) throw new ConversationNotFound({ id: conversationId })

      const conditions = [eq(messages.conversationId, conversationId)]
      if (cursor) {
        conditions.push(sql`${messages.createdAt} < ${cursor}`)
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
        .innerJoin(user, eq(messages.senderId, user.id))
        .where(and(...conditions))
        .orderBy(desc(messages.createdAt))
        .limit(limit)

      // Fetch attachments for these messages
      const messageIds = rows.map((r) => r.id)
      const attachments = messageIds.length > 0
        ? await db
            .select()
            .from(messageAttachments)
            .where(inArray(messageAttachments.messageId, messageIds))
        : []

      const attachmentMap = new Map<string, typeof attachments>()
      for (const att of attachments) {
        const existing = attachmentMap.get(att.messageId) ?? []
        existing.push(att)
        attachmentMap.set(att.messageId, existing)
      }

      const now = new Date()
      return rows.map((row) => ({
        id: row.id,
        conversationId: row.conversationId,
        senderId: row.senderId,
        senderName: row.senderName,
        content: row.content,
        mentions: row.mentions ?? [],
        attachments: (attachmentMap.get(row.id) ?? []).map((a) => ({
          id: a.id,
          mimeType: a.mimeType,
          fileName: a.fileName,
          fileSize: a.fileSize,
          data: a.expiresAt > now ? a.data : "",
          expired: a.expiresAt <= now,
        })),
        deletedAt: row.deletedAt,
        createdAt: row.createdAt,
      }))
    },
    catch: (e) => {
      if (e instanceof ConversationNotFound) return e
      return new DatabaseError({ cause: e })
    },
  })

export const sendMessage = (
  conversationId: string,
  senderId: string,
  content: string,
  mentionIds: string[] = [],
  attachmentInputs: { data: string; mimeType: string; fileName: string; fileSize: number }[] = []
): Effect.Effect<MessageWithSender, ConversationNotFound | ValidationError | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      // Validate participant
      const [participant] = await db
        .select({ id: conversationParticipants.id })
        .from(conversationParticipants)
        .where(and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, senderId)
        ))

      if (!participant) throw new ConversationNotFound({ id: conversationId })

      // Validate content
      if (!content.trim() && attachmentInputs.length === 0) {
        throw new ValidationError({ message: "Message content or attachment is required" })
      }

      // Validate attachments
      if (attachmentInputs.length > MAX_ATTACHMENTS_PER_MESSAGE) {
        throw new ValidationError({ message: `Maximum ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message` })
      }
      for (const att of attachmentInputs) {
        if (!ALLOWED_MIME_TYPES.includes(att.mimeType)) {
          throw new ValidationError({ message: `Unsupported file type: ${att.mimeType}` })
        }
        if (att.fileSize > MAX_ATTACHMENT_SIZE) {
          throw new ValidationError({ message: `File ${att.fileName} exceeds 5MB limit` })
        }
      }

      // Insert message
      const [msg] = await db
        .insert(messages)
        .values({
          conversationId,
          senderId,
          content: content.trim(),
          mentions: mentionIds,
        })
        .returning()

      // Insert attachments
      if (attachmentInputs.length > 0) {
        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + ATTACHMENT_TTL_DAYS)

        await db.insert(messageAttachments).values(
          attachmentInputs.map((att) => ({
            messageId: msg.id,
            data: att.data,
            mimeType: att.mimeType,
            fileName: att.fileName,
            fileSize: att.fileSize,
            expiresAt,
          }))
        )
      }

      // Update conversation updatedAt
      await db
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversationId))

      // Create notifications for @mentioned users
      const [sender] = await db.select({ name: user.name }).from(user).where(eq(user.id, senderId))
      const senderName = sender?.name ?? "Unknown"

      for (const mentionedUserId of mentionIds) {
        if (mentionedUserId !== senderId) {
          await createNotification(
            mentionedUserId,
            "chat_mention",
            `${senderName} mentioned you in a message`,
            "conversation",
            conversationId,
            { conversationId, senderId, messageId: msg.id }
          )
        }
      }

      // Return full message
      const attachments = attachmentInputs.length > 0
        ? await db.select().from(messageAttachments).where(eq(messageAttachments.messageId, msg.id))
        : []

      return {
        id: msg.id,
        conversationId: msg.conversationId,
        senderId: msg.senderId,
        senderName,
        content: msg.content,
        mentions: msg.mentions ?? [],
        attachments: attachments.map((a) => ({
          id: a.id,
          mimeType: a.mimeType,
          fileName: a.fileName,
          fileSize: a.fileSize,
          data: a.data,
          expired: false,
        })),
        deletedAt: null,
        createdAt: msg.createdAt,
      }
    },
    catch: (e) => {
      if (e instanceof ConversationNotFound) return e
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
      const [msg] = await db
        .select()
        .from(messages)
        .where(eq(messages.id, messageId))

      if (!msg) throw new MessageNotFound({ id: messageId })

      // Sender can delete own, admin+ can delete any
      const isAdmin = role === "admin" || role === "superAdmin"
      if (msg.senderId !== deletedBy && !isAdmin) {
        throw new ForbiddenError({ action: "delete_message", role })
      }

      await db
        .update(messages)
        .set({ deletedAt: new Date(), deletedBy })
        .where(eq(messages.id, messageId))

      // Audit log
      await db.transaction(async (tx) => {
        await writeAuditLog(tx, {
          actorId: deletedBy,
          action: "delete",
          entityType: "message",
          entityId: messageId,
          beforeValue: { content: msg.content, senderId: msg.senderId },
          afterValue: null,
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
            ilike(user.name, `%${query.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`),
            sql`${user.role} != ${UNASSIGNED_ROLE}`,
            sql`${user.id} != ${excludeUserId}`
          )
        )
        .limit(20)
        .then((rows) => rows.map((r) => ({ id: r.id, name: r.name, role: r.role ?? "unassigned" }))),
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const addParticipants = (
  conversationId: string,
  userIds: string[],
  addedBy: string
): Effect.Effect<void, ConversationNotFound | ValidationError | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [conv] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))

      if (!conv) throw new ConversationNotFound({ id: conversationId })
      if (!conv.isGroup) throw new ValidationError({ message: "Cannot add participants to a 1:1 conversation" })

      // Verify adder is a participant
      const [adder] = await db
        .select({ id: conversationParticipants.id })
        .from(conversationParticipants)
        .where(and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, addedBy)
        ))

      if (!adder) throw new ConversationNotFound({ id: conversationId })

      // Add new participants (ignore duplicates via ON CONFLICT)
      for (const userId of userIds) {
        await db
          .insert(conversationParticipants)
          .values({ conversationId, userId })
          .onConflictDoNothing()
      }
    },
    catch: (e) => {
      if (e instanceof ConversationNotFound) return e
      if (e instanceof ValidationError) return e
      return new DatabaseError({ cause: e })
    },
  })

export const cleanupExpiredAttachments = (): Effect.Effect<number, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const deleted = await db
        .delete(messageAttachments)
        .where(sql`${messageAttachments.expiresAt} < now()`)
        .returning({ id: messageAttachments.id })
      return deleted.length
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const getConversationParticipants = (
  conversationId: string
): Effect.Effect<ChatUser[], DatabaseError> =>
  Effect.tryPromise({
    try: () =>
      db
        .select({ id: user.id, name: user.name, role: user.role })
        .from(conversationParticipants)
        .innerJoin(user, eq(conversationParticipants.userId, user.id))
        .where(eq(conversationParticipants.conversationId, conversationId))
        .then((rows) => rows.map((r) => ({ id: r.id, name: r.name, role: r.role ?? "unassigned" }))),
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --pretty 2>&1 | head -40
```

- [ ] **Step 3: Commit**

```bash
git add src/services/chat.service.ts
git commit -m "feat: add chat service with Effect-based business logic

Includes createConversation (with 1:1 dedup), getConversations,
getMessages, sendMessage, deleteMessage, markAsRead, searchUsers,
addParticipants, and cleanupExpiredAttachments."
```

---

## Task 4: Chat Server Actions

**Files:**
- Create: `src/actions/chat.actions.ts`

- [ ] **Step 1: Create chat actions**

Create `src/actions/chat.actions.ts`:

```typescript
"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
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
import { ConversationNotFound, MessageNotFound, ForbiddenError, ValidationError } from "@/lib/errors"
import { ROLE_LEVELS, type UserRole } from "@/types"
import type { CreateConversationInput, SendMessageInput } from "@/types"

async function getAuthedUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.loanOfficer) return null
  return { id: session.user.id, role }
}

export async function createConversationAction(input: CreateConversationInput) {
  const authedUser = await getAuthedUser()
  if (!authedUser) return { error: "Unauthorized" }

  if (!input.participantIds?.length) {
    return { error: "At least one participant is required" }
  }

  try {
    const data = await Effect.runPromise(
      createConversation(authedUser.id, input.participantIds, input.name)
    )
    return { data }
  } catch (error) {
    if (error instanceof ValidationError) return { error: error.message }
    return { error: "Internal server error" }
  }
}

export async function getConversationsAction() {
  const authedUser = await getAuthedUser()
  if (!authedUser) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(getConversations(authedUser.id))
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function getMessagesAction(conversationId: string, cursor?: string) {
  const authedUser = await getAuthedUser()
  if (!authedUser) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(
      getMessages(conversationId, authedUser.id, cursor)
    )
    return { data }
  } catch (error) {
    if (error instanceof ConversationNotFound) return { error: "Conversation not found" }
    return { error: "Internal server error" }
  }
}

export async function sendMessageAction(input: SendMessageInput) {
  const authedUser = await getAuthedUser()
  if (!authedUser) return { error: "Unauthorized" }

  if (!input.content?.trim() && (!input.attachments || input.attachments.length === 0)) {
    return { error: "Message content or attachment is required" }
  }

  try {
    const data = await Effect.runPromise(
      sendMessage(
        input.conversationId,
        authedUser.id,
        input.content,
        input.mentions ?? [],
        input.attachments ?? []
      )
    )
    return { data }
  } catch (error) {
    if (error instanceof ConversationNotFound) return { error: "Conversation not found" }
    if (error instanceof ValidationError) return { error: error.message }
    return { error: "Internal server error" }
  }
}

export async function deleteMessageAction(messageId: string) {
  const authedUser = await getAuthedUser()
  if (!authedUser) return { error: "Unauthorized" }

  try {
    await Effect.runPromise(deleteMessage(messageId, authedUser.id, authedUser.role))
    return { data: { success: true } }
  } catch (error) {
    if (error instanceof MessageNotFound) return { error: "Message not found" }
    if (error instanceof ForbiddenError) return { error: "You do not have permission to delete this message" }
    return { error: "Internal server error" }
  }
}

export async function markAsReadAction(conversationId: string) {
  const authedUser = await getAuthedUser()
  if (!authedUser) return { error: "Unauthorized" }

  try {
    await Effect.runPromise(markAsRead(conversationId, authedUser.id))
    return { data: { success: true } }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function searchUsersAction(query: string) {
  const authedUser = await getAuthedUser()
  if (!authedUser) return { error: "Unauthorized" }

  if (!query || query.length < 2) {
    return { data: [] }
  }

  try {
    const data = await Effect.runPromise(searchUsers(query, authedUser.id))
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function addParticipantsAction(conversationId: string, userIds: string[]) {
  const authedUser = await getAuthedUser()
  if (!authedUser) return { error: "Unauthorized" }

  try {
    await Effect.runPromise(addParticipants(conversationId, userIds, authedUser.id))
    return { data: { success: true } }
  } catch (error) {
    if (error instanceof ConversationNotFound) return { error: "Conversation not found" }
    if (error instanceof ValidationError) return { error: error.message }
    return { error: "Internal server error" }
  }
}

export async function getConversationParticipantsAction(conversationId: string) {
  const authedUser = await getAuthedUser()
  if (!authedUser) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(getConversationParticipants(conversationId))
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/actions/chat.actions.ts
git commit -m "feat: add chat server actions with auth and role checks"
```

---

## Task 5: React Query Hooks

**Files:**
- Modify: `src/hooks/query-keys.ts`
- Create: `src/hooks/use-conversations.ts`
- Create: `src/hooks/use-messages.ts`
- Create: `src/hooks/use-send-message.ts`
- Create: `src/hooks/use-create-conversation.ts`
- Create: `src/hooks/use-delete-message.ts`
- Create: `src/hooks/use-search-users.ts`

- [ ] **Step 1: Add chat query keys**

Add to `src/hooks/query-keys.ts` before the closing `} as const`:

```typescript
  chat: {
    all: ["chat"] as const,
    conversations: () => [...queryKeys.chat.all, "conversations"] as const,
    messages: (conversationId: string) => [...queryKeys.chat.all, "messages", conversationId] as const,
    users: (query: string) => [...queryKeys.chat.all, "users", query] as const,
    participants: (conversationId: string) => [...queryKeys.chat.all, "participants", conversationId] as const,
  },
```

- [ ] **Step 2: Create use-conversations hook**

Create `src/hooks/use-conversations.ts`:

```typescript
"use client"

import { useQuery } from "@tanstack/react-query"
import { getConversationsAction } from "@/actions/chat.actions"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import type { ConversationListItem } from "@/types"

export function useConversations() {
  return useQuery<ConversationListItem[]>({
    queryKey: queryKeys.chat.conversations(),
    queryFn: async () => {
      const result = await getConversationsAction()
      return unwrapAction(result as { data: ConversationListItem[] } | { error: string })
    },
    refetchInterval: 30_000,
  })
}
```

- [ ] **Step 3: Create use-messages hook**

Create `src/hooks/use-messages.ts`:

```typescript
"use client"

import { useQuery } from "@tanstack/react-query"
import { getMessagesAction } from "@/actions/chat.actions"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import type { MessageWithSender } from "@/types"

export function useMessages(conversationId: string | null) {
  return useQuery<MessageWithSender[]>({
    queryKey: queryKeys.chat.messages(conversationId ?? ""),
    queryFn: async () => {
      if (!conversationId) return []
      const result = await getMessagesAction(conversationId)
      return unwrapAction(result as { data: MessageWithSender[] } | { error: string })
    },
    enabled: !!conversationId,
    refetchInterval: 5_000,
  })
}
```

- [ ] **Step 4: Create use-send-message hook**

Create `src/hooks/use-send-message.ts`:

```typescript
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { sendMessageAction } from "@/actions/chat.actions"
import { queryKeys } from "./query-keys"
import type { SendMessageInput, MessageWithSender } from "@/types"

export function useSendMessage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: SendMessageInput) => sendMessageAction(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.chat.messages(input.conversationId),
      })

      const previousMessages = queryClient.getQueryData<MessageWithSender[]>(
        queryKeys.chat.messages(input.conversationId)
      )

      // Optimistic message
      const optimistic: MessageWithSender = {
        id: `optimistic-${Date.now()}`,
        conversationId: input.conversationId,
        senderId: "current-user",
        senderName: "You",
        content: input.content,
        mentions: input.mentions ?? [],
        attachments: [],
        deletedAt: null,
        createdAt: new Date(),
      }

      queryClient.setQueryData<MessageWithSender[]>(
        queryKeys.chat.messages(input.conversationId),
        (old) => [...(old ?? []), optimistic]
      )

      return { previousMessages }
    },
    onError: (_err, input, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(
          queryKeys.chat.messages(input.conversationId),
          context.previousMessages
        )
      }
      toast.error("Failed to send message")
    },
    onSuccess: (result, input) => {
      if ("error" in result) {
        toast.error(result.error)
        return
      }
    },
    onSettled: (_data, _error, input) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.chat.messages(input.conversationId),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.chat.conversations(),
      })
    },
  })
}
```

- [ ] **Step 5: Create use-create-conversation hook**

Create `src/hooks/use-create-conversation.ts`:

```typescript
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { createConversationAction } from "@/actions/chat.actions"
import { queryKeys } from "./query-keys"
import type { CreateConversationInput } from "@/types"

export function useCreateConversation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateConversationInput) => createConversationAction(input),
    onSuccess: (result) => {
      if ("error" in result) {
        toast.error(result.error)
        return
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chat.conversations() })
    },
  })
}
```

- [ ] **Step 6: Create use-delete-message hook**

Create `src/hooks/use-delete-message.ts`:

```typescript
"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { deleteMessageAction } from "@/actions/chat.actions"
import { queryKeys } from "./query-keys"
import type { MessageWithSender } from "@/types"

export function useDeleteMessage(conversationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (messageId: string) => deleteMessageAction(messageId),
    onMutate: async (messageId) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.chat.messages(conversationId),
      })

      const previousMessages = queryClient.getQueryData<MessageWithSender[]>(
        queryKeys.chat.messages(conversationId)
      )

      queryClient.setQueryData<MessageWithSender[]>(
        queryKeys.chat.messages(conversationId),
        (old) =>
          old?.map((m) =>
            m.id === messageId ? { ...m, deletedAt: new Date() } : m
          )
      )

      return { previousMessages }
    },
    onError: (_err, _messageId, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(
          queryKeys.chat.messages(conversationId),
          context.previousMessages
        )
      }
      toast.error("Failed to delete message")
    },
    onSuccess: (result) => {
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success("Message deleted")
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.chat.messages(conversationId),
      })
    },
  })
}
```

- [ ] **Step 7: Create use-search-users hook**

Create `src/hooks/use-search-users.ts`:

```typescript
"use client"

import { useQuery } from "@tanstack/react-query"
import { searchUsersAction } from "@/actions/chat.actions"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import type { ChatUser } from "@/types"

export function useSearchUsers(query: string) {
  return useQuery<ChatUser[]>({
    queryKey: queryKeys.chat.users(query),
    queryFn: async () => {
      const result = await searchUsersAction(query)
      return unwrapAction(result as { data: ChatUser[] } | { error: string })
    },
    enabled: query.length >= 2,
  })
}
```

- [ ] **Step 8: Commit**

```bash
git add src/hooks/query-keys.ts src/hooks/use-conversations.ts src/hooks/use-messages.ts src/hooks/use-send-message.ts src/hooks/use-create-conversation.ts src/hooks/use-delete-message.ts src/hooks/use-search-users.ts
git commit -m "feat: add React Query hooks for chat with polling"
```

---

## Task 6: Chat UI Components

**Files:**
- Create: `src/components/chat/conversation-list.tsx`
- Create: `src/components/chat/conversation-item.tsx`
- Create: `src/components/chat/message-thread.tsx`
- Create: `src/components/chat/message-bubble.tsx`
- Create: `src/components/chat/message-input.tsx`
- Create: `src/components/chat/mention-popover.tsx`
- Create: `src/components/chat/new-conversation-dialog.tsx`
- Create: `src/components/chat/image-lightbox.tsx`
- Create: `src/app/(app)/chat/page.tsx`
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Create ConversationItem component**

Create `src/components/chat/conversation-item.tsx`:

```typescript
"use client"

import { cn } from "@/lib/utils"
import type { ConversationListItem } from "@/types"

interface ConversationItemProps {
  conversation: ConversationListItem
  isActive: boolean
  currentUserId: string
  onClick: () => void
}

export function ConversationItem({ conversation, isActive, currentUserId, onClick }: ConversationItemProps) {
  const displayName = conversation.isGroup
    ? conversation.name ?? conversation.participants.map((p) => p.name).join(", ")
    : conversation.participants.find((p) => p.id !== currentUserId)?.name ?? "Unknown"

  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-3 text-left rounded-md transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "hover:bg-muted"
      )}
    >
      <div className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {conversation.lastMessage && (
            <span className="text-xs text-muted-foreground shrink-0">
              {formatTime(conversation.lastMessage.createdAt)}
            </span>
          )}
        </div>
        {conversation.lastMessage && (
          <p className="text-xs text-muted-foreground truncate">
            {conversation.lastMessage.senderName}: {conversation.lastMessage.content}
          </p>
        )}
      </div>
      {conversation.unreadCount > 0 && (
        <span className="bg-primary text-primary-foreground text-xs rounded-full h-5 min-w-5 flex items-center justify-center px-1.5 shrink-0">
          {conversation.unreadCount}
        </span>
      )}
    </button>
  )
}

function formatTime(date: Date): string {
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const dayMs = 86400000

  if (diff < dayMs && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
  if (diff < 7 * dayMs) {
    return d.toLocaleDateString([], { weekday: "short" })
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" })
}
```

- [ ] **Step 2: Create NewConversationDialog component**

Create `src/components/chat/new-conversation-dialog.tsx`:

```typescript
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSearchUsers } from "@/hooks/use-search-users"
import { useCreateConversation } from "@/hooks/use-create-conversation"
import { X, Search, MessageSquarePlus } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ChatUser } from "@/types"

interface NewConversationDialogProps {
  open: boolean
  onClose: () => void
  onCreated: (conversationId: string) => void
}

export function NewConversationDialog({ open, onClose, onCreated }: NewConversationDialogProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedUsers, setSelectedUsers] = useState<ChatUser[]>([])
  const [groupName, setGroupName] = useState("")

  const { data: users = [] } = useSearchUsers(searchQuery)
  const createConversation = useCreateConversation()

  if (!open) return null

  const toggleUser = (user: ChatUser) => {
    setSelectedUsers((prev) =>
      prev.some((u) => u.id === user.id)
        ? prev.filter((u) => u.id !== user.id)
        : [...prev, user]
    )
  }

  const handleCreate = async () => {
    if (selectedUsers.length === 0) return

    const result = await createConversation.mutateAsync({
      participantIds: selectedUsers.map((u) => u.id),
      name: selectedUsers.length > 1 ? groupName || undefined : undefined,
    })

    if ("data" in result) {
      onCreated(result.data.id)
      setSearchQuery("")
      setSelectedUsers([])
      setGroupName("")
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-lg w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">New Conversation</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-4 space-y-4">
          {/* Selected users */}
          {selectedUsers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedUsers.map((u) => (
                <span
                  key={u.id}
                  className="inline-flex items-center gap-1 bg-primary/10 text-primary text-sm px-2 py-1 rounded-full"
                >
                  {u.name}
                  <button onClick={() => toggleUser(u)} className="hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Group name (only for 2+ selected) */}
          {selectedUsers.length > 1 && (
            <Input
              placeholder="Group name (optional)"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>

          {/* User list */}
          <div className="max-h-60 overflow-y-auto space-y-1">
            {users
              .filter((u) => !selectedUsers.some((s) => s.id === u.id))
              .map((u) => (
                <button
                  key={u.id}
                  onClick={() => toggleUser(u)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted text-left"
                >
                  <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                    {u.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{u.role}</p>
                  </div>
                </button>
              ))}
            {searchQuery.length >= 2 && users.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No users found</p>
            )}
          </div>
        </div>

        <div className="p-4 border-t">
          <Button
            onClick={handleCreate}
            disabled={selectedUsers.length === 0 || createConversation.isPending}
            className="w-full"
          >
            <MessageSquarePlus className="h-4 w-4 mr-2" />
            {selectedUsers.length > 1 ? "Start Group Chat" : "Start Chat"}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create ConversationList component**

Create `src/components/chat/conversation-list.tsx`:

```typescript
"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ConversationItem } from "./conversation-item"
import { NewConversationDialog } from "./new-conversation-dialog"
import { Search, Plus, MessageSquare } from "lucide-react"
import { useConversations } from "@/hooks/use-conversations"
import type { ConversationListItem } from "@/types"

interface ConversationListProps {
  activeConversationId: string | null
  currentUserId: string
  onSelectConversation: (id: string) => void
}

export function ConversationList({ activeConversationId, currentUserId, onSelectConversation }: ConversationListProps) {
  const [search, setSearch] = useState("")
  const [showNewDialog, setShowNewDialog] = useState(false)
  const { data: conversations = [], isLoading } = useConversations()

  const filtered = search
    ? conversations.filter((c) => {
        const names = c.participants.map((p) => p.name.toLowerCase())
        const groupName = c.name?.toLowerCase() ?? ""
        const query = search.toLowerCase()
        return names.some((n) => n.includes(query)) || groupName.includes(query)
      })
    : conversations

  return (
    <>
      <div className="flex flex-col h-full border-r">
        <div className="p-3 space-y-3 border-b">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Messages</h2>
            <Button variant="ghost" size="icon" onClick={() => setShowNewDialog(true)} aria-label="New conversation">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoading && (
            <div className="space-y-3 p-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="h-10 w-10 rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-muted rounded w-3/4" />
                    <div className="h-2 bg-muted rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <MessageSquare className="h-10 w-10 mb-3 opacity-50" />
              {search ? (
                <p className="text-sm">No conversations match &quot;{search}&quot;</p>
              ) : (
                <>
                  <p className="text-sm font-medium">No conversations yet</p>
                  <p className="text-xs mt-1">Start a new chat to begin messaging</p>
                </>
              )}
            </div>
          )}

          {filtered.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isActive={conv.id === activeConversationId}
              currentUserId={currentUserId}
              onClick={() => onSelectConversation(conv.id)}
            />
          ))}
        </div>
      </div>

      <NewConversationDialog
        open={showNewDialog}
        onClose={() => setShowNewDialog(false)}
        onCreated={onSelectConversation}
      />
    </>
  )
}
```

- [ ] **Step 4: Create MentionPopover component**

Create `src/components/chat/mention-popover.tsx`:

```typescript
"use client"

import { useEffect, useRef } from "react"
import type { ChatUser } from "@/types"

interface MentionPopoverProps {
  users: ChatUser[]
  query: string
  position: { top: number; left: number }
  onSelect: (user: ChatUser) => void
  selectedIndex: number
}

export function MentionPopover({ users, query, position, onSelect, selectedIndex }: MentionPopoverProps) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const activeEl = listRef.current?.querySelector("[data-active='true']")
    activeEl?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  const filtered = users.filter((u) =>
    u.name.toLowerCase().includes(query.toLowerCase())
  )

  if (filtered.length === 0) return null

  return (
    <div
      ref={listRef}
      className="absolute z-50 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto py-1"
      style={{ bottom: position.top, left: position.left }}
    >
      {filtered.map((user, i) => (
        <button
          key={user.id}
          data-active={i === selectedIndex}
          onClick={() => onSelect(user)}
          className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent ${
            i === selectedIndex ? "bg-accent" : ""
          }`}
        >
          <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs">
            {user.name[0].toUpperCase()}
          </div>
          <span>{user.name}</span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Create MessageInput component**

Create `src/components/chat/message-input.tsx`:

```typescript
"use client"

import { useState, useRef, useCallback, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import { MentionPopover } from "./mention-popover"
import { Send, Paperclip, X } from "lucide-react"
import type { ChatUser } from "@/types"

interface MessageInputProps {
  onSend: (content: string, mentions: string[], attachments: { data: string; mimeType: string; fileName: string; fileSize: number }[]) => void
  participants: ChatUser[]
  disabled?: boolean
}

const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_FILES = 3
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

export function MessageInput({ onSend, participants, disabled }: MessageInputProps) {
  const [content, setContent] = useState("")
  const [mentions, setMentions] = useState<string[]>([])
  const [attachments, setAttachments] = useState<{ data: string; mimeType: string; fileName: string; fileSize: number }[]>([])
  const [showMention, setShowMention] = useState(false)
  const [mentionQuery, setMentionQuery] = useState("")
  const [mentionIndex, setMentionIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleContentChange = (value: string) => {
    setContent(value)

    // Detect @ trigger
    const textarea = textareaRef.current
    if (!textarea) return

    const cursorPos = textarea.selectionStart
    const textBeforeCursor = value.substring(0, cursorPos)
    const atIndex = textBeforeCursor.lastIndexOf("@")

    if (atIndex !== -1 && (atIndex === 0 || textBeforeCursor[atIndex - 1] === " ")) {
      const query = textBeforeCursor.substring(atIndex + 1)
      if (!query.includes(" ")) {
        setShowMention(true)
        setMentionQuery(query)
        setMentionIndex(0)
        return
      }
    }
    setShowMention(false)
  }

  const handleMentionSelect = useCallback((user: ChatUser) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const cursorPos = textarea.selectionStart
    const textBeforeCursor = content.substring(0, cursorPos)
    const atIndex = textBeforeCursor.lastIndexOf("@")

    const before = content.substring(0, atIndex)
    const after = content.substring(cursorPos)
    const newContent = `${before}@${user.name} ${after}`

    setContent(newContent)
    setMentions((prev) => [...new Set([...prev, user.id])])
    setShowMention(false)

    // Refocus textarea
    setTimeout(() => {
      textarea.focus()
      const newPos = atIndex + user.name.length + 2
      textarea.setSelectionRange(newPos, newPos)
    }, 0)
  }, [content])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMention) {
      const filteredUsers = participants.filter((u) =>
        u.name.toLowerCase().includes(mentionQuery.toLowerCase())
      )
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setMentionIndex((prev) => Math.min(prev + 1, filteredUsers.length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setMentionIndex((prev) => Math.max(prev - 1, 0))
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        if (filteredUsers[mentionIndex]) {
          handleMentionSelect(filteredUsers[mentionIndex])
        }
        return
      }
      if (e.key === "Escape") {
        setShowMention(false)
        return
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = () => {
    if (!content.trim() && attachments.length === 0) return
    onSend(content, mentions, attachments)
    setContent("")
    setMentions([])
    setAttachments([])
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (attachments.length + files.length > MAX_FILES) {
      return
    }

    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) continue
      if (file.size > MAX_FILE_SIZE) continue

      const data = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(",")[1])
        reader.readAsDataURL(file)
      })

      setAttachments((prev) => [...prev, {
        data,
        mimeType: file.type,
        fileName: file.name,
        fileSize: file.size,
      }])
    }

    // Reset file input
    e.target.value = ""
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="border-t p-3">
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {attachments.map((att, i) => (
            <div key={i} className="relative group">
              <img
                src={`data:${att.mimeType};base64,${att.data}`}
                alt={att.fileName}
                className="h-16 w-16 object-cover rounded-md border"
              />
              <button
                onClick={() => removeAttachment(i)}
                className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full h-5 w-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="relative flex items-end gap-2">
        {showMention && (
          <MentionPopover
            users={participants}
            query={mentionQuery}
            position={{ top: 8, left: 0 }}
            onSelect={handleMentionSelect}
            selectedIndex={mentionIndex}
          />
        )}

        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || attachments.length >= MAX_FILES}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... Use @ to mention"
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm min-h-[40px] max-h-[120px] overflow-y-auto focus:outline-none focus:ring-2 focus:ring-ring"
          style={{ height: "auto" }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement
            target.style.height = "auto"
            target.style.height = `${Math.min(target.scrollHeight, 120)}px`
          }}
        />

        <Button
          size="icon"
          className="shrink-0"
          onClick={handleSend}
          disabled={disabled || (!content.trim() && attachments.length === 0)}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Create ImageLightbox component**

Create `src/components/chat/image-lightbox.tsx`:

```typescript
"use client"

import { X } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ImageLightboxProps {
  src: string
  alt: string
  onClose: () => void
}

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-4 right-4 text-white hover:bg-white/20"
        onClick={onClose}
      >
        <X className="h-6 w-6" />
      </Button>
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-[90vh] object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
```

- [ ] **Step 7: Create MessageBubble component**

Create `src/components/chat/message-bubble.tsx`:

```typescript
"use client"

import { useState } from "react"
import { ImageLightbox } from "./image-lightbox"
import { Trash2, ImageOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { MessageWithSender } from "@/types"

interface MessageBubbleProps {
  message: MessageWithSender
  isOwn: boolean
  canDelete: boolean
  onDelete: () => void
}

export function MessageBubble({ message, isOwn, canDelete, onDelete }: MessageBubbleProps) {
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)

  if (message.deletedAt) {
    return (
      <div className={cn("flex", isOwn ? "justify-end" : "justify-start")}>
        <div className="px-3 py-2 rounded-lg bg-muted text-muted-foreground text-sm italic max-w-[70%]">
          This message was deleted
        </div>
      </div>
    )
  }

  // Highlight @mentions in content
  const renderContent = (text: string) => {
    const parts = text.split(/(@\w[\w\s]*?)(?=\s@|\s|$)/)
    return parts.map((part, i) => {
      if (part.startsWith("@")) {
        return (
          <span key={i} className="font-semibold text-primary">
            {part}
          </span>
        )
      }
      return part
    })
  }

  return (
    <>
      <div className={cn("flex group", isOwn ? "justify-end" : "justify-start")}>
        <div className={cn("max-w-[70%] space-y-1")}>
          {!isOwn && (
            <p className="text-xs text-muted-foreground ml-1">{message.senderName}</p>
          )}
          <div
            className={cn(
              "px-3 py-2 rounded-lg text-sm relative",
              isOwn ? "bg-primary text-primary-foreground" : "bg-muted"
            )}
          >
            {message.content && <p className="whitespace-pre-wrap">{renderContent(message.content)}</p>}

            {/* Attachments */}
            {message.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {message.attachments.map((att) =>
                  att.expired ? (
                    <div
                      key={att.id}
                      className="h-24 w-24 rounded-md border bg-muted flex flex-col items-center justify-center text-muted-foreground"
                    >
                      <ImageOff className="h-6 w-6 mb-1" />
                      <span className="text-xs">Expired</span>
                    </div>
                  ) : (
                    <img
                      key={att.id}
                      src={`data:${att.mimeType};base64,${att.data}`}
                      alt={att.fileName}
                      className="h-24 w-auto rounded-md cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => setLightboxImage(`data:${att.mimeType};base64,${att.data}`)}
                    />
                  )
                )}
              </div>
            )}

            {/* Timestamp */}
            <p className={cn(
              "text-[10px] mt-1",
              isOwn ? "text-primary-foreground/70" : "text-muted-foreground"
            )}>
              {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>

            {/* Delete button */}
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute -top-2 -right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity bg-background shadow-sm border"
                onClick={onDelete}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage}
          alt="Attachment"
          onClose={() => setLightboxImage(null)}
        />
      )}
    </>
  )
}
```

- [ ] **Step 8: Create MessageThread component**

Create `src/components/chat/message-thread.tsx`:

```typescript
"use client"

import { useEffect, useRef } from "react"
import { useMessages } from "@/hooks/use-messages"
import { useDeleteMessage } from "@/hooks/use-delete-message"
import { useSendMessage } from "@/hooks/use-send-message"
import { markAsReadAction, getConversationParticipantsAction } from "@/actions/chat.actions"
import { MessageBubble } from "./message-bubble"
import { MessageInput } from "./message-input"
import { MessageSquare, Users } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/hooks/query-keys"
import { unwrapAction } from "@/hooks/query-utils"
import { ROLE_LEVELS, type UserRole } from "@/types"
import type { ChatUser } from "@/types"

interface MessageThreadProps {
  conversationId: string | null
  currentUserId: string
  currentUserRole: string
}

export function MessageThread({ conversationId, currentUserId, currentUserRole }: MessageThreadProps) {
  const { data: messagesData = [], isLoading } = useMessages(conversationId)
  const deleteMessage = useDeleteMessage(conversationId ?? "")
  const sendMessage = useSendMessage()
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data: participants = [] } = useQuery<ChatUser[]>({
    queryKey: queryKeys.chat.participants(conversationId ?? ""),
    queryFn: async () => {
      if (!conversationId) return []
      const result = await getConversationParticipantsAction(conversationId)
      return unwrapAction(result as { data: ChatUser[] } | { error: string })
    },
    enabled: !!conversationId,
  })

  // Mark as read when opening conversation
  useEffect(() => {
    if (conversationId) {
      markAsReadAction(conversationId)
    }
  }, [conversationId, messagesData.length])

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messagesData.length])

  if (!conversationId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
        <MessageSquare className="h-12 w-12 mb-3 opacity-50" />
        <p className="text-lg font-medium">Select a conversation</p>
        <p className="text-sm">Choose from your existing conversations or start a new one</p>
      </div>
    )
  }

  // Display messages oldest first
  const sortedMessages = [...messagesData].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )

  const isAdmin = ROLE_LEVELS[(currentUserRole as UserRole) ?? "unassigned"] >= ROLE_LEVELS.admin
  const participantNames = participants
    .filter((p) => p.id !== currentUserId)
    .map((p) => p.name)
    .join(", ")

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center gap-3">
        <Users className="h-5 w-5 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">{participantNames || "Chat"}</p>
          <p className="text-xs text-muted-foreground">{participants.length} participants</p>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="h-8 w-8 rounded-full bg-muted" />
                <div className="space-y-2 flex-1">
                  <div className="h-3 bg-muted rounded w-1/4" />
                  <div className="h-8 bg-muted rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && sortedMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <p className="text-sm">No messages yet. Say hello!</p>
          </div>
        )}

        {sortedMessages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isOwn={msg.senderId === currentUserId}
            canDelete={msg.senderId === currentUserId || isAdmin}
            onDelete={() => deleteMessage.mutate(msg.id)}
          />
        ))}
      </div>

      {/* Input */}
      <MessageInput
        onSend={(content, mentions, attachments) => {
          sendMessage.mutate({
            conversationId,
            content,
            mentions,
            attachments,
          })
        }}
        participants={participants.filter((p) => p.id !== currentUserId)}
        disabled={sendMessage.isPending}
      />
    </div>
  )
}
```

- [ ] **Step 9: Create chat page**

Create `src/app/(app)/chat/page.tsx`:

```typescript
"use client"

import { useState } from "react"
import { useSession } from "@/lib/auth-client"
import { ConversationList } from "@/components/chat/conversation-list"
import { MessageThread } from "@/components/chat/message-thread"

export default function ChatPage() {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const { data: session } = useSession()

  const currentUserId = session?.user?.id ?? ""
  const currentUserRole = session?.user?.role ?? "unassigned"

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <div className="w-80 shrink-0">
        <ConversationList
          activeConversationId={activeConversationId}
          currentUserId={currentUserId}
          onSelectConversation={setActiveConversationId}
        />
      </div>
      <MessageThread
        conversationId={activeConversationId}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
      />
    </div>
  )
}
```

- [ ] **Step 10: Add Chat to sidebar navigation**

In `src/components/layout/sidebar.tsx`, add the `MessageSquare` import:

```typescript
import {
  LayoutDashboard,
  Users,
  Banknote,
  CreditCard,
  Landmark,
  Receipt,
  BarChart3,
  Shield,
  ChevronLeft,
  ChevronRight,
  LogOut,
  ClipboardCheck,
  ArrowRightLeft,
  MessageSquare,
} from "lucide-react"
```

Then in the `getNavGroups` function, add Chat to the Operations group, after the existing items and before the Approvals push:

```typescript
operationsItems.push({ label: "Chat", href: "/chat", icon: MessageSquare })
```

Place it after the Loans item push (line ~51) and before the `if (isSupervisorOrAbove)` check.

- [ ] **Step 11: Verify TypeScript compiles**

```bash
npx tsc --noEmit --pretty 2>&1 | head -40
```

Fix any type errors.

- [ ] **Step 12: Commit**

```bash
git add src/components/chat/ src/app/\(app\)/chat/ src/components/layout/sidebar.tsx
git commit -m "feat: add chat UI with two-panel layout, mentions, and image attachments

Includes conversation list, message thread, @mention popover,
new conversation dialog, image lightbox, and sidebar navigation."
```

---

## Task 7: Attachment Cleanup Cron

**Files:**
- Create: `src/app/api/cron/attachment-cleanup/route.ts`

- [ ] **Step 1: Create cron route**

Create `src/app/api/cron/attachment-cleanup/route.ts`:

```typescript
import { type NextRequest } from "next/server"
import { Effect } from "effect"
import { cleanupExpiredAttachments } from "@/services/chat.service"

export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  }

  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const deletedCount = await Effect.runPromise(cleanupExpiredAttachments())
    return Response.json({
      deleted: deletedCount,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("[Cron] Attachment cleanup failed:", error)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/cron/attachment-cleanup/route.ts
git commit -m "feat: add cron route for expired attachment cleanup"
```

---

## Task 8: Unit Tests

**Files:**
- Create: `src/services/__tests__/chat.service.test.ts`

- [ ] **Step 1: Create unit test file**

Create `src/services/__tests__/chat.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// Mock dependencies
vi.mock("@/lib/db", () => {
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  }
  return { db: mockDb }
})

vi.mock("./audit.service", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("./notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}))

import { db } from "@/lib/db"
import {
  createConversation,
  sendMessage,
  deleteMessage,
  searchUsers,
  markAsRead,
  cleanupExpiredAttachments,
} from "../chat.service"
import { ConversationNotFound, MessageNotFound, ValidationError, ForbiddenError } from "@/lib/errors"

const mockedDb = vi.mocked(db)

describe("chat.service", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("createConversation", () => {
    it("fails with empty participantIds", async () => {
      const exit = await Effect.runPromiseExit(
        createConversation("user1", [])
      )
      expect(exit._tag).toBe("Failure")
    })

    it("creates a new 1:1 conversation when none exists", async () => {
      // Mock: no existing conversation
      mockedDb.execute.mockResolvedValueOnce([] as any)
      // Mock: insert conversation
      mockedDb.insert.mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "conv-1" }]),
        }),
      } as any)
      // Mock: insert participants
      mockedDb.insert.mockReturnValueOnce({
        values: vi.fn().mockResolvedValue(undefined),
      } as any)

      const result = await Effect.runPromise(
        createConversation("user1", ["user2"])
      )
      expect(result.id).toBe("conv-1")
    })

    it("returns existing 1:1 conversation", async () => {
      mockedDb.execute.mockResolvedValueOnce([{ conversation_id: "existing-conv" }] as any)

      const result = await Effect.runPromise(
        createConversation("user1", ["user2"])
      )
      expect(result.id).toBe("existing-conv")
      expect(mockedDb.insert).not.toHaveBeenCalled()
    })
  })

  describe("sendMessage", () => {
    it("fails with empty content and no attachments", async () => {
      // Mock participant check
      mockedDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: "p1" }]),
        }),
      } as any)

      const exit = await Effect.runPromiseExit(
        sendMessage("conv-1", "user1", "   ", [])
      )
      expect(exit._tag).toBe("Failure")
    })

    it("fails when user is not a participant", async () => {
      mockedDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      } as any)

      const exit = await Effect.runPromiseExit(
        sendMessage("conv-1", "user1", "hello", [])
      )
      expect(exit._tag).toBe("Failure")
    })

    it("rejects attachments exceeding 5MB", async () => {
      mockedDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: "p1" }]),
        }),
      } as any)

      const exit = await Effect.runPromiseExit(
        sendMessage("conv-1", "user1", "hello", [], [
          { data: "x", mimeType: "image/png", fileName: "big.png", fileSize: 6 * 1024 * 1024 },
        ])
      )
      expect(exit._tag).toBe("Failure")
    })

    it("rejects unsupported MIME types", async () => {
      mockedDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: "p1" }]),
        }),
      } as any)

      const exit = await Effect.runPromiseExit(
        sendMessage("conv-1", "user1", "hello", [], [
          { data: "x", mimeType: "application/pdf", fileName: "doc.pdf", fileSize: 1000 },
        ])
      )
      expect(exit._tag).toBe("Failure")
    })
  })

  describe("deleteMessage", () => {
    it("fails when message does not exist", async () => {
      mockedDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      } as any)

      const exit = await Effect.runPromiseExit(
        deleteMessage("msg-1", "user1", "loanOfficer")
      )
      expect(exit._tag).toBe("Failure")
    })

    it("fails when non-admin tries to delete others message", async () => {
      mockedDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: "msg-1", senderId: "user2", content: "hi" }]),
        }),
      } as any)

      const exit = await Effect.runPromiseExit(
        deleteMessage("msg-1", "user1", "loanOfficer")
      )
      expect(exit._tag).toBe("Failure")
    })

    it("allows admin to delete any message", async () => {
      mockedDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: "msg-1", senderId: "user2", content: "hi" }]),
        }),
      } as any)
      mockedDb.update.mockReturnValueOnce({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      } as any)
      mockedDb.transaction.mockImplementationOnce(async (fn: any) => fn(mockedDb))
      mockedDb.insert.mockReturnValueOnce({
        values: vi.fn().mockResolvedValue(undefined),
      } as any)

      await Effect.runPromise(deleteMessage("msg-1", "admin1", "admin"))
      expect(mockedDb.update).toHaveBeenCalled()
    })
  })

  describe("searchUsers", () => {
    it("searches users by name excluding unassigned and self", async () => {
      mockedDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              then: vi.fn().mockResolvedValue([
                { id: "u2", name: "Jane", role: "loanOfficer" },
              ]),
            }),
          }),
        }),
      } as any)

      const result = await Effect.runPromise(searchUsers("Jan", "u1"))
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe("Jane")
    })
  })

  describe("cleanupExpiredAttachments", () => {
    it("returns count of deleted attachments", async () => {
      mockedDb.delete.mockReturnValueOnce({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "a1" }, { id: "a2" }]),
        }),
      } as any)

      const result = await Effect.runPromise(cleanupExpiredAttachments())
      expect(result).toBe(2)
    })
  })
})
```

- [ ] **Step 2: Run unit tests**

```bash
npx vitest run src/services/__tests__/chat.service.test.ts --reporter=verbose
```

Fix any failures.

- [ ] **Step 3: Commit**

```bash
git add src/services/__tests__/chat.service.test.ts
git commit -m "test: add unit tests for chat service"
```

---

## Task 9: Integration Tests

**Files:**
- Create: `src/services/__integration__/chat.service.test.ts`

- [ ] **Step 1: Create integration test file**

Create `src/services/__integration__/chat.service.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Exit, Cause } from "effect"
import { resetDb, testDb } from "./setup"
import { user } from "@/lib/db/schema/auth"
import { notifications } from "@/lib/db/schema/notifications"
import { messageAttachments } from "@/lib/db/schema/messages"
import { eq, sql } from "drizzle-orm"
import {
  createConversation,
  getConversations,
  getMessages,
  sendMessage,
  deleteMessage,
  markAsRead,
  searchUsers,
  addParticipants,
  cleanupExpiredAttachments,
} from "../chat.service"

const TEST_TIMEOUT = 30000

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
    // Create test users
    await createTestUser("user1", "Alice Officer", "loanOfficer")
    await createTestUser("user2", "Bob Admin", "admin")
    await createTestUser("user3", "Charlie Super", "superAdmin")
    await createTestUser("unassigned1", "Dan Unassigned", "unassigned")
  }, TEST_TIMEOUT)

  describe("createConversation", () => {
    it("creates a 1:1 conversation", async () => {
      const result = await Effect.runPromise(createConversation("user1", ["user2"]))
      expect(result.id).toBeDefined()
    }, TEST_TIMEOUT)

    it("returns existing 1:1 for same pair", async () => {
      const first = await Effect.runPromise(createConversation("user1", ["user2"]))
      const second = await Effect.runPromise(createConversation("user1", ["user2"]))
      expect(second.id).toBe(first.id)
    }, TEST_TIMEOUT)

    it("creates a group conversation for 3+ participants", async () => {
      const result = await Effect.runPromise(
        createConversation("user1", ["user2", "user3"], "Test Group")
      )
      expect(result.id).toBeDefined()
    }, TEST_TIMEOUT)

    it("fails with empty participants", async () => {
      const exit = await Effect.runPromiseExit(createConversation("user1", []))
      expect(Exit.isFailure(exit)).toBe(true)
    }, TEST_TIMEOUT)
  })

  describe("sendMessage + getMessages", () => {
    it("sends and retrieves messages", async () => {
      const conv = await Effect.runPromise(createConversation("user1", ["user2"]))

      await Effect.runPromise(sendMessage(conv.id, "user1", "Hello!"))
      await Effect.runPromise(sendMessage(conv.id, "user2", "Hi back!"))

      const msgs = await Effect.runPromise(getMessages(conv.id, "user1"))
      expect(msgs).toHaveLength(2)
      expect(msgs.some((m) => m.content === "Hello!")).toBe(true)
      expect(msgs.some((m) => m.content === "Hi back!")).toBe(true)
    }, TEST_TIMEOUT)

    it("rejects message from non-participant", async () => {
      const conv = await Effect.runPromise(createConversation("user1", ["user2"]))
      const exit = await Effect.runPromiseExit(sendMessage(conv.id, "user3", "Sneaky"))
      expect(Exit.isFailure(exit)).toBe(true)
    }, TEST_TIMEOUT)

    it("creates notification for @mentions", async () => {
      const conv = await Effect.runPromise(createConversation("user1", ["user2"]))
      await Effect.runPromise(sendMessage(conv.id, "user1", "@Bob check this", ["user2"]))

      const notifs = await testDb
        .select()
        .from(notifications)
        .where(eq(notifications.userId, "user2"))
      expect(notifs).toHaveLength(1)
      expect(notifs[0].type).toBe("chat_mention")
      expect(notifs[0].referenceType).toBe("conversation")
    }, TEST_TIMEOUT)

    it("sends message with image attachment", async () => {
      const conv = await Effect.runPromise(createConversation("user1", ["user2"]))
      const msg = await Effect.runPromise(
        sendMessage(conv.id, "user1", "See this", [], [
          { data: "iVBORw0KGgo=", mimeType: "image/png", fileName: "test.png", fileSize: 100 },
        ])
      )
      expect(msg.attachments).toHaveLength(1)
      expect(msg.attachments[0].mimeType).toBe("image/png")
      expect(msg.attachments[0].expired).toBe(false)
    }, TEST_TIMEOUT)
  })

  describe("deleteMessage", () => {
    it("sender can delete own message", async () => {
      const conv = await Effect.runPromise(createConversation("user1", ["user2"]))
      const msg = await Effect.runPromise(sendMessage(conv.id, "user1", "Delete me"))
      await Effect.runPromise(deleteMessage(msg.id, "user1", "loanOfficer"))

      const msgs = await Effect.runPromise(getMessages(conv.id, "user1"))
      expect(msgs[0].deletedAt).toBeTruthy()
    }, TEST_TIMEOUT)

    it("admin can delete any message", async () => {
      const conv = await Effect.runPromise(createConversation("user1", ["user2"]))
      const msg = await Effect.runPromise(sendMessage(conv.id, "user1", "Admin will delete"))
      await Effect.runPromise(deleteMessage(msg.id, "user2", "admin"))

      const msgs = await Effect.runPromise(getMessages(conv.id, "user1"))
      expect(msgs[0].deletedAt).toBeTruthy()
    }, TEST_TIMEOUT)

    it("non-admin cannot delete others message", async () => {
      const conv = await Effect.runPromise(createConversation("user1", ["user2"]))
      const msg = await Effect.runPromise(sendMessage(conv.id, "user2", "Protected"))

      const exit = await Effect.runPromiseExit(deleteMessage(msg.id, "user1", "loanOfficer"))
      expect(Exit.isFailure(exit)).toBe(true)
    }, TEST_TIMEOUT)
  })

  describe("getConversations", () => {
    it("returns conversations with unread count", async () => {
      const conv = await Effect.runPromise(createConversation("user1", ["user2"]))
      await Effect.runPromise(sendMessage(conv.id, "user2", "Unread 1"))
      await Effect.runPromise(sendMessage(conv.id, "user2", "Unread 2"))

      const convos = await Effect.runPromise(getConversations("user1"))
      expect(convos).toHaveLength(1)
      expect(convos[0].unreadCount).toBeGreaterThanOrEqual(2)
    }, TEST_TIMEOUT)

    it("marks as read resets unread count", async () => {
      const conv = await Effect.runPromise(createConversation("user1", ["user2"]))
      await Effect.runPromise(sendMessage(conv.id, "user2", "Message"))
      await Effect.runPromise(markAsRead(conv.id, "user1"))

      const convos = await Effect.runPromise(getConversations("user1"))
      expect(convos[0].unreadCount).toBe(0)
    }, TEST_TIMEOUT)
  })

  describe("searchUsers", () => {
    it("finds users by name, excludes unassigned", async () => {
      const results = await Effect.runPromise(searchUsers("Dan", "user1"))
      expect(results).toHaveLength(0) // Dan is unassigned
    }, TEST_TIMEOUT)

    it("finds eligible users", async () => {
      const results = await Effect.runPromise(searchUsers("Alice", "user2"))
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe("Alice Officer")
    }, TEST_TIMEOUT)

    it("excludes requesting user", async () => {
      const results = await Effect.runPromise(searchUsers("Alice", "user1"))
      expect(results).toHaveLength(0)
    }, TEST_TIMEOUT)
  })

  describe("addParticipants", () => {
    it("adds users to group conversation", async () => {
      const conv = await Effect.runPromise(
        createConversation("user1", ["user2", "user3"], "Group")
      )
      // user3 is already in — this should be a no-op for them
      await Effect.runPromise(addParticipants(conv.id, ["user3"], "user1"))
    }, TEST_TIMEOUT)

    it("fails for 1:1 conversation", async () => {
      const conv = await Effect.runPromise(createConversation("user1", ["user2"]))
      const exit = await Effect.runPromiseExit(addParticipants(conv.id, ["user3"], "user1"))
      expect(Exit.isFailure(exit)).toBe(true)
    }, TEST_TIMEOUT)
  })

  describe("cleanupExpiredAttachments", () => {
    it("deletes expired attachments", async () => {
      const conv = await Effect.runPromise(createConversation("user1", ["user2"]))
      const msg = await Effect.runPromise(
        sendMessage(conv.id, "user1", "Photo", [], [
          { data: "aGVsbG8=", mimeType: "image/png", fileName: "old.png", fileSize: 50 },
        ])
      )

      // Manually expire the attachment
      await testDb.execute(
        sql`UPDATE message_attachments SET expires_at = NOW() - INTERVAL '1 day' WHERE message_id = ${msg.id}`
      )

      const deleted = await Effect.runPromise(cleanupExpiredAttachments())
      expect(deleted).toBe(1)

      // Verify attachment is gone
      const remaining = await testDb
        .select()
        .from(messageAttachments)
        .where(eq(messageAttachments.messageId, msg.id))
      expect(remaining).toHaveLength(0)
    }, TEST_TIMEOUT)
  })
})
```

- [ ] **Step 2: Run integration tests**

```bash
npx vitest run --config vitest.integration.config.ts src/services/__integration__/chat.service.test.ts --reporter=verbose
```

Fix any failures.

- [ ] **Step 3: Commit**

```bash
git add src/services/__integration__/chat.service.test.ts
git commit -m "test: add integration tests for chat service against real DB"
```

---

## Task 10: E2E Tests

**Files:**
- Create: `cypress/e2e/chat.cy.ts`

- [ ] **Step 1: Create E2E test file**

Create `cypress/e2e/chat.cy.ts`:

```typescript
describe("Chat", () => {
  let adminEmail: string

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Admin User" }).then((email) => {
      adminEmail = email as unknown as string
    })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  describe("Chat Page", () => {
    it("renders two-panel layout with empty state", () => {
      cy.visit("/chat")
      cy.contains("Messages").should("be.visible")
      cy.contains("Select a conversation").should("be.visible")
    })

    it("shows 'No conversations yet' in sidebar", () => {
      cy.visit("/chat")
      cy.contains("No conversations yet").should("be.visible")
    })
  })

  describe("New Conversation", () => {
    beforeEach(() => {
      // Create a second user to chat with
      cy.task("db:promoteUser", { email: adminEmail, role: "superAdmin" })

      // Register second user
      cy.clearCookies()
      cy.registerAndLogin({ name: "Loan Officer", email: "officer@test.com" })
      cy.task("db:promoteUser", { email: "officer@test.com", role: "loanOfficer" })

      // Log back in as admin
      cy.clearCookies()
      cy.login(adminEmail, "TestPass123!")
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
    })

    it("creates a 1:1 conversation", () => {
      cy.visit("/chat")
      cy.get("[aria-label='New conversation']").click()
      cy.contains("New Conversation").should("be.visible")

      // Search for the other user
      cy.get("input[placeholder='Search users...']").type("Loan")
      cy.contains("Loan Officer").click()
      cy.contains("button", "Start Chat").click()

      // Should show the conversation
      cy.contains("Loan Officer").should("be.visible")
      cy.contains("No messages yet").should("be.visible")
    })

    it("sends and displays a message", () => {
      cy.visit("/chat")
      cy.get("[aria-label='New conversation']").click()
      cy.get("input[placeholder='Search users...']").type("Loan")
      cy.contains("Loan Officer").click()
      cy.contains("button", "Start Chat").click()

      // Send a message
      cy.get("textarea[placeholder*='Type a message']").type("Hello there!")
      cy.get("textarea[placeholder*='Type a message']").type("{enter}")

      // Message should appear
      cy.contains("Hello there!").should("be.visible")
    })
  })

  describe("Navigation", () => {
    it("Chat link is visible in sidebar for loanOfficer+", () => {
      cy.visit("/dashboard")
      cy.get("[data-testid='sidebar-nav']").contains("Chat").should("be.visible")
    })

    it("Chat link navigates to /chat", () => {
      cy.visit("/dashboard")
      cy.get("[data-testid='sidebar-nav']").contains("Chat").click()
      cy.url().should("include", "/chat")
    })
  })

  describe("Message Deletion", () => {
    beforeEach(() => {
      cy.clearCookies()
      cy.registerAndLogin({ name: "Officer Two", email: "officer2@test.com" })
      cy.task("db:promoteUser", { email: "officer2@test.com", role: "loanOfficer" })
      cy.clearCookies()
      cy.login(adminEmail, "TestPass123!")
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
    })

    it("user can delete own message", () => {
      cy.visit("/chat")
      cy.get("[aria-label='New conversation']").click()
      cy.get("input[placeholder='Search users...']").type("Officer")
      cy.contains("Officer Two").click()
      cy.contains("button", "Start Chat").click()

      cy.get("textarea[placeholder*='Type a message']").type("Delete me{enter}")
      cy.contains("Delete me").should("be.visible")

      // Hover to reveal delete button
      cy.contains("Delete me").parents("[class*='group']").first().realHover()
      cy.get("[aria-label='Delete message'], button:has(svg.lucide-trash-2)").first().click({ force: true })

      cy.contains("This message was deleted").should("be.visible")
    })
  })

  describe("Access Control", () => {
    it("unassigned user cannot see Chat in sidebar", () => {
      // Create an unassigned user
      cy.clearCookies()
      cy.registerAndLogin({ name: "Unassigned User", email: "unassigned@test.com" })

      // Don't promote — user stays unassigned
      // They should be on pending-approval, not dashboard
      // The chat link should not be in any visible nav
      cy.visit("/chat")
      // They should be redirected or see unauthorized
      cy.url().should("not.include", "/chat")
    })
  })

  describe("Conversation Search", () => {
    beforeEach(() => {
      cy.clearCookies()
      cy.registerAndLogin({ name: "Search Officer", email: "search@test.com" })
      cy.task("db:promoteUser", { email: "search@test.com", role: "loanOfficer" })
      cy.clearCookies()
      cy.login(adminEmail, "TestPass123!")
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
    })

    it("filters conversations by participant name", () => {
      cy.visit("/chat")

      // Create a conversation first
      cy.get("[aria-label='New conversation']").click()
      cy.get("input[placeholder='Search users...']").type("Search")
      cy.contains("Search Officer").click()
      cy.contains("button", "Start Chat").click()
      cy.get("textarea[placeholder*='Type a message']").type("Test message{enter}")

      // Search for it
      cy.get("input[placeholder='Search conversations...']").type("Search")
      cy.contains("Search Officer").should("be.visible")

      // Clear search and search for non-existent
      cy.get("input[placeholder='Search conversations...']").clear().type("ZZZZZ")
      cy.contains("No conversations match").should("be.visible")
    })
  })
})
```

- [ ] **Step 2: Run E2E tests**

```bash
npx cypress run --spec cypress/e2e/chat.cy.ts
```

Fix any failures.

- [ ] **Step 3: Commit**

```bash
git add cypress/e2e/chat.cy.ts
git commit -m "test: add E2E tests for chat feature

Covers page rendering, conversation creation, messaging,
deletion, access control, and search."
```

---

## Task 11: Final Verification

- [ ] **Step 1: Run all unit tests**

```bash
npx vitest run --reporter=verbose
```

- [ ] **Step 2: Run all integration tests**

```bash
npx vitest run --config vitest.integration.config.ts --reporter=verbose
```

- [ ] **Step 3: Run all E2E tests**

```bash
npx cypress run
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit --pretty
```

- [ ] **Step 5: Fix any remaining issues and commit**

```bash
git add -A
git commit -m "fix: resolve any remaining issues from chat feature implementation"
```
