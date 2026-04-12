import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// ---------- Mocks ----------

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

vi.mock("@/services/creditor.service", () => ({
  createCreditor: vi.fn(),
  updateCreditor: vi.fn(),
  addInvestment: vi.fn(),
  recordCreditorRepayment: vi.fn(),
  listCreditors: vi.fn(),
  getSystemCapital: vi.fn(),
}))

// ---------- Imports ----------

import { auth } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import {
  createCreditor,
  updateCreditor,
  addInvestment,
  recordCreditorRepayment,
  listCreditors,
  getSystemCapital,
} from "@/services/creditor.service"

import {
  listCreditorsAction,
  getSystemCapitalAction,
  createCreditorAction,
  updateCreditorAction,
  addInvestmentAction,
  recordCreditorRepaymentAction,
} from "../creditor.actions"

import { fakeSession, lowRoleSession } from "./test-utils"
const mockGetSession = vi.mocked(auth.api.getSession)
const mockRevalidatePath = vi.mocked(revalidatePath)
const mockListCreditors = vi.mocked(listCreditors)
const mockGetSystemCapital = vi.mocked(getSystemCapital)
const mockCreateCreditor = vi.mocked(createCreditor)
const mockUpdateCreditor = vi.mocked(updateCreditor)
const mockAddInvestment = vi.mocked(addInvestment)
const mockRecordCreditorRepayment = vi.mocked(recordCreditorRepayment)

// ---------- Tests ----------

describe("Creditor Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===== listCreditorsAction =====
  describe("listCreditorsAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await listCreditorsAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns data on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const creditors = [{ id: "cr1", name: "Alice" }]
      mockListCreditors.mockReturnValue(Effect.succeed(creditors) as any)
      const result = await listCreditorsAction()
      expect(result).toEqual({ data: creditors })
    })

    it("returns error on service failure", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockListCreditors.mockReturnValue(Effect.fail(new Error("boom")) as any)
      const result = await listCreditorsAction()
      expect(result).toEqual({ error: "Internal server error" })
    })
  })

  // ===== getSystemCapitalAction =====
  describe("getSystemCapitalAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await getSystemCapitalAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns data on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const capital = { total: "5000000" }
      mockGetSystemCapital.mockReturnValue(Effect.succeed(capital) as any)
      const result = await getSystemCapitalAction()
      expect(result).toEqual({ data: capital })
    })
  })

  // ===== createCreditorAction =====
  describe("createCreditorAction", () => {
    const validInput = { name: "Bob", contact: "0771234567", address: "Kampala" }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await createCreditorAction(validInput as any)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns Forbidden for low role", async () => {
      mockGetSession.mockResolvedValue(lowRoleSession)
      const result = await createCreditorAction(validInput as any)
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("returns error for missing name", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await createCreditorAction({ ...validInput, name: "" } as any)
      expect(result).toEqual({ error: "Creditor name is required" })
    })

    it("returns error for missing contact", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await createCreditorAction({ ...validInput, contact: "" } as any)
      expect(result).toEqual({ error: "Contact is required" })
    })

    it("creates creditor and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const created = { id: "cr1", ...validInput }
      mockCreateCreditor.mockReturnValue(Effect.succeed(created) as any)

      const result = await createCreditorAction(validInput as any)
      expect(result).toEqual({ data: created })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/creditors")
    })
  })

  // ===== addInvestmentAction =====
  describe("addInvestmentAction", () => {
    const validInput = {
      creditorId: "cr1",
      amount: "1000000",
      investmentDate: "2026-04-01",
      depositLocation: "cash",
    }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await addInvestmentAction(validInput as any)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns Forbidden for low role", async () => {
      mockGetSession.mockResolvedValue(lowRoleSession)
      const result = await addInvestmentAction(validInput as any)
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("returns error for invalid amount", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await addInvestmentAction({ ...validInput, amount: "abc" } as any)
      expect(result).toEqual({ error: "A valid positive amount is required" })
    })

    it("returns error for invalid date", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await addInvestmentAction({ ...validInput, investmentDate: "nope" } as any)
      expect(result).toEqual({ error: "A valid investment date is required" })
    })

    it("adds investment and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const created = { id: "inv1" }
      mockAddInvestment.mockReturnValue(Effect.succeed(created) as any)

      const result = await addInvestmentAction(validInput as any)
      expect(result).toEqual({ data: created })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/creditors")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/creditors/cr1")
    })
  })

  // ===== recordCreditorRepaymentAction =====
  describe("recordCreditorRepaymentAction", () => {
    const validInput = {
      investmentId: "inv1",
      amount: "500000",
      repaymentDate: "2026-04-10",
      sourceLocation: "cash",
    }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null as any)
      const result = await recordCreditorRepaymentAction(validInput as any)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error for missing investment ID", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await recordCreditorRepaymentAction({ ...validInput, investmentId: "" } as any)
      expect(result).toEqual({ error: "Investment ID is required" })
    })

    it("returns error for invalid amount", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await recordCreditorRepaymentAction({ ...validInput, amount: "0" } as any)
      expect(result).toEqual({ error: "A valid positive amount is required" })
    })

    it("records repayment on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const recorded = { id: "rep1" }
      mockRecordCreditorRepayment.mockReturnValue(Effect.succeed(recorded) as any)

      const result = await recordCreditorRepaymentAction(validInput as any)
      expect(result).toEqual({ data: recorded })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/creditors")
    })
  })
})
