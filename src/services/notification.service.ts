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

/**
 * Used by cron to create per-user notifications for a loan.
 * Plain async (not Effect) — called from Route Handler context (same pattern as writeAuditLog).
 * Dedup: checks for existing notification with same userId + loanId + dueDate before inserting.
 */
export async function createNotificationsForLoan(
  loanId: string,
  message: string,
  dueDate: Date,
  targetUserIds: string[]
): Promise<void> {
  if (targetUserIds.length === 0) return

  for (const userId of targetUserIds) {
    // Check if notification already exists for this user + loan + due date (dedup)
    const existing = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.loanId, loanId),
          eq(notifications.dueDate, dueDate)
        )
      )
      .limit(1)

    if (existing.length === 0) {
      await db.insert(notifications).values({
        userId,
        loanId,
        type: "loan_due_soon",
        message,
        dueDate,
        isRead: false,
      })
    }
  }
}
