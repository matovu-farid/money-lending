import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect, Exit } from "effect"

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

vi.mock("@/services/audit.service", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/services/notification.service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}))

// ─── helpers ───────────────────────────────────────────────────────────────

const makeConv = (overrides = {}) => ({
  id: "conv-1",
  name: null,
  isGroup: false,
  createdBy: "user-1",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  ...overrides,
})

const makeMessage = (overrides = {}) => ({
  id: "msg-1",
  conversationId: "conv-1",
  senderId: "user-1",
  content: "Hello",
  mentions: [],
  deletedAt: null,
  deletedBy: null,
  createdAt: new Date("2026-01-01"),
  ...overrides,
})

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("Chat Service", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  // ── createConversation ──────────────────────────────────────────────────

  describe("createConversation", () => {
    it("fails with empty participantIds (produces group with only creator, falls through to transaction)", async () => {
      const { db } = await import("@/lib/db")
      const { createConversation } = await import("@/services/chat.service")
      const mockedDb = vi.mocked(db)

      // When participantIds is empty, allParticipants = [createdBy] (length 1, not a group)
      // The isGroup check is allParticipants.length > 2 → false
      // But participantIds.length === 1 is also false, so we skip the 1:1 check and go straight to transaction
      // A real DB transaction would be needed; here we simulate a DB error on transaction
      mockedDb.transaction.mockRejectedValue(new Error("db error"))

      const exit = await Effect.runPromiseExit(
        createConversation("user-1", [])
      )

      expect(Exit.isFailure(exit)).toBe(true)
    })

    it("creates new 1:1 conversation when none exists", async () => {
      const { db } = await import("@/lib/db")
      const { createConversation } = await import("@/services/chat.service")
      const mockedDb = vi.mocked(db)

      const conv = makeConv()

      // db.execute returns empty (no existing conversation)
      mockedDb.execute.mockResolvedValue([])

      // transaction runs, inserts conv and participants
      mockedDb.transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([conv]),
            }),
          }),
        }
        return cb(tx)
      })

      const result = await Effect.runPromise(
        createConversation("user-1", ["user-2"])
      )

      expect(result).toEqual(conv)
    })

    it("returns existing 1:1 conversation when one already exists", async () => {
      const { db } = await import("@/lib/db")
      const { createConversation } = await import("@/services/chat.service")
      const mockedDb = vi.mocked(db)

      const conv = makeConv()

      // db.execute returns an existing conversation_id row
      mockedDb.execute.mockResolvedValue([{ conversation_id: "conv-1" }])

      // db.select().from().where() returns the existing conversation
      mockedDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([conv]),
        }),
      } as any)

      const result = await Effect.runPromise(
        createConversation("user-1", ["user-2"])
      )

      expect(result).toEqual(conv)
      // transaction should NOT have been called since conversation already exists
      expect(mockedDb.transaction).not.toHaveBeenCalled()
    })
  })

  // ── sendMessage ─────────────────────────────────────────────────────────

  describe("sendMessage", () => {
    const setupSendMessageMocks = (mockedDb: ReturnType<typeof vi.mocked<any>>, {
      convExists = true,
      participantExists = true,
    } = {}) => {
      let selectCallCount = 0
      mockedDb.select.mockImplementation(() => {
        selectCallCount++
        const callNum = selectCallCount
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(
              callNum === 1
                ? (convExists ? [makeConv()] : [])           // conversations check
                : callNum === 2
                ? (participantExists ? [{ userId: "user-1", conversationId: "conv-1" }] : []) // participant check
                : [{ name: "Alice" }]                         // sender name
            ),
          }),
        }
      })
    }

    it("fails with empty content and no attachments", async () => {
      const { db } = await import("@/lib/db")
      const { sendMessage } = await import("@/services/chat.service")
      const mockedDb = vi.mocked(db)

      setupSendMessageMocks(mockedDb)

      const exit = await Effect.runPromiseExit(
        sendMessage("conv-1", "user-1", "   ", [], [])
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const cause = exit.cause
        // The error tag should be ValidationError
        expect(JSON.stringify(cause)).toContain("ValidationError")
      }
    })

    it("fails when user is not a participant", async () => {
      const { db } = await import("@/lib/db")
      const { sendMessage } = await import("@/services/chat.service")
      const mockedDb = vi.mocked(db)

      setupSendMessageMocks(mockedDb, { participantExists: false })

      const exit = await Effect.runPromiseExit(
        sendMessage("conv-1", "user-outsider", "Hello", [], [])
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(JSON.stringify(exit.cause)).toContain("ForbiddenError")
      }
    })

    it("rejects attachments larger than 5MB", async () => {
      const { db } = await import("@/lib/db")
      const { sendMessage } = await import("@/services/chat.service")
      const mockedDb = vi.mocked(db)

      setupSendMessageMocks(mockedDb)

      const bigAttachment = {
        data: "base64data",
        mimeType: "image/png",
        fileName: "big.png",
        fileSize: 6 * 1024 * 1024, // 6 MB
      }

      const exit = await Effect.runPromiseExit(
        sendMessage("conv-1", "user-1", "Hello", [], [bigAttachment])
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(JSON.stringify(exit.cause)).toContain("ValidationError")
      }
    })

    it("rejects unsupported MIME types", async () => {
      const { db } = await import("@/lib/db")
      const { sendMessage } = await import("@/services/chat.service")
      const mockedDb = vi.mocked(db)

      setupSendMessageMocks(mockedDb)

      const pdfAttachment = {
        data: "base64data",
        mimeType: "application/pdf",
        fileName: "doc.pdf",
        fileSize: 100 * 1024,
      }

      const exit = await Effect.runPromiseExit(
        sendMessage("conv-1", "user-1", "Hello", [], [pdfAttachment])
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(JSON.stringify(exit.cause)).toContain("ValidationError")
      }
    })

    it("rejects more than 3 attachments", async () => {
      const { db } = await import("@/lib/db")
      const { sendMessage } = await import("@/services/chat.service")
      const mockedDb = vi.mocked(db)

      setupSendMessageMocks(mockedDb)

      const makeAtt = () => ({
        data: "base64data",
        mimeType: "image/png",
        fileName: "img.png",
        fileSize: 100 * 1024,
      })

      const exit = await Effect.runPromiseExit(
        sendMessage("conv-1", "user-1", "Hello", [], [makeAtt(), makeAtt(), makeAtt(), makeAtt()])
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(JSON.stringify(exit.cause)).toContain("ValidationError")
      }
    })
  })

  // ── deleteMessage ───────────────────────────────────────────────────────

  describe("deleteMessage", () => {
    const makeTx = (overrides: {
      messageRow?: object | null
    } = {}) => {
      const { messageRow = makeMessage() } = overrides
      return {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(messageRow ? [messageRow] : []),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      }
    }

    it("fails when message doesn't exist", async () => {
      const { db } = await import("@/lib/db")
      const { deleteMessage } = await import("@/services/chat.service")
      const mockedDb = vi.mocked(db)

      mockedDb.transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        return cb(makeTx({ messageRow: null }))
      })

      const exit = await Effect.runPromiseExit(
        deleteMessage("msg-missing", "user-1", "loan_officer")
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(JSON.stringify(exit.cause)).toContain("MessageNotFound")
      }
    })

    it("non-admin cannot delete another user's message", async () => {
      const { db } = await import("@/lib/db")
      const { deleteMessage } = await import("@/services/chat.service")
      const mockedDb = vi.mocked(db)

      // message belongs to user-1, but user-2 (non-admin) tries to delete
      const tx = makeTx({ messageRow: makeMessage({ senderId: "user-1" }) })

      mockedDb.transaction.mockImplementation(async (cb: (txArg: any) => Promise<any>) => {
        return cb(tx)
      })

      const exit = await Effect.runPromiseExit(
        deleteMessage("msg-1", "user-2", "loan_officer")
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(JSON.stringify(exit.cause)).toContain("ForbiddenError")
      }
    })

    it("admin can delete any message", async () => {
      const { db } = await import("@/lib/db")
      const { writeAuditLog } = await import("@/services/audit.service")
      const { deleteMessage } = await import("@/services/chat.service")
      const mockedDb = vi.mocked(db)
      const mockedAuditLog = vi.mocked(writeAuditLog)

      mockedAuditLog.mockResolvedValue(undefined)

      const tx = makeTx({ messageRow: makeMessage({ senderId: "user-1" }) })

      mockedDb.transaction.mockImplementation(async (cb: (txArg: any) => Promise<any>) => {
        return cb(tx)
      })

      // admin (user-admin) deletes user-1's message
      const exit = await Effect.runPromiseExit(
        deleteMessage("msg-1", "user-admin", "admin")
      )

      expect(Exit.isSuccess(exit)).toBe(true)
      expect(tx.update).toHaveBeenCalled()
    })
  })

  // ── searchUsers ─────────────────────────────────────────────────────────

  describe("searchUsers", () => {
    it("returns filtered users", async () => {
      const { db } = await import("@/lib/db")
      const { searchUsers } = await import("@/services/chat.service")
      const mockedDb = vi.mocked(db)

      const mockUsers = [
        { id: "user-2", name: "Alice Smith", role: "loan_officer" },
        { id: "user-3", name: "Alice Jones", role: "cashier" },
      ]

      mockedDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockUsers),
        }),
      } as any)

      const result = await Effect.runPromise(
        searchUsers("Alice", "user-1")
      )

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ id: "user-2", name: "Alice Smith", role: "loan_officer" })
      expect(result[1]).toEqual({ id: "user-3", name: "Alice Jones", role: "cashier" })
    })
  })

  // ── cleanupExpiredAttachments ───────────────────────────────────────────

  describe("cleanupExpiredAttachments", () => {
    it("returns count of deleted attachments", async () => {
      const { db } = await import("@/lib/db")
      const { cleanupExpiredAttachments } = await import("@/services/chat.service")
      const mockedDb = vi.mocked(db)

      mockedDb.delete.mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            { id: "att-1" },
            { id: "att-2" },
            { id: "att-3" },
          ]),
        }),
      } as any)

      const count = await Effect.runPromise(cleanupExpiredAttachments())

      expect(count).toBe(3)
    })
  })
})
