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

export async function createNotificationsForLoan(
  loanId: string,
  message: string,
  dueDate: Date,
  targetUserIds: string[]
): Promise<void> {
  if (targetUserIds.length === 0) return

  for (const userId of targetUserIds) {
    const existing = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.loanId, loanId),
          sql`date_trunc('day', ${notifications.dueDate}) = date_trunc('day', ${dueDate})`
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
