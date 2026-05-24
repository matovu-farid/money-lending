import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// ---------- Mocks ----------

vi.mock("@/lib/validators", () => ({
  validatePositiveDecimal: vi.fn((value: string | undefined | null, fieldName: string) => {
    if (!value?.trim() || !/^\d+(\.\d{1,2})?$/.test(value)) {
      return `${fieldName} must be a valid decimal number`
    }
    if (parseFloat(value) <= 0) {
      return `${fieldName} must be greater than zero`
    }
    return null
  }),
  validateRequired: vi.fn(),
}))

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
  getUserRole: vi.fn(),
  requireRole: vi.fn(),
  checkPermission: vi.fn().mockResolvedValue(null),
  getEffectivePermissions: vi.fn().mockResolvedValue(new Set(["payment:edit-any", "payment:delete-any"])),
  getErrorTag: (error: unknown): string | undefined => {
    if (error == null || typeof error !== "object") return undefined
    if ("_tag" in error) {
      const tag = (error as { _tag: unknown })._tag
      if (typeof tag === "string") return tag
    }
    const causeContainer = error as Record<string | symbol, unknown>
    const cause = causeContainer[Symbol.for("effect/Runtime/FiberFailure/Cause")] ?? causeContainer.cause
    if (cause && typeof cause === "object") {
      const causeObj = cause as Record<string, unknown>
      const inner = causeObj.failure ?? causeObj.error
      if (inner && typeof inner === "object" && "_tag" in inner) {
        const innerTag = (inner as { _tag: unknown })._tag
        if (typeof innerTag === "string") return innerTag
      }
    }
    return undefined
  },
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

vi.mock("@/services/payment.service", () => ({
  recordPaymentWithTxid: vi.fn(),
  editPaymentWithTxid: vi.fn(),
  deletePaymentWithTxid: vi.fn(),
  listPayments: vi.fn(),
  searchActiveLoans: vi.fn(),
  getRecentlyCollectedLoans: vi.fn(),
  getLoanBalanceSummary: vi.fn(),
}))

vi.mock("@/lib/db", () => {
  const mockSelect = vi.fn()
  return {
    db: {
      select: mockSelect,
    },
  }
})

vi.mock("@/lib/db/schema/payments", () => ({
  payments: { id: "id", loanId: "loanId", deletedAt: "deletedAt", recordedBy: "recordedBy", paymentDate: "paymentDate", createdAt: "createdAt", markedWrong: "markedWrong" },
}))

vi.mock("@/lib/db/schema/loans", () => ({
  loans: { id: "id" },
}))

vi.mock("@/lib/interest/effective-rate", () => ({
  getBaseRate: vi.fn(),
}))

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  asc: vi.fn((col: unknown) => col),
  isNull: vi.fn((col: unknown) => col),
}))

vi.mock("@/lib/email", () => ({
  sendAdminNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock("@/lib/ip-allowlist", () => ({
  isIpAllowlistEnabled: vi.fn().mockResolvedValue(false),
  isIpAllowed: vi.fn().mockResolvedValue(true),
  recordBlock: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn().mockReturnValue(null),
}))

vi.mock("@/services/transaction.service", () => ({
  postJournalEntry: vi.fn(),
  reverseInterestAccrual: vi.fn(),
}))

vi.mock("@/services/auto-post.service", () => ({
  autoPostInterestEarned: vi.fn(),
  autoPostPrincipalRepayment: vi.fn(),
}))

vi.mock("@/services/ledger-queries.service", () => ({
  getLoanBalanceFromLedger: vi.fn(),
  getPaymentPortionsFromLedger: vi.fn(),
}))

vi.mock("@/lib/interest/engine", () => ({
  allocatePayment: vi.fn(),
}))

vi.mock("@/lib/db/utils", () => ({
  daysBetween: vi.fn(),
}))

// ---------- Imports ----------

import { getSession, getUserRole, requireRole } from "@/lib/action-utils"
import { validatePositiveDecimal } from "@/lib/validators"
import { revalidatePath } from "next/cache"
import {
  recordPaymentWithTxid,
  editPaymentWithTxid,
  deletePaymentWithTxid,
  listPayments,
  searchActiveLoans,
} from "@/services/payment.service"
import { LoanNotFound, PaymentNotFound } from "@/lib/errors"

import {
  recordPaymentAction,
  editPaymentAction,
  deletePaymentAction,
  listPaymentsAction,
  searchActiveLoansAction,
  getPaymentsByLoanAction,
} from "../payment.actions"

const mockGetSession = vi.mocked(getSession)
const mockGetUserRole = vi.mocked(getUserRole)
const mockRequireRole = vi.mocked(requireRole)
const mockRevalidatePath = vi.mocked(revalidatePath)
const mockRecordPayment = vi.mocked(recordPaymentWithTxid)
const mockEditPayment = vi.mocked(editPaymentWithTxid)
const mockDeletePayment = vi.mocked(deletePaymentWithTxid)
const mockListPayments = vi.mocked(listPayments)
const mockSearchActiveLoans = vi.mocked(searchActiveLoans)
void mockRequireRole
void validatePositiveDecimal

import { fakeSession, effectReturn } from "./test-utils"
import type { RecordPaymentInput } from "@/types"

const recordPaymentReturn = effectReturn<typeof recordPaymentWithTxid>
const editPaymentReturn = effectReturn<typeof editPaymentWithTxid>
const deletePaymentReturn = effectReturn<typeof deletePaymentWithTxid>
const listPaymentsReturn = effectReturn<typeof listPayments>
const searchActiveLoansReturn = effectReturn<typeof searchActiveLoans>

// ---------- Tests ----------

describe("Payment Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===== recordPaymentAction =====
  describe("recordPaymentAction", () => {
    const validInput: RecordPaymentInput = {
      loanId: "loan-123",
      amount: "50000",
      paymentDate: "2026-04-01",
      depositLocation: "cash",
    }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await recordPaymentAction(validInput)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error for missing loan ID", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await recordPaymentAction({ ...validInput, loanId: "" })
      expect(result).toEqual({ error: "Loan ID is required" })
    })

    it("returns error for invalid amount", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await recordPaymentAction({ ...validInput, amount: "abc" })
      expect(result).toHaveProperty("error")
      expect((result as { error: string }).error).toContain("Amount")
    })

    it("returns error for invalid payment date", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await recordPaymentAction({ ...validInput, paymentDate: "not-a-date" })
      expect(result).toEqual({ error: "Payment date must be a valid date" })
    })

    it("returns error for invalid deposit location", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await recordPaymentAction({
        ...validInput,
        depositLocation: "mattress" as unknown as RecordPaymentInput["depositLocation"],
      })
      expect(result).toHaveProperty("error")
      expect((result as { error: string }).error).toContain("Deposit location")
    })

    it("records payment and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const recorded = { id: "p1", loanId: "loan-123", amount: "50000" }
      mockRecordPayment.mockReturnValue(recordPaymentReturn(Effect.succeed({ payment: recorded, txid: "tx_001" })))

      const result = await recordPaymentAction(validInput)

      expect(result).toEqual({ data: recorded, txid: "tx_001" })
      expect(mockRecordPayment).toHaveBeenCalledWith(validInput, "u1")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/loans/loan-123")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/payments")
    })

    it("returns error when loan not found", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRecordPayment.mockReturnValue(
        recordPaymentReturn(Effect.fail(new LoanNotFound({ id: "loan-123" }))),
      )
      const result = await recordPaymentAction(validInput)
      expect(result).toEqual({ error: "Loan not found" })
    })

    it("returns generic error for unknown service failure", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRecordPayment.mockReturnValue(recordPaymentReturn(Effect.fail(new Error("boom"))))
      const result = await recordPaymentAction(validInput)
      expect(result).toEqual({ error: "Internal server error" })
    })
  })

  // ===== editPaymentAction =====
  describe("editPaymentAction", () => {
    const validInput = {
      paymentId: "p1",
      amount: "60000",
      reason: "Correction of amount",
    }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await editPaymentAction(validInput)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error for missing payment ID", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await editPaymentAction({ ...validInput, paymentId: "" })
      expect(result).toEqual({ error: "Payment ID is required" })
    })

    it("returns error for missing reason", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await editPaymentAction({ ...validInput, reason: "" })
      expect(result).toEqual({ error: "A reason is required to edit a payment" })
    })

    it("edits payment as admin without ownership check", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const edited = { id: "p1", loanId: "loan-1", amount: "60000" }
      mockEditPayment.mockReturnValue(editPaymentReturn(Effect.succeed({ payment: edited, txid: "tx_002" })))

      const result = await editPaymentAction(validInput)

      expect(result).toEqual({ data: edited, txid: "tx_002" })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/loans/loan-1")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/payments")
    })

    it("returns error when service throws PaymentNotFound", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      mockEditPayment.mockReturnValue(
        editPaymentReturn(Effect.fail(new PaymentNotFound({ id: "p1" }))),
      )
      const result = await editPaymentAction(validInput)
      expect(result).toEqual({ error: "Payment not found" })
    })
  })

  // ===== deletePaymentAction =====
  describe("deletePaymentAction", () => {
    const validInput = {
      paymentId: "p1",
      reason: "Duplicate entry",
    }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await deletePaymentAction(validInput)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error for missing payment ID", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await deletePaymentAction({ ...validInput, paymentId: "" })
      expect(result).toEqual({ error: "Payment ID is required" })
    })

    it("returns error for missing reason", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await deletePaymentAction({ ...validInput, reason: "" })
      expect(result).toEqual({ error: "A reason is required to delete a payment" })
    })

    it("deletes payment as admin and revalidates", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const deleted = { id: "p1", loanId: "loan-1", amount: "50000" }
      mockDeletePayment.mockReturnValue(deletePaymentReturn(Effect.succeed({ payment: deleted, txid: "tx_003" })))

      const result = await deletePaymentAction(validInput)

      expect(result).toEqual({ data: deleted, txid: "tx_003" })
      expect(mockRevalidatePath).toHaveBeenCalledWith("/loans/loan-1")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/payments")
    })

    it("returns error when payment not found", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      mockDeletePayment.mockReturnValue(
        deletePaymentReturn(Effect.fail(new PaymentNotFound({ id: "p1" }))),
      )
      const result = await deletePaymentAction(validInput)
      expect(result).toEqual({ error: "Payment not found" })
    })
  })

  // ===== listPaymentsAction =====
  describe("listPaymentsAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await listPaymentsAction({})
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns paginated data on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const data = { rows: [], total: 0 }
      mockListPayments.mockReturnValue(listPaymentsReturn(Effect.succeed(data)))
      const result = await listPaymentsAction({ page: 1, pageSize: 25 })
      expect(result).toEqual({ data })
    })
  })

  // ===== getPaymentsByLoanAction =====
  describe("getPaymentsByLoanAction", () => {
    it("excludes markedWrong payments from the query", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const { db: mockedDb } = await import("@/lib/db")
      const { eq } = await import("drizzle-orm")

      const mockRows = [
        { id: "p1", loanId: "loan-1", amount: "50000", markedWrong: false },
      ]

      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(mockRows),
          }),
        }),
      })

      await getPaymentsByLoanAction("loan-1")

      // Verify that eq was called with the markedWrong column and false
      const eqCalls = (eq as ReturnType<typeof vi.fn>).mock.calls
      const markedWrongFilter = eqCalls.find(
        (call: unknown[]) => call[0] === "markedWrong" && call[1] === false
      )
      expect(markedWrongFilter).toBeDefined()
    })
  })

  // ===== searchActiveLoansAction =====
  describe("searchActiveLoansAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await searchActiveLoansAction("john")
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns empty array for empty query", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await searchActiveLoansAction("")
      expect(result).toEqual({ data: [] })
    })

    it("returns results for valid query", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const loans = [{ id: "l1", customerName: "John" }]
      mockSearchActiveLoans.mockReturnValue(searchActiveLoansReturn(Effect.succeed(loans)))
      const result = await searchActiveLoansAction("john")
      expect(result).toEqual({ data: loans })
    })
  })
})
