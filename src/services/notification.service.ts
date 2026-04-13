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
  type: "loan_due_soon",
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
