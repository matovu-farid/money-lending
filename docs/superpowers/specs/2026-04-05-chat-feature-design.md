# Chat Feature Design

**Date:** 2026-04-05
**Status:** Approved

## Overview

Internal messaging system for app users (loanOfficer+) to communicate via 1:1 and ad-hoc group conversations. Features @mentions with notifications, image attachments with auto-expiry, and admin moderation. Uses polling (React Query `refetchInterval`) for real-time updates — no WebSocket infrastructure.

## Database Schema

### `conversations`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | defaultRandom() |
| name | text (nullable) | Optional group name, null for 1:1 |
| isGroup | boolean | false for 1:1, true for multi-user |
| createdBy | text FK → user.id | |
| createdAt | timestamp with timezone | defaultNow() |
| updatedAt | timestamp with timezone | Updated on every new message, used for sorting |

### `conversation_participants`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | defaultRandom() |
| conversationId | uuid FK → conversations.id | cascade delete |
| userId | text FK → user.id | |
| lastReadAt | timestamp with timezone (nullable) | For unread badge counts |
| joinedAt | timestamp with timezone | defaultNow() |
| **unique constraint** | (conversationId, userId) | |

### `messages`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | defaultRandom() |
| conversationId | uuid FK → conversations.id | cascade delete |
| senderId | text FK → user.id | |
| content | text | Message body, may contain @mentions |
| mentions | text[] | Array of mentioned user IDs |
| deletedAt | timestamp with timezone (nullable) | Soft delete for moderation |
| deletedBy | text (nullable) | Who deleted (for audit trail) |
| createdAt | timestamp with timezone | defaultNow() |

### `message_attachments`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | defaultRandom() |
| messageId | uuid FK → messages.id | cascade delete |
| data | text | Base64-encoded image |
| mimeType | text | image/png, image/jpeg, image/gif, image/webp |
| fileName | text | Original filename |
| fileSize | integer | Size in bytes |
| expiresAt | timestamp with timezone | createdAt + 7 days |
| createdAt | timestamp with timezone | defaultNow() |

### Rearchitected `notifications` table

The existing `notifications` table is loan-specific (`loanId`, `dueDate` as required columns). Replace it with a generic, extensible design. Truncate all existing notifications — clean migration.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | defaultRandom() |
| userId | text | Who receives the notification |
| type | notification_type enum | Extensible: `loan_due_soon`, `chat_mention`, future types |
| message | text | Human-readable notification text |
| isRead | boolean | default false |
| referenceType | text (nullable) | `loan`, `conversation`, `message`, etc. |
| referenceId | text (nullable) | ID of the referenced entity |
| metadata | jsonb (nullable) | Type-specific data. Loan: `{ dueDate, loanId }`. Chat: `{ conversationId, senderId }` |
| createdAt | timestamp with timezone | defaultNow() |

This follows the same polymorphic `referenceType`/`referenceId` pattern used by the `transactions` table. Any future notification type adds its own metadata shape without schema changes.

**Migration:** Drop and recreate the `notifications` table. Update all existing code that reads/writes notifications (`notification.service.ts`, cron jobs, UI) to use the new schema.

## Service Layer

**File:** `src/services/chat.service.ts`

All functions return `Effect<T, E>` following existing patterns.

### Functions

- **`createConversation(createdBy, participantIds, name?)`** — Creates conversation + participant rows. For 1:1 (single participantId), checks if a conversation already exists between the two users and returns it instead of creating a duplicate. Sets `isGroup` based on participant count.

- **`getConversations(userId)`** — Lists conversations where user is a participant, ordered by `updatedAt` desc. Returns: conversation metadata, participant names, last message preview (content truncated to 100 chars), unread count (messages with `createdAt > lastReadAt`).

- **`getMessages(conversationId, userId, cursor?)`** — Cursor-based pagination, newest first. Validates user is a participant before returning data. Returns messages with sender info and attachments (attachment data excluded from list query — fetched separately for display).

- **`sendMessage(conversationId, senderId, content, mentions?, attachments?)`** — Inserts message row + attachment rows in a transaction. Updates conversation `updatedAt`. For each mentioned userId, inserts a notification row (type: `chat_mention`) in the existing `notifications` table.

- **`deleteMessage(messageId, deletedBy, role)`** — Soft delete (sets `deletedAt`, `deletedBy`). Sender can delete own messages. `admin`/`superAdmin` can delete any message. Writes to `audit_log`.

- **`markAsRead(conversationId, userId)`** — Updates `lastReadAt` on the `conversation_participants` row to `now()`.

- **`searchUsers(query, excludeUserId)`** — Searches `user` table by name (ilike). Excludes `unassigned` role and the requesting user. Used for new conversation dialog and @mention popover.

- **`addParticipants(conversationId, userIds, addedBy)`** — Adds users to an existing group conversation. Validates conversation is a group (`isGroup = true`).

- **`cleanupExpiredAttachments()`** — Deletes all `message_attachments` rows where `expiresAt < now()`. Called by cron.

## Server Actions

**File:** `src/actions/chat.actions.ts`

All actions:
1. Call `auth.api.getSession()` for authentication
2. Reject `unassigned` role users
3. Call the corresponding service function via `Effect.runPromise()`
4. Call `revalidatePath` where appropriate

Actions: `createConversation`, `sendMessage`, `getConversations`, `getMessages`, `deleteMessage`, `markAsRead`, `searchUsers`, `addParticipants`.

## React Query Hooks

**Directory:** `src/hooks/`

- **`useConversations()`** — `useQuery` with `refetchInterval: 30_000` (30s polling)
- **`useMessages(conversationId)`** — `useQuery` with `refetchInterval: 5_000` (5s polling when chat is open)
- **`useSendMessage()`** — `useMutation` with optimistic update (message appears in UI immediately, rolls back on error)
- **`useCreateConversation()`** — `useMutation`, invalidates conversations query on success
- **`useDeleteMessage()`** — `useMutation` with optimistic removal
- **`useMarkAsRead(conversationId)`** — called on chat open and when new messages arrive
- **`useSearchUsers(query)`** — `useQuery` with debounced input (300ms), `enabled: query.length >= 2`

## UI Components

### Page: `/app/(app)/chat/page.tsx`

Two-panel layout:

**Left panel — Conversation List:**
- Search box at top: filters conversations by participant name
- "New Chat" button
- Conversation items sorted by latest activity
- Each item: participant names (or group name), last message preview, timestamp, unread badge

**Right panel — Message Thread:**
- Header: participant name(s), "Add people" button (groups only)
- Scrollable message list (newest at bottom, infinite scroll upward for older messages)
- Message bubbles: sender name, content with @mentions highlighted (bold + colored), timestamp, inline image attachments
- Deleted messages show "This message was deleted" text
- Expired attachments show "Image expired" placeholder
- Message input area at bottom

**Message Input:**
- Auto-growing textarea
- Image attach button: file picker (image/*, max 5MB, max 3 per message)
- Send button
- "@" trigger: typing "@" opens a popover listing conversation participants, filtered as you type. Selecting inserts `@Name` and records the userId in the mentions array.

### New Conversation Dialog

- Triggered by "New Chat" button
- User search box filtering eligible users (loanOfficer+ roles) by name
- Multi-select: click to toggle users
- 1 user selected → 1:1 (opens existing if found)
- 2+ users selected → group, optional name field appears
- "Start Chat" button

### Component Breakdown

| Component | Purpose |
|---|---|
| `ChatPage` | Layout shell, two-panel responsive design |
| `ConversationList` | Left panel with search + conversation items |
| `ConversationItem` | Single conversation row |
| `MessageThread` | Right panel message display |
| `MessageBubble` | Single message with attachments |
| `MessageInput` | Textarea + attach + mention + send |
| `MentionPopover` | "@" triggered user picker |
| `NewConversationDialog` | User search + multi-select dialog |
| `UserSearchBox` | Shared search component (new conversation + mentions) |
| `ImageLightbox` | Click-to-expand image viewer (shadcn Dialog) |

## Image Handling

### Upload Flow
1. User clicks attach button → file picker (accepts `image/*`)
2. Client validation: file type must be image/*, max 5MB per file, max 3 files per message
3. `FileReader.readAsDataURL()` converts to base64 in browser
4. Base64 data sent with message via `sendMessage` server action
5. Server re-validates (size, MIME type), stores in `message_attachments` with `expiresAt = now + 7 days`

### Display
- Inline in message bubbles: `<img src="data:{mimeType};base64,{data}" />`
- Click opens ImageLightbox (shadcn Dialog)
- After expiry + cleanup: message shows "Image expired" placeholder

### Cleanup Cron
- Route: `/api/cron/attachment-cleanup`
- Schedule: daily
- Action: `DELETE FROM message_attachments WHERE expiresAt < now()`
- Follows existing cron patterns (`/api/cron/overdue`, `/api/cron/month-end`)

## Authorization & Moderation

### Access Control
- `unassigned` role: blocked from all chat features at server action level
- `loanOfficer`, `supervisor`, `admin`, `superAdmin`: full chat access
- Users can only see/access conversations they are a participant in
- `getMessages` validates participant membership before returning data

### Moderation
- Any user can soft-delete their own messages
- `admin` and `superAdmin` can soft-delete any message
- Deletions logged in existing `audit_log` (entityType: `message`, action: `delete`)
- Deleted messages show "This message was deleted" in UI

### @Mention Permissions
- Mention popover only shows users who are participants in the current conversation
- In new conversation dialog, search shows all eligible users

## Notification Integration

- @mentions create a notification in the existing `notifications` table
- New notification type: `chat_mention`
- Notification includes: the mentioned user's ID, conversation ID, message content preview
- Conversation is surfaced to top of mentioned user's list (via `updatedAt` bump on message send)
- Mentioned conversations appear pinned/highlighted until read

## Testing Strategy

### Unit Tests (Vitest, mocked DB)

**File:** `src/services/__tests__/chat.service.test.ts`

- Create 1:1 conversation
- Create group conversation
- Duplicate 1:1 prevention (returns existing)
- Send message with mentions
- Send message with attachments (validates size/type)
- Delete own message
- Admin deletes other's message
- Non-admin cannot delete other's message
- Mark as read updates lastReadAt
- Get conversations returns correct unread counts
- Get messages validates participant membership
- Search users excludes unassigned role
- Add participants to group
- Cannot add participants to 1:1
- Cleanup expired attachments

### Integration Tests (Vitest, real test DB)

**File:** `src/services/__integration__/chat.service.test.ts`

- Full conversation lifecycle: create → send messages → paginate → mark read → verify counts
- 1:1 dedup: create same pair twice → same conversation returned
- Group: create → add participants → send → all participants see messages
- Attachment lifecycle: send with image → query → verify attachment → cleanup after expiry
- Soft delete: delete message → still in DB with deletedAt set → excluded from normal queries
- Mention flow: send with mentions → notifications created

### E2E Tests (Cypress)

**File:** `cypress/e2e/chat.cy.ts`

- Chat page renders with two-panel layout
- Create new 1:1 conversation via user search
- Create group conversation with multiple users
- Send and receive messages (polling delivers new messages)
- "@" mention triggers popover, selecting inserts mention
- @mention creates notification visible in notification area
- Image attachment: upload, display inline, click to expand
- Delete own message — shows "This message was deleted"
- Admin deletes other user's message
- Conversation search/filter by participant name
- Unread badge shows correct count, clears on open
- `unassigned` user cannot access /chat
- Empty state when no conversations exist
