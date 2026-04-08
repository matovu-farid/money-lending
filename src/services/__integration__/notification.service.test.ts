import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import crypto from "node:crypto"
import { resetDb, testDb } from "./setup"
import { createCustomer } from "@/services/customer.service"
import { createLoan } from "@/services/loan.service"
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  createNotificationsForLoan,
} from "@/services/notification.service"
import { notifications } from "@/lib/db/schema/notifications"
import { eq } from "drizzle-orm"

const TEST_TIMEOUT = 30_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeCustomer() {
  return Effect.runPromise(
    createCustomer({
      fullName: "Test Customer",
      nin: "CM00000000TEST",
      contact: "+256700000000",
      address: "Kampala, Uganda",
    })
  )
}

async function makeLoan(customerId: string) {
  return Effect.runPromise(
    createLoan(
      {
        customerId,
        principalAmount: "1000000.00",
        issuanceFee: "50000.00",

        interestRate: "0.10",
        minInterestDays: 30,
        startDate: "2025-01-01",
        collateral: { nature: "Land title", description: "Test collateral" },
        disbursementSource: "cash",
      },
      "test-actor"
    )
  )
}

let seedSeq = 0

async function seedNotification(
  userId: string,
  loanId: string,
  overrides: { isRead?: boolean; dueDate?: Date; message?: string; createdAt?: Date } = {}
) {
  // Monotonically increasing createdAt so ordering is deterministic even when
  // sequential inserts collapse into the same timestamp.
  seedSeq += 1
  const createdAt =
    overrides.createdAt ?? new Date(Date.now() + seedSeq * 1000)

  const dueDate = overrides.dueDate ?? new Date("2026-04-01")

  const [row] = await testDb
    .insert(notifications)
    .values({
      userId,
      type: "loan_due_soon",
      message: overrides.message ?? "Loan payment due soon",
      isRead: overrides.isRead ?? false,
      referenceType: "loan",
      referenceId: loanId,
      metadata: { dueDate: dueDate.toISOString(), loanId },
      createdAt,
    })
    .returning()
  return row
}

describe("Notification Service (integration)", () => {
  let loanId: string
  const userId = "test-user-1"
  const userId2 = "test-user-2"

  beforeEach(async () => {
    seedSeq = 0
    await resetDb()
    const customer = await makeCustomer()
    const loan = await makeLoan(customer.id)
    loanId = loan.id
  }, TEST_TIMEOUT)

  // ── getNotifications ──────────────────────────────────────────────────

  it("returns notifications for a user ordered by createdAt desc", async () => {
    await seedNotification(userId, loanId, { message: "First" })
    // Small delay to ensure different createdAt timestamps
    await seedNotification(userId, loanId, {
      message: "Second",
      dueDate: new Date("2026-05-01"),
    })

    const result = await Effect.runPromise(getNotifications(userId))

    expect(result).toHaveLength(2)
    // Most recent first
    expect(result[0].message).toBe("Second")
    expect(result[1].message).toBe("First")
  }, TEST_TIMEOUT)

  it("returns empty array when user has no notifications", async () => {
    const result = await Effect.runPromise(getNotifications("no-such-user"))
    expect(result).toEqual([])
  }, TEST_TIMEOUT)

  it("does not return notifications belonging to another user", async () => {
    await seedNotification(userId, loanId, { message: "For user-1" })
    await seedNotification(userId2, loanId, {
      message: "For user-2",
      dueDate: new Date("2026-05-01"),
    })

    const result = await Effect.runPromise(getNotifications(userId))

    expect(result).toHaveLength(1)
    expect(result[0].userId).toBe(userId)
  }, TEST_TIMEOUT)

  it("limits results to 20 notifications", async () => {
    // Insert 25 notifications
    for (let i = 0; i < 25; i++) {
      await seedNotification(userId, loanId, {
        message: `Notification ${i}`,
        dueDate: new Date(`2026-04-${String(i + 1).padStart(2, "0")}`),
      })
    }

    const result = await Effect.runPromise(getNotifications(userId))
    expect(result).toHaveLength(20)
  }, TEST_TIMEOUT)

  // ── getUnreadCount ────────────────────────────────────────────────────

  it("returns count of unread notifications", async () => {
    await seedNotification(userId, loanId, { isRead: false })
    await seedNotification(userId, loanId, {
      isRead: false,
      dueDate: new Date("2026-05-01"),
    })
    await seedNotification(userId, loanId, {
      isRead: true,
      dueDate: new Date("2026-06-01"),
    })

    const count = await Effect.runPromise(getUnreadCount(userId))
    expect(count).toBe(2)
  }, TEST_TIMEOUT)

  it("returns 0 when all notifications are read", async () => {
    await seedNotification(userId, loanId, { isRead: true })

    const count = await Effect.runPromise(getUnreadCount(userId))
    expect(count).toBe(0)
  }, TEST_TIMEOUT)

  it("returns 0 when user has no notifications", async () => {
    const count = await Effect.runPromise(getUnreadCount("no-such-user"))
    expect(count).toBe(0)
  }, TEST_TIMEOUT)

  // ── markAsRead ────────────────────────────────────────────────────────

  it("marks a specific notification as read", async () => {
    const notif = await seedNotification(userId, loanId, { isRead: false })

    await Effect.runPromise(markAsRead(notif.id, userId))

    const [updated] = await testDb
      .select()
      .from(notifications)
      .where(eq(notifications.id, notif.id))

    expect(updated.isRead).toBe(true)
  }, TEST_TIMEOUT)

  it("does not mark another user's notification as read", async () => {
    const notif = await seedNotification(userId2, loanId, { isRead: false })

    // user-1 tries to mark user-2's notification
    await Effect.runPromise(markAsRead(notif.id, userId))

    const [unchanged] = await testDb
      .select()
      .from(notifications)
      .where(eq(notifications.id, notif.id))

    expect(unchanged.isRead).toBe(false)
  }, TEST_TIMEOUT)

  // ── markAllAsRead ─────────────────────────────────────────────────────

  it("marks all unread notifications as read for a user", async () => {
    await seedNotification(userId, loanId, { isRead: false })
    await seedNotification(userId, loanId, {
      isRead: false,
      dueDate: new Date("2026-05-01"),
    })
    await seedNotification(userId, loanId, {
      isRead: true,
      dueDate: new Date("2026-06-01"),
    })

    await Effect.runPromise(markAllAsRead(userId))

    const count = await Effect.runPromise(getUnreadCount(userId))
    expect(count).toBe(0)
  }, TEST_TIMEOUT)

  it("does not affect other users' notifications", async () => {
    await seedNotification(userId, loanId, { isRead: false })
    await seedNotification(userId2, loanId, {
      isRead: false,
      dueDate: new Date("2026-05-01"),
    })

    await Effect.runPromise(markAllAsRead(userId))

    const user2Count = await Effect.runPromise(getUnreadCount(userId2))
    expect(user2Count).toBe(1)
  }, TEST_TIMEOUT)

  // ── createNotificationsForLoan ────────────────────────────────────────

  it("creates notifications for multiple users", async () => {
    const dueDate = new Date("2026-04-15")

    await createNotificationsForLoan(
      loanId,
      "Payment due in 3 days",
      dueDate,
      [userId, userId2]
    )

    const user1Notifs = await Effect.runPromise(getNotifications(userId))
    const user2Notifs = await Effect.runPromise(getNotifications(userId2))

    expect(user1Notifs).toHaveLength(1)
    expect(user1Notifs[0].message).toBe("Payment due in 3 days")
    expect(user1Notifs[0].referenceType).toBe("loan")
    expect(user1Notifs[0].referenceId).toBe(loanId)
    expect(user1Notifs[0].type).toBe("loan_due_soon")
    expect(user1Notifs[0].isRead).toBe(false)

    expect(user2Notifs).toHaveLength(1)
    expect(user2Notifs[0].message).toBe("Payment due in 3 days")
  }, TEST_TIMEOUT)

  it("does nothing when targetUserIds is empty", async () => {
    await createNotificationsForLoan(
      loanId,
      "Payment due",
      new Date("2026-04-15"),
      []
    )

    const allNotifs = await testDb.select().from(notifications)
    expect(allNotifs).toHaveLength(0)
  }, TEST_TIMEOUT)

  it("deduplicates: does not insert if notification already exists for same user + loan + dueDate", async () => {
    const dueDate = new Date("2026-04-15")

    // First call — should insert
    await createNotificationsForLoan(loanId, "Due soon", dueDate, [userId])

    // Second call with same parameters — should skip
    await createNotificationsForLoan(loanId, "Due soon again", dueDate, [userId])

    const userNotifs = await Effect.runPromise(getNotifications(userId))
    expect(userNotifs).toHaveLength(1)
    expect(userNotifs[0].message).toBe("Due soon") // original message kept
  }, TEST_TIMEOUT)

  it("allows notifications with different dueDates for the same loan", async () => {
    await createNotificationsForLoan(
      loanId,
      "Due April",
      new Date("2026-04-15"),
      [userId]
    )
    await createNotificationsForLoan(
      loanId,
      "Due May",
      new Date("2026-05-15"),
      [userId]
    )

    const userNotifs = await Effect.runPromise(getNotifications(userId))
    expect(userNotifs).toHaveLength(2)
  }, TEST_TIMEOUT)

  it("newly created notifications default to unread", async () => {
    await createNotificationsForLoan(
      loanId,
      "Payment due",
      new Date("2026-04-15"),
      [userId]
    )

    const count = await Effect.runPromise(getUnreadCount(userId))
    expect(count).toBe(1)
  }, TEST_TIMEOUT)

  // ── markAsRead edge case ───────────────────────────────────────────

  it("markAsRead on nonexistent notification does not throw", async () => {
    const randomId = crypto.randomUUID()

    // Should resolve successfully (silent no-op)
    await expect(
      Effect.runPromise(markAsRead(randomId, userId))
    ).resolves.toBeUndefined()
  }, TEST_TIMEOUT)
})
