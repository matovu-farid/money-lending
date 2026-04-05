import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect, Exit } from "effect"

vi.mock("@/lib/db", () => {
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  }
  return { db: mockDb }
})

describe("Notification Service", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  // ── getNotifications ──────────────────────────────────────────────────

  it("getNotifications returns notifications for a user", async () => {
    const { db } = await import("@/lib/db")
    const { getNotifications } = await import("@/services/notification.service")
    const mockedDb = vi.mocked(db)

    const mockNotifications = [
      {
        id: "notif-1",
        userId: "user-1",
        type: "loan_due_soon",
        message: "Loan due in 3 days",
        isRead: false,
        referenceType: "loan",
        referenceId: "loan-1",
        metadata: { dueDate: "2026-04-01T00:00:00.000Z", loanId: "loan-1" },
        createdAt: new Date("2026-03-28"),
      },
    ]

    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(mockNotifications),
          }),
        }),
      }),
    } as any)

    const result = await Effect.runPromise(getNotifications("user-1"))

    expect(result).toEqual(mockNotifications)
    expect(mockedDb.select).toHaveBeenCalledTimes(1)
  })

  it("getNotifications wraps db errors in DatabaseError", async () => {
    const { db } = await import("@/lib/db")
    const { getNotifications } = await import("@/services/notification.service")
    const mockedDb = vi.mocked(db)

    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error("connection failed")),
          }),
        }),
      }),
    } as any)

    const exit = await Effect.runPromiseExit(getNotifications("user-1"))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  // ── getUnreadCount ────────────────────────────────────────────────────

  it("getUnreadCount returns the unread count", async () => {
    const { db } = await import("@/lib/db")
    const { getUnreadCount } = await import("@/services/notification.service")
    const mockedDb = vi.mocked(db)

    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 5 }]),
      }),
    } as any)

    const result = await Effect.runPromise(getUnreadCount("user-1"))
    expect(result).toBe(5)
  })

  it("getUnreadCount returns 0 when no unread notifications", async () => {
    const { db } = await import("@/lib/db")
    const { getUnreadCount } = await import("@/services/notification.service")
    const mockedDb = vi.mocked(db)

    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 0 }]),
      }),
    } as any)

    const result = await Effect.runPromise(getUnreadCount("user-1"))
    expect(result).toBe(0)
  })

  it("getUnreadCount: empty DB result (no rows) causes upstream error", async () => {
    const { db } = await import("@/lib/db")
    const { getUnreadCount } = await import("@/services/notification.service")
    const mockedDb = vi.mocked(db)

    // Drizzle returns [] when no rows match — destructuring [result] gives undefined
    // so result.count throws, which gets wrapped in DatabaseError
    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any)

    const exit = await Effect.runPromiseExit(getUnreadCount("user-1"))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  // ── markAsRead ────────────────────────────────────────────────────────

  it("markAsRead updates a specific notification", async () => {
    const { db } = await import("@/lib/db")
    const { markAsRead } = await import("@/services/notification.service")
    const mockedDb = vi.mocked(db)

    mockedDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    } as any)

    const result = await Effect.runPromise(markAsRead("notif-1", "user-1"))
    expect(result).toBeUndefined()
    expect(mockedDb.update).toHaveBeenCalledTimes(1)
  })

  it("markAsRead wraps db errors in DatabaseError", async () => {
    const { db } = await import("@/lib/db")
    const { markAsRead } = await import("@/services/notification.service")
    const mockedDb = vi.mocked(db)

    mockedDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error("db error")),
      }),
    } as any)

    const exit = await Effect.runPromiseExit(markAsRead("notif-1", "user-1"))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  // ── markAllAsRead ─────────────────────────────────────────────────────

  it("markAllAsRead updates all unread notifications for a user", async () => {
    const { db } = await import("@/lib/db")
    const { markAllAsRead } = await import("@/services/notification.service")
    const mockedDb = vi.mocked(db)

    mockedDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    } as any)

    const result = await Effect.runPromise(markAllAsRead("user-1"))
    expect(result).toBeUndefined()
    expect(mockedDb.update).toHaveBeenCalledTimes(1)
  })

  // ── createNotificationsForLoan ────────────────────────────────────────

  it("createNotificationsForLoan does nothing for empty targetUserIds", async () => {
    const { db } = await import("@/lib/db")
    const { createNotificationsForLoan } = await import("@/services/notification.service")
    const mockedDb = vi.mocked(db)

    await createNotificationsForLoan("loan-1", "Loan due", new Date(), [])

    expect(mockedDb.select).not.toHaveBeenCalled()
    expect(mockedDb.insert).not.toHaveBeenCalled()
  })

  it("createNotificationsForLoan inserts when no existing notification", async () => {
    const { db } = await import("@/lib/db")
    const { createNotificationsForLoan } = await import("@/services/notification.service")
    const mockedDb = vi.mocked(db)

    // Mock select for dedup check — returns empty (no existing)
    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as any)

    // Mock insert
    mockedDb.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    } as any)

    await createNotificationsForLoan(
      "loan-1",
      "Loan due in 3 days",
      new Date("2026-04-01"),
      ["user-1"]
    )

    expect(mockedDb.select).toHaveBeenCalledTimes(1)
    expect(mockedDb.insert).toHaveBeenCalledTimes(1)
  })

  it("createNotificationsForLoan skips insert when notification already exists (dedup)", async () => {
    const { db } = await import("@/lib/db")
    const { createNotificationsForLoan } = await import("@/services/notification.service")
    const mockedDb = vi.mocked(db)

    // Mock select for dedup check — returns existing
    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: "existing-notif" }]),
        }),
      }),
    } as any)

    await createNotificationsForLoan(
      "loan-1",
      "Loan due in 3 days",
      new Date("2026-04-01"),
      ["user-1"]
    )

    expect(mockedDb.select).toHaveBeenCalledTimes(1)
    expect(mockedDb.insert).not.toHaveBeenCalled()
  })

  it("createNotificationsForLoan processes multiple users independently", async () => {
    const { db } = await import("@/lib/db")
    const { createNotificationsForLoan } = await import("@/services/notification.service")
    const mockedDb = vi.mocked(db)

    // First user: no existing notification — will insert
    // Second user: existing notification — will skip
    let selectCallCount = 0
    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() => {
            selectCallCount++
            if (selectCallCount === 1) return Promise.resolve([])
            return Promise.resolve([{ id: "existing" }])
          }),
        }),
      }),
    } as any)

    mockedDb.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    } as any)

    await createNotificationsForLoan(
      "loan-1",
      "Loan due",
      new Date("2026-04-01"),
      ["user-1", "user-2"]
    )

    expect(mockedDb.select).toHaveBeenCalledTimes(2)
    expect(mockedDb.insert).toHaveBeenCalledTimes(1) // only for user-1
  })
})
