import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// ---------- Mocks ----------

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
  getErrorTag: (error: unknown): string | undefined => {
    if (error == null || typeof error !== "object") return undefined
    if ("_tag" in error && typeof (error as any)._tag === "string") return (error as any)._tag
    const cause = (error as any)[Symbol.for("effect/Runtime/FiberFailure/Cause")] ?? (error as any).cause
    if (cause && typeof cause === "object") {
      const inner = cause.failure ?? cause.error
      if (inner && typeof inner === "object" && "_tag" in inner) return inner._tag as string
    }
    return undefined
  },
  requireRole: () => null,
}))

vi.mock("@/services/notification.service", () => ({
  getNotifications: vi.fn(),
  getUnreadCount: vi.fn(),
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
}))

// ---------- Imports ----------

import { getSession } from "@/lib/action-utils"
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from "@/services/notification.service"

import {
  getNotificationsAction,
  getUnreadCountAction,
  markAsReadAction,
  markAllAsReadAction,
} from "../notification.actions"

const mockGetSession = vi.mocked(getSession)
const mockGetNotifications = vi.mocked(getNotifications)
const mockGetUnreadCount = vi.mocked(getUnreadCount)
const mockMarkAsRead = vi.mocked(markAsRead)
const mockMarkAllAsRead = vi.mocked(markAllAsRead)

const fakeSession = {
  user: { id: "u1", name: "Test", email: "t@t.com", role: "admin" },
} as any

// ---------- Tests ----------

describe("Notification Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===== getNotificationsAction =====
  describe("getNotificationsAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await getNotificationsAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns notifications on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const notifs = [{ id: "n1", message: "Hello" }]
      mockGetNotifications.mockReturnValue(Effect.succeed(notifs) as any)
      const result = await getNotificationsAction()
      expect(result).toEqual({ data: notifs })
    })

    it("returns error on service failure", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetNotifications.mockReturnValue(Effect.fail(new Error("boom")) as any)
      const result = await getNotificationsAction()
      expect(result).toEqual({ error: "Internal server error" })
    })
  })

  // ===== getUnreadCountAction =====
  describe("getUnreadCountAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await getUnreadCountAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns count on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUnreadCount.mockReturnValue(Effect.succeed(5) as any)
      const result = await getUnreadCountAction()
      expect(result).toEqual({ data: 5 })
    })
  })

  // ===== markAsReadAction =====
  describe("markAsReadAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await markAsReadAction("n1")
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("marks as read on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockMarkAsRead.mockReturnValue(Effect.succeed(undefined) as any)
      const result = await markAsReadAction("n1")
      expect(result).toEqual({ data: undefined })
    })
  })

  // ===== markAllAsReadAction =====
  describe("markAllAsReadAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await markAllAsReadAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("marks all as read on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockMarkAllAsRead.mockReturnValue(Effect.succeed(undefined) as any)
      const result = await markAllAsReadAction()
      expect(result).toEqual({ data: undefined })
    })
  })
})
