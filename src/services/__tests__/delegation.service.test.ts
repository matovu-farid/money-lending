import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => {
  const mockDb = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn() }
  return { db: mockDb }
})

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm")
  return actual
})

describe("Delegation Service — Unit", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  // ─── createDelegation ───────────────────────────────────────────────

  it("createDelegation — succeeds for a supervisor with no existing delegation", async () => {
    const { db } = await import("@/lib/db")
    const mockDb = db as any

    // First select: check existing delegation → none found
    const mockLimit1 = vi.fn().mockResolvedValue([])
    const mockWhere1 = vi.fn().mockReturnValue({ limit: mockLimit1 })
    const mockFrom1 = vi.fn().mockReturnValue({ where: mockWhere1 })

    // Second select: check user role → supervisor
    const mockFrom2 = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ role: "supervisor" }]),
    })

    mockDb.select
      .mockReturnValueOnce({ from: mockFrom1 })
      .mockReturnValueOnce({ from: mockFrom2 })

    // Insert: return new delegation
    const mockReturning = vi.fn().mockResolvedValue([{
      id: "del-1",
      userId: "user-1",
      delegatedBy: "admin-1",
      createdAt: new Date(),
      revokedAt: null,
      revokedBy: null,
    }])
    const mockValues = vi.fn().mockReturnValue({ returning: mockReturning })
    mockDb.insert.mockReturnValue({ values: mockValues })

    const { createDelegation } = await import("@/services/delegation.service")
    const result = await createDelegation("del-1", "user-1", "admin-1")

    expect(result.id).toBe("del-1")
    expect(result.userId).toBe("user-1")
    expect(result.delegatedBy).toBe("admin-1")
    expect(mockDb.select).toHaveBeenCalledTimes(2)
    expect(mockDb.insert).toHaveBeenCalledTimes(1)
  })

  it("createDelegation — throws when user already has an active delegation", async () => {
    const { db } = await import("@/lib/db")
    const mockDb = db as any

    // First select: existing active delegation found
    const mockLimit = vi.fn().mockResolvedValue([{ id: "existing-del" }])
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
    mockDb.select.mockReturnValue({ from: mockFrom })

    const { createDelegation } = await import("@/services/delegation.service")
    await expect(createDelegation("del-1", "user-1", "admin-1")).rejects.toThrow(
      "User already has an active delegation"
    )
  })

  it("createDelegation — throws for non-supervisor user", async () => {
    const { db } = await import("@/lib/db")
    const mockDb = db as any

    // First select: no existing delegation
    const mockLimit1 = vi.fn().mockResolvedValue([])
    const mockWhere1 = vi.fn().mockReturnValue({ limit: mockLimit1 })
    const mockFrom1 = vi.fn().mockReturnValue({ where: mockWhere1 })

    // Second select: user is agent, not supervisor
    const mockFrom2 = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ role: "agent" }]),
    })

    mockDb.select
      .mockReturnValueOnce({ from: mockFrom1 })
      .mockReturnValueOnce({ from: mockFrom2 })

    const { createDelegation } = await import("@/services/delegation.service")
    await expect(createDelegation("del-1", "user-1", "admin-1")).rejects.toThrow(
      "Only supervisors can receive delegations"
    )
  })

  it("createDelegation — throws when user not found", async () => {
    const { db } = await import("@/lib/db")
    const mockDb = db as any

    // First select: no existing delegation
    const mockLimit1 = vi.fn().mockResolvedValue([])
    const mockWhere1 = vi.fn().mockReturnValue({ limit: mockLimit1 })
    const mockFrom1 = vi.fn().mockReturnValue({ where: mockWhere1 })

    // Second select: user not found → empty array
    const mockFrom2 = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    })

    mockDb.select
      .mockReturnValueOnce({ from: mockFrom1 })
      .mockReturnValueOnce({ from: mockFrom2 })

    const { createDelegation } = await import("@/services/delegation.service")
    await expect(createDelegation("del-1", "nonexistent", "admin-1")).rejects.toThrow(
      "Only supervisors can receive delegations"
    )
  })

  // ─── revokeDelegation ──────────────────────────────────────────────

  it("revokeDelegation — succeeds and returns the revoked row", async () => {
    const { db } = await import("@/lib/db")
    const mockDb = db as any

    const revokedRow = {
      id: "del-1",
      userId: "user-1",
      delegatedBy: "admin-1",
      createdAt: new Date(),
      revokedAt: new Date(),
      revokedBy: "admin-2",
    }

    const mockReturning = vi.fn().mockResolvedValue([revokedRow])
    const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning })
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere })
    mockDb.update.mockReturnValue({ set: mockSet })

    const { revokeDelegation } = await import("@/services/delegation.service")
    const result = await revokeDelegation("del-1", "admin-2")

    expect(result.id).toBe("del-1")
    expect(result.revokedBy).toBe("admin-2")
    expect(result.revokedAt).toBeDefined()
  })

  it("revokeDelegation — throws when no active delegation found", async () => {
    const { db } = await import("@/lib/db")
    const mockDb = db as any

    const mockReturning = vi.fn().mockResolvedValue([])
    const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning })
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere })
    mockDb.update.mockReturnValue({ set: mockSet })

    const { revokeDelegation } = await import("@/services/delegation.service")
    await expect(revokeDelegation("nonexistent", "admin-1")).rejects.toThrow(
      "Active delegation not found"
    )
  })

  // ─── getActiveDelegation ───────────────────────────────────────────

  it("getActiveDelegation — returns delegation when active one exists", async () => {
    const { db } = await import("@/lib/db")
    const mockDb = db as any

    const activeDelegation = {
      id: "del-1",
      userId: "user-1",
      delegatedBy: "admin-1",
      createdAt: new Date(),
      revokedAt: null,
      revokedBy: null,
    }

    const mockLimit = vi.fn().mockResolvedValue([activeDelegation])
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
    mockDb.select.mockReturnValue({ from: mockFrom })

    const { getActiveDelegation } = await import("@/services/delegation.service")
    const result = await getActiveDelegation("user-1")

    expect(result).toEqual(activeDelegation)
  })

  it("getActiveDelegation — returns null when none exists", async () => {
    const { db } = await import("@/lib/db")
    const mockDb = db as any

    const mockLimit = vi.fn().mockResolvedValue([])
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
    mockDb.select.mockReturnValue({ from: mockFrom })

    const { getActiveDelegation } = await import("@/services/delegation.service")
    const result = await getActiveDelegation("user-1")

    expect(result).toBeNull()
  })

  // ─── listDelegations ──────────────────────────────────────────────

  it("listDelegations — returns rows with user names", async () => {
    const { db } = await import("@/lib/db")
    const mockDb = db as any

    const rows = [
      {
        id: "del-1",
        userId: "user-1",
        userName: "Alice",
        delegatedBy: "admin-1",
        createdAt: new Date(),
        revokedAt: null,
        revokedBy: null,
      },
      {
        id: "del-2",
        userId: "user-2",
        userName: "Bob",
        delegatedBy: "admin-1",
        createdAt: new Date(),
        revokedAt: new Date(),
        revokedBy: "admin-2",
      },
    ]

    const mockLimit = vi.fn().mockResolvedValue(rows)
    const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockLeftJoin = vi.fn().mockReturnValue({ orderBy: mockOrderBy })
    const mockFrom = vi.fn().mockReturnValue({ leftJoin: mockLeftJoin })
    mockDb.select.mockReturnValue({ from: mockFrom })

    const { listDelegations } = await import("@/services/delegation.service")
    const result = await listDelegations()

    expect(result).toHaveLength(2)
    expect(result[0].userName).toBe("Alice")
    expect(result[1].userName).toBe("Bob")
    expect(result[1].revokedAt).toBeDefined()
  })
})
