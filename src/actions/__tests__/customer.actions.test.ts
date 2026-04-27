import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// ---------- Mocks ----------

vi.mock("@/lib/validators", () => ({
  validateFullName: vi.fn((value: string | undefined | null) => {
    const trimmed = value?.trim()
    if (!trimmed || trimmed.split(/\s+/).length < 2) {
      return "Full name with first and last name is required"
    }
    return null
  }),
  validateNIN: vi.fn((value: string | undefined | null) => {
    const trimmed = value?.trim()?.toUpperCase()
    if (!trimmed || !/^[CA][MF]\d{8}[A-Z0-9]{4}$/.test(trimmed)) {
      return "Valid NIN is required (e.g. CM97027102X4CU)"
    }
    return null
  }),
  validateUgandanPhone: vi.fn((value: string | undefined | null) => {
    const cleaned = value?.trim()?.replace(/\s/g, "")
    if (!cleaned || !/^(07\d{8}|\+2567\d{8})$/.test(cleaned)) {
      return "Valid Ugandan mobile number is required (e.g. 0771234567)"
    }
    return null
  }),
}))

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
  getUserRole: vi.fn(),
  requireRole: vi.fn(),
  checkPermission: vi.fn().mockResolvedValue(null),
  getErrorTag: (error: unknown): string | undefined => {
    if (error == null || typeof error !== "object") return undefined
    if ("_tag" in error && typeof (error as any)._tag === "string") {
      return (error as any)._tag
    }
    const cause = (error as any)[Symbol.for("effect/Runtime/FiberFailure/Cause")] ?? (error as any).cause
    if (cause && typeof cause === "object") {
      const inner = cause.failure ?? cause.error
      if (inner && typeof inner === "object" && "_tag" in inner) {
        return inner._tag as string
      }
    }
    return undefined
  },
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

vi.mock("@/services/customer.service", () => ({
  createCustomer: vi.fn(),
  createCustomerWithTxid: vi.fn(),
  getCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  listCustomers: vi.fn(),
  searchCustomers: vi.fn(),
  changeCustomerStatus: vi.fn(),
}))

// ---------- Imports (after mocks) ----------

import { getSession, requireRole, checkPermission } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import {
  createCustomerWithTxid,
  getCustomer,
  updateCustomer,
  listCustomers,
  searchCustomers,
  changeCustomerStatus,
} from "@/services/customer.service"
import { CustomerNotFound, DatabaseError } from "@/lib/errors"

import {
  listCustomersAction,
  createCustomerAction,
  getCustomerAction,
  updateCustomerAction,
  searchCustomersAction,
  changeCustomerStatusAction,
} from "../customer.actions"

const mockGetSession = vi.mocked(getSession)
const mockRequireRole = vi.mocked(requireRole)
const mockCheckPermission = vi.mocked(checkPermission)
const mockRevalidatePath = vi.mocked(revalidatePath)
const mockCreateCustomer = vi.mocked(createCustomerWithTxid)
const mockGetCustomer = vi.mocked(getCustomer)
const mockUpdateCustomer = vi.mocked(updateCustomer)
const mockListCustomers = vi.mocked(listCustomers)
const mockSearchCustomers = vi.mocked(searchCustomers)
const mockChangeCustomerStatus = vi.mocked(changeCustomerStatus)

const fakeSession = {
  user: { id: "u1", name: "Test User", email: "t@t.com", role: "admin" },
} as any

// ---------- Tests ----------

describe("Customer Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===== listCustomersAction =====
  describe("listCustomersAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await listCustomersAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns data on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const customers = [{ id: "c1", fullName: "Jane Doe" }]
      mockListCustomers.mockReturnValue(Effect.succeed(customers) as any)
      const result = await listCustomersAction()
      expect(result).toEqual({ data: customers })
    })

    it("returns database error when service fails with DatabaseError", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockListCustomers.mockReturnValue(
        Effect.fail(new DatabaseError({ cause: "boom" })) as any,
      )
      const result = await listCustomersAction()
      expect(result).toEqual({ error: "Database error" })
    })

    it("returns generic error for unknown failures", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockListCustomers.mockReturnValue(Effect.fail(new Error("unknown")) as any)
      const result = await listCustomersAction()
      expect(result).toEqual({ error: "Internal server error" })
    })
  })

  // ===== createCustomerAction =====
  describe("createCustomerAction", () => {
    const validInput = {
      fullName: "John Doe",
      nin: "CM97027102X4CU",
      contact: "0771234567",
      address: "Kampala, Uganda",
    }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await createCustomerAction(validInput)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error for missing full name", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await createCustomerAction({ ...validInput, fullName: "" })
      expect(result).toHaveProperty("error")
      expect((result as any).error).toContain("name")
    })

    it("returns error for single-word name", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await createCustomerAction({ ...validInput, fullName: "John" })
      expect(result).toHaveProperty("error")
    })

    it("returns error for invalid NIN format", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await createCustomerAction({ ...validInput, nin: "INVALID" })
      expect(result).toHaveProperty("error")
      expect((result as any).error).toContain("NIN")
    })

    it("returns error for invalid contact number", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await createCustomerAction({ ...validInput, contact: "123" })
      expect(result).toHaveProperty("error")
      expect((result as any).error).toContain("mobile")
    })

    it("returns error for short address", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await createCustomerAction({ ...validInput, address: "abc" })
      expect(result).toHaveProperty("error")
      expect((result as any).error).toContain("Address")
    })

    it("creates customer and revalidates path on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const created = { id: "c1", ...validInput }
      mockCreateCustomer.mockReturnValue(
        Effect.succeed({ customer: created, txid: 12345 }) as any,
      )

      const result = await createCustomerAction(validInput)

      expect(result).toEqual({ data: created, txid: 12345 })
      expect(mockCreateCustomer).toHaveBeenCalledWith(validInput)
      expect(mockRevalidatePath).toHaveBeenCalledWith("/customers")
    })

    it("returns database error when service fails with DatabaseError", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCreateCustomer.mockReturnValue(
        Effect.fail(new DatabaseError({ cause: "db down" })) as any,
      )
      const result = await createCustomerAction(validInput)
      expect(result).toEqual({ error: "Database error — check server logs for details" })
    })

    it("returns generic error for unknown service failure", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCreateCustomer.mockReturnValue(Effect.fail(new Error("wat")) as any)
      const result = await createCustomerAction(validInput)
      expect(result).toEqual({ error: "Internal server error" })
    })
  })

  // ===== getCustomerAction =====
  describe("getCustomerAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await getCustomerAction("c1")
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns customer data on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const customer = { id: "c1", fullName: "Jane" }
      mockGetCustomer.mockReturnValue(Effect.succeed(customer) as any)
      const result = await getCustomerAction("c1")
      expect(result).toEqual({ data: customer })
    })

    it("returns error when customer not found", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetCustomer.mockReturnValue(
        Effect.fail(new CustomerNotFound({ id: "c1" })) as any,
      )
      const result = await getCustomerAction("c1")
      expect(result).toEqual({ error: "Customer not found" })
    })
  })

  // ===== updateCustomerAction =====
  describe("updateCustomerAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await updateCustomerAction("c1", { fullName: "New Name" })
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("updates customer and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const updated = { id: "c1", fullName: "New Name" }
      mockUpdateCustomer.mockReturnValue(Effect.succeed(updated) as any)

      const result = await updateCustomerAction("c1", { fullName: "New Name" })

      expect(result).toEqual({ data: updated })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/customers")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/customers/c1")
    })

    it("returns error when customer not found", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockUpdateCustomer.mockReturnValue(
        Effect.fail(new CustomerNotFound({ id: "c1" })) as any,
      )
      const result = await updateCustomerAction("c1", { fullName: "New" })
      expect(result).toEqual({ error: "Customer not found" })
    })
  })

  // ===== searchCustomersAction =====
  describe("searchCustomersAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await searchCustomersAction({ name: "test" })
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns search results on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const results = [{ id: "c1" }]
      mockSearchCustomers.mockReturnValue(Effect.succeed(results) as any)
      const result = await searchCustomersAction({ name: "Jane" })
      expect(result).toEqual({ data: results })
    })
  })

  // ===== changeCustomerStatusAction =====
  describe("changeCustomerStatusAction", () => {
    const validInput = {
      customerId: "c1",
      newStatus: "blacklisted" as const,
      reason: "Repeatedly defaulted on loans",
    }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await changeCustomerStatusAction(validInput)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error when role is insufficient", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue("Forbidden")
      const result = await changeCustomerStatusAction(validInput)
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("returns error for missing customer ID", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const result = await changeCustomerStatusAction({
        ...validInput,
        customerId: "",
      })
      expect(result).toEqual({ error: "Customer ID is required" })
    })

    it("returns error for invalid status", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const result = await changeCustomerStatusAction({
        ...validInput,
        newStatus: "bogus" as any,
      })
      expect(result).toEqual({ error: "Invalid status" })
    })

    it("returns error for short reason", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const result = await changeCustomerStatusAction({
        ...validInput,
        reason: "short",
      })
      expect(result).toEqual({ error: "Reason must be at least 10 characters" })
    })

    it("changes status and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const updated = { id: "c1", status: "blacklisted" }
      mockChangeCustomerStatus.mockReturnValue(Effect.succeed(updated) as any)

      const result = await changeCustomerStatusAction(validInput)

      expect(result).toEqual({ data: updated })
      expect(mockChangeCustomerStatus).toHaveBeenCalledWith(
        "c1",
        "blacklisted",
        "Repeatedly defaulted on loans",
        "u1",
      )
      expect(mockRevalidatePath).toHaveBeenCalledWith("/customers")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/customers/c1")
    })

    it("returns error when customer not found", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      mockChangeCustomerStatus.mockReturnValue(
        Effect.fail(new CustomerNotFound({ id: "c1" })) as any,
      )
      const result = await changeCustomerStatusAction(validInput)
      expect(result).toEqual({ error: "Customer not found" })
    })
  })
})
