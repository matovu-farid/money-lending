import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect, Exit } from "effect"
import type { db as realDb } from "@/lib/db"

type RealDb = typeof realDb

vi.mock("@/lib/db", () => {
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
  }
  return { db: mockDb }
})

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
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockCustomer]),
      }),
    } as unknown as ReturnType<RealDb["insert"]>)

    const result = await Effect.runPromise(
      createCustomer({
        fullName: "John Doe",
        nin: "CF83037108RLLK",
        contact: "0771234567",
        address: "Kampala, Uganda",
      })
    )

    expect(result).toEqual(mockCustomer)
    expect(mockedDb.insert).toHaveBeenCalledTimes(1)
  })

  it("returns CustomerNotFound for invalid ID", async () => {
    const { db } = await import("@/lib/db")
    const { getCustomer } = await import("@/services/customer.service")
    const mockedDb = vi.mocked(db)

    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as unknown as ReturnType<RealDb["select"]>)

    const exit = await Effect.runPromiseExit(getCustomer("nonexistent"))

    expect(Exit.isFailure(exit)).toBe(true)
  })
})
