import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect, Exit } from "effect"

vi.mock("@/lib/db", () => {
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  }
  return { db: mockDb }
})

vi.mock("@/services/audit.service", () => ({
  writeAuditLog: vi.fn(),
}))

describe("Customer Service", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("createCustomer returns an Effect (type check)", async () => {
    // Verify the module exports the expected functions
    const mod = await import("@/services/customer.service")
    expect(mod.createCustomer).toBeDefined()
    expect(mod.getCustomer).toBeDefined()
    expect(mod.updateCustomer).toBeDefined()
    expect(mod.listCustomers).toBeDefined()
  })

  it("creates a customer in the database", async () => {
    const { db } = await import("@/lib/db")
    const { createCustomer } = await import("@/services/customer.service")
    const mockedDb = vi.mocked(db)
    const valuesSpy = vi.fn()

    const mockCustomer = {
      id: "cust-1",
      fullName: "John Doe",
      contact: "0771234567",
      address: "Kampala, Uganda",
      status: "active",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    }

    mockedDb.insert.mockReturnValue({
      values: vi.fn().mockImplementation((payload) => {
        valuesSpy(payload)
        return {
        returning: vi.fn().mockResolvedValue([mockCustomer]),
        }
      }),
    } as any)

    const result = await Effect.runPromise(
      createCustomer({
        fullName: "John Doe",
        nin: "CF83037108RLLK",
        contact: "+256771234567",
        address: "Kampala, Uganda",
      })
    )

    expect(result).toEqual(mockCustomer)
    expect(valuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        contact: "0771234567",
      }),
    )
    expect(mockedDb.insert).toHaveBeenCalledTimes(1)
  })

  it("updates a customer and writes an audit log", async () => {
    const { db } = await import("@/lib/db")
    const { writeAuditLog } = await import("@/services/audit.service")
    const { updateCustomer } = await import("@/services/customer.service")
    const mockedDb = vi.mocked(db)
    const mockedWriteAuditLog = vi.mocked(writeAuditLog)

    const currentCustomer = {
      id: "cust-1",
      fullName: "John Doe",
      nin: "CF83037108RLLK",
      contact: "0771234567",
      address: "Kampala, Uganda",
      status: "active",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    }
    const updatedCustomer = {
      ...currentCustomer,
      fullName: "John Doe Jr",
      contact: "0779999999",
      updatedAt: new Date("2026-02-01"),
    }

    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([currentCustomer]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedCustomer]),
          }),
        }),
      }),
    }

    mockedDb.transaction.mockImplementation(async (callback: any) =>
      callback(tx),
    )

    const result = await Effect.runPromise(
      updateCustomer(
        "cust-1",
        { fullName: "John Doe Jr", contact: "+256779999999" },
        "admin-1",
      ),
    )

    expect(result).toEqual(updatedCustomer)
    expect(tx.update).toHaveBeenCalled()
    expect(mockedWriteAuditLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorId: "admin-1",
        action: "customer.update",
        entityType: "customer",
        entityId: "cust-1",
        beforeValue: {
          fullName: "John Doe",
          nin: "CF83037108RLLK",
          contact: "0771234567",
          address: "Kampala, Uganda",
        },
        afterValue: {
          fullName: "John Doe Jr",
          nin: "CF83037108RLLK",
          contact: "0779999999",
          address: "Kampala, Uganda",
        },
      }),
    )
  })

  it("returns CustomerNotFound for invalid ID", async () => {
    const { db } = await import("@/lib/db")
    const { getCustomer } = await import("@/services/customer.service")
    const mockedDb = vi.mocked(db)

    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any)

    const exit = await Effect.runPromiseExit(getCustomer("nonexistent"))

    expect(Exit.isFailure(exit)).toBe(true)
  })
})
