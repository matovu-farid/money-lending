import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect, Exit, Cause } from "effect"

vi.mock("@/lib/db", () => {
  const mockDb = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn() }
  return { db: mockDb }
})

vi.mock("@/services/audit.service", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/services/auto-post.service", () => ({
  autoPostFundTransfer: vi.fn().mockResolvedValue(undefined),
  autoPostCapitalInjection: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm")
  return actual
})

const mockTransfer = {
  id: "transfer-1",
  transferType: "transfer",
  fromLocation: "safe" as const,
  toLocation: "bank" as const,
  amount: "500000",
  transferredBy: "actor-1",
  note: "Test transfer",
  createdAt: new Date("2026-04-10T10:00:00.000Z"),
}

const mockCapitalInjection = {
  id: "transfer-2",
  transferType: "capital_injection",
  fromLocation: null,
  toLocation: "safe" as const,
  amount: "1000000",
  transferredBy: "actor-1",
  note: "Owner deposit",
  createdAt: new Date("2026-04-10T10:00:00.000Z"),
}

describe("Fund Transfer Service", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── createFundTransfer ────────────────────────────────────────────

  it("creates a fund transfer in a transaction with audit log and auto-post", async () => {
    const { db: mockedDb } = await import("@/lib/db")
    const { writeAuditLog } = await import("@/services/audit.service")
    const { autoPostFundTransfer } = await import("@/services/auto-post.service")

    let capturedTx: any
    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: any) => {
        const mockTx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([mockTransfer]),
            }),
          }),
        }
        capturedTx = mockTx
        return callback(mockTx)
      }
    )

    const { createFundTransfer } = await import("@/services/fund-transfer.service")
    const result = await Effect.runPromise(
      createFundTransfer(
        { fromLocation: "safe", toLocation: "bank", amount: "500000", note: "Test transfer" },
        "actor-1"
      )
    )

    expect(result).toEqual(mockTransfer)
    expect(result.id).toBe("transfer-1")

    // Audit log called with the tx
    expect(writeAuditLog).toHaveBeenCalledOnce()
    expect(writeAuditLog).toHaveBeenCalledWith(capturedTx, {
      actorId: "actor-1",
      action: "fund_transfer.create",
      entityType: "fund_transfer",
      entityId: "transfer-1",
      beforeValue: null,
      afterValue: mockTransfer,
    })

    // Auto-post called with the tx
    expect(autoPostFundTransfer).toHaveBeenCalledOnce()
    expect(autoPostFundTransfer).toHaveBeenCalledWith(capturedTx, {
      amount: "500000",
      transferId: "transfer-1",
      fromLocation: "safe",
      toLocation: "bank",
      transactionDate: mockTransfer.createdAt.toISOString(),
      actorId: "actor-1",
    })
  })

  it("trims whitespace from note in fund transfer", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    let capturedValues: any
    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: any) => {
        const mockTx = {
          insert: vi.fn().mockImplementation(() => ({
            values: vi.fn().mockImplementation((vals: any) => {
              capturedValues = vals
              return {
                returning: vi.fn().mockResolvedValue([mockTransfer]),
              }
            }),
          })),
        }
        return callback(mockTx)
      }
    )

    const { createFundTransfer } = await import("@/services/fund-transfer.service")
    await Effect.runPromise(
      createFundTransfer(
        { fromLocation: "safe", toLocation: "bank", amount: "500000", note: "  spaced note  " },
        "actor-1"
      )
    )

    expect(capturedValues.note).toBe("spaced note")
  })

  it("sets note to null when note is empty string", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    let capturedValues: any
    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: any) => {
        const mockTx = {
          insert: vi.fn().mockImplementation(() => ({
            values: vi.fn().mockImplementation((vals: any) => {
              capturedValues = vals
              return {
                returning: vi.fn().mockResolvedValue([mockTransfer]),
              }
            }),
          })),
        }
        return callback(mockTx)
      }
    )

    const { createFundTransfer } = await import("@/services/fund-transfer.service")
    await Effect.runPromise(
      createFundTransfer(
        { fromLocation: "safe", toLocation: "bank", amount: "500000", note: "" },
        "actor-1"
      )
    )

    expect(capturedValues.note).toBeNull()
  })

  it("returns DatabaseError when transaction fails", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Connection lost")
    )

    const { createFundTransfer } = await import("@/services/fund-transfer.service")
    const exit = await Effect.runPromiseExit(
      createFundTransfer(
        { fromLocation: "safe", toLocation: "bank", amount: "500000" },
        "actor-1"
      )
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value._tag).toBe("DatabaseError")
      }
    }
  })

  // ── createCapitalInjection ────────────────────────────────────────

  it("creates a capital injection with correct transferType and null fromLocation", async () => {
    const { db: mockedDb } = await import("@/lib/db")
    const { writeAuditLog } = await import("@/services/audit.service")
    const { autoPostCapitalInjection } = await import("@/services/auto-post.service")

    let capturedValues: any
    let capturedTx: any
    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: any) => {
        const mockTx = {
          insert: vi.fn().mockImplementation(() => ({
            values: vi.fn().mockImplementation((vals: any) => {
              capturedValues = vals
              return {
                returning: vi.fn().mockResolvedValue([mockCapitalInjection]),
              }
            }),
          })),
        }
        capturedTx = mockTx
        return callback(mockTx)
      }
    )

    const { createCapitalInjection } = await import("@/services/fund-transfer.service")
    const result = await Effect.runPromise(
      createCapitalInjection(
        { toLocation: "safe", amount: "1000000", note: "Owner deposit" },
        "actor-1"
      )
    )

    expect(result).toEqual(mockCapitalInjection)
    expect(capturedValues.transferType).toBe("capital_injection")
    expect(capturedValues.fromLocation).toBeNull()

    // Audit log
    expect(writeAuditLog).toHaveBeenCalledWith(capturedTx, {
      actorId: "actor-1",
      action: "capital_injection.create",
      entityType: "fund_transfer",
      entityId: "transfer-2",
      beforeValue: null,
      afterValue: mockCapitalInjection,
    })

    // Auto-post
    expect(autoPostCapitalInjection).toHaveBeenCalledWith(capturedTx, {
      amount: "1000000",
      transferId: "transfer-2",
      toLocation: "safe",
      transactionDate: mockCapitalInjection.createdAt.toISOString(),
      actorId: "actor-1",
    })
  })

  it("returns DatabaseError when capital injection transaction fails", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("DB down")
    )

    const { createCapitalInjection } = await import("@/services/fund-transfer.service")
    const exit = await Effect.runPromiseExit(
      createCapitalInjection({ toLocation: "safe", amount: "1000000" }, "actor-1")
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value._tag).toBe("DatabaseError")
      }
    }
  })

  // ── listFundTransfers ─────────────────────────────────────────────

  it("lists fund transfers ordered by createdAt desc", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    const transfers = [mockTransfer, mockCapitalInjection]
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(transfers),
      }),
    })

    const { listFundTransfers } = await import("@/services/fund-transfer.service")
    const result = await Effect.runPromise(listFundTransfers())

    expect(result).toEqual(transfers)
    expect(result).toHaveLength(2)
  })

  it("returns empty array when no transfers exist", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    })

    const { listFundTransfers } = await import("@/services/fund-transfer.service")
    const result = await Effect.runPromise(listFundTransfers())

    expect(result).toEqual([])
  })

  it("returns DatabaseError when list query fails", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockRejectedValue(new Error("Query failed")),
      }),
    })

    const { listFundTransfers } = await import("@/services/fund-transfer.service")
    const exit = await Effect.runPromiseExit(listFundTransfers())

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value._tag).toBe("DatabaseError")
      }
    }
  })
})
