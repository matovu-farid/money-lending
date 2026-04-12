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
  getErrorField: (error: unknown, field: string): unknown => {
    if (error == null || typeof error !== "object") return undefined
    if ("_tag" in error && field in error) return (error as any)[field]
    const cause = (error as any)[Symbol.for("effect/Runtime/FiberFailure/Cause")] ?? (error as any).cause
    if (cause && typeof cause === "object") {
      const inner = cause.failure ?? cause.error
      if (inner && typeof inner === "object" && field in inner) {
        return (inner as any)[field]
      }
    }
    return undefined
  },
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

vi.mock("@/services/loan.service", () => ({
  createLoan: vi.fn(),
  listLoans: vi.fn(),
  updateLoan: vi.fn(),
  deleteLoan: vi.fn(),
}))

vi.mock("@/lib/db", () => {
  const mockSelect = vi.fn()
  const mockSelectDistinct = vi.fn()
  return {
    db: {
      select: mockSelect,
      selectDistinct: mockSelectDistinct,
    },
  }
})

vi.mock("@/lib/db/schema", () => ({
  collateral: { nature: "nature", description: "description", loanId: "loanId" },
}))

vi.mock("@/lib/db/schema/auth", () => ({
  user: { id: "id" },
}))

vi.mock("@/lib/db/schema/loans", () => ({
  loans: { id: "id", customerId: "customerId" },
}))

vi.mock("@/lib/db/schema/customers", () => ({
  customers: { id: "id", fullName: "fullName" },
}))

vi.mock("@/lib/db/schema/payments", () => ({
  payments: { loanId: "loanId", deletedAt: "deletedAt", paymentDate: "paymentDate" },
}))

vi.mock("@/lib/interest/effective-rate", () => ({
  getBaseRate: vi.fn(),
}))

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  isNull: vi.fn((col: any) => col),
  asc: vi.fn((col: any) => col),
  desc: vi.fn((col: any) => col),
  inArray: vi.fn((...args: any[]) => args),
}))

vi.mock("@/lib/email", () => ({
  sendAdminNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/interest/overdue", () => ({
  computeLoanOverdueInfo: vi.fn(),
}))

vi.mock("@/services/export/excel.service", () => ({
  generateLoansExcel: vi.fn(),
}))

vi.mock("@/services/ledger-queries.service", () => ({
  getLoanBalancesFromLedger: vi.fn(),
  getInterestEarnedFromLedger: vi.fn(),
}))

vi.mock("@/services/report.service", () => ({
  getLocationBalances: vi.fn(),
}))

vi.mock("@/lib/interest/engine", () => ({
  formatAmount: vi.fn((v: any) => String(v)),
}))

// ---------- Imports ----------

import { getSession, getUserRole, requireRole } from "@/lib/action-utils"
import { validatePositiveDecimal } from "@/lib/validators"
import { revalidatePath } from "next/cache"
import { createLoan, listLoans, updateLoan, deleteLoan } from "@/services/loan.service"
import { getLocationBalances } from "@/services/report.service"
import { CustomerNotFound, IncompleteLoanRequirements, LoanNotFound } from "@/lib/errors"
import { ROLE_LEVELS } from "@/types"

import {
  listLoansAction,
  createLoanAction,
  updateLoanAction,
  deleteLoanAction,
  getLocationBalancesAction,
} from "../loan.actions"

const mockGetSession = vi.mocked(getSession)
const mockGetUserRole = vi.mocked(getUserRole)
const mockRequireRole = vi.mocked(requireRole)
const mockRevalidatePath = vi.mocked(revalidatePath)
const mockCreateLoan = vi.mocked(createLoan)
const mockListLoans = vi.mocked(listLoans)
const mockUpdateLoan = vi.mocked(updateLoan)
const mockDeleteLoan = vi.mocked(deleteLoan)
const mockGetLocationBalances = vi.mocked(getLocationBalances)

const fakeSession = {
  user: { id: "u1", name: "Test User", email: "t@t.com", role: "admin" },
} as any

// ---------- Tests ----------

describe("Loan Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===== getLocationBalancesAction =====
  describe("getLocationBalancesAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await getLocationBalancesAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns balances on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const balances = { cash: "1000000", bank: "5000000", strong_room: "2000000" }
      mockGetLocationBalances.mockReturnValue(Effect.succeed(balances) as any)
      const result = await getLocationBalancesAction()
      expect(result).toEqual({ data: balances })
    })

    it("returns error on failure", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetLocationBalances.mockReturnValue(Effect.fail(new Error("boom")) as any)
      const result = await getLocationBalancesAction()
      expect(result).toEqual({ error: "Internal server error" })
    })
  })

  // ===== listLoansAction =====
  describe("listLoansAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await listLoansAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns loans on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const loans = [{ id: "l1" }]
      mockListLoans.mockReturnValue(Effect.succeed(loans) as any)
      const result = await listLoansAction()
      expect(result).toEqual({ data: loans })
    })

    it("returns error on service failure", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockListLoans.mockReturnValue(Effect.fail(new Error("fail")) as any)
      const result = await listLoansAction()
      expect(result).toEqual({ error: "Internal server error" })
    })
  })

  // ===== updateLoanAction =====
  describe("updateLoanAction", () => {
    const validInput = {
      loanId: "l1",
      principalAmount: "500000",
      reason: "Correcting amount",
    }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await updateLoanAction(validInput)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error when role is insufficient", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue("Forbidden")
      const result = await updateLoanAction(validInput)
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("returns error for missing loan ID", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue(null)
      const result = await updateLoanAction({ ...validInput, loanId: "" })
      expect(result).toEqual({ error: "Loan ID is required" })
    })

    it("returns error for missing reason", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue(null)
      const result = await updateLoanAction({ ...validInput, reason: "" })
      expect(result).toEqual({ error: "Reason is required" })
    })

    it("returns error for invalid principal amount", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue(null)
      const result = await updateLoanAction({
        ...validInput,
        principalAmount: "abc",
      })
      expect(result).toHaveProperty("error")
      expect((result as any).error).toContain("Principal")
    })

    it("returns error for low issuance fee", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue(null)
      const result = await updateLoanAction({
        loanId: "l1",
        reason: "Updating fee",
        issuanceFee: "10000",
      })
      expect(result).toEqual({ error: "Issuance fee must be at least 50,000 UGX" })
    })

    it("updates loan and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue(null)
      const updated = { id: "l1", principalAmount: "500000" }
      mockUpdateLoan.mockReturnValue(Effect.succeed(updated) as any)

      const result = await updateLoanAction(validInput)

      expect(result).toEqual({ data: updated })
      expect(mockUpdateLoan).toHaveBeenCalledWith(validInput, "u1")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/loans")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/loans/l1")
    })

    it("returns error when loan not found", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue(null)
      mockUpdateLoan.mockReturnValue(
        Effect.fail(new LoanNotFound({ id: "l1" })) as any,
      )
      const result = await updateLoanAction(validInput)
      expect(result).toEqual({ error: "Loan not found" })
    })
  })

  // ===== deleteLoanAction =====
  describe("deleteLoanAction", () => {
    const validInput = {
      loanId: "l1",
      reason: "Test delete reason",
    }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await deleteLoanAction(validInput)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error when role is insufficient", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue("Forbidden")
      const result = await deleteLoanAction(validInput)
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("returns error for missing loan ID", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue(null)
      const result = await deleteLoanAction({ ...validInput, loanId: "" })
      expect(result).toEqual({ error: "Loan ID is required" })
    })

    it("returns error for missing reason", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue(null)
      const result = await deleteLoanAction({ ...validInput, reason: "" })
      expect(result).toEqual({ error: "Reason is required" })
    })

    it("deletes loan and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue(null)
      const deleted = { id: "l1" }
      mockDeleteLoan.mockReturnValue(Effect.succeed(deleted) as any)

      const result = await deleteLoanAction(validInput)

      expect(result).toEqual({ data: deleted })
      expect(mockDeleteLoan).toHaveBeenCalledWith(validInput, "u1")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/loans")
    })

    it("returns error when loan not found", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockRequireRole.mockReturnValue(null)
      mockDeleteLoan.mockReturnValue(
        Effect.fail(new LoanNotFound({ id: "l1" })) as any,
      )
      const result = await deleteLoanAction(validInput)
      expect(result).toEqual({ error: "Loan not found" })
    })
  })

  // ===== createLoanAction =====
  describe("createLoanAction", () => {
    // Use a date that is "today" to avoid backdate logic issues
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayISO = today.toISOString()

    const validInput = {
      customerId: "c1",
      principalAmount: "1000000",
      issuanceFee: "100000",
      interestRate: "0.10",
      minInterestDays: 30,
      startDate: todayISO,
      collateral: { nature: "Land title", description: "Plot in Kampala" },
      disbursementSource: "cash" as const,
    }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await createLoanAction(validInput)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error when role is below loanOfficer", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("unassigned")
      const result = await createLoanAction(validInput)
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("returns error for missing customer ID", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const result = await createLoanAction({ ...validInput, customerId: "" })
      expect(result).toEqual({ error: "Customer ID is required" })
    })

    it("returns error for invalid principal", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const result = await createLoanAction({ ...validInput, principalAmount: "abc" })
      expect(result).toHaveProperty("error")
      expect((result as any).error).toContain("Principal")
    })

    it("returns error for missing start date", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const result = await createLoanAction({ ...validInput, startDate: "" })
      expect(result).toEqual({ error: "Start date is required" })
    })

    it("returns error for future start date", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const future = new Date()
      future.setDate(future.getDate() + 5)
      const result = await createLoanAction({
        ...validInput,
        startDate: future.toISOString(),
      })
      expect(result).toEqual({ error: "Start date cannot be in the future" })
    })

    it("returns error for missing collateral nature", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const result = await createLoanAction({
        ...validInput,
        collateral: { nature: "", description: "desc" },
      })
      expect(result).toEqual({ error: "Collateral nature is required" })
    })

    it("returns error for low issuance fee on non-rollover", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const result = await createLoanAction({
        ...validInput,
        issuanceFee: "10000",
      })
      expect(result).toEqual({ error: "Issuance fee must be at least 50,000 UGX" })
    })

    it("returns error for missing collateral description", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const result = await createLoanAction({
        ...validInput,
        collateral: { nature: "Car", description: "" },
      })
      expect(result).toEqual({ error: "Collateral description is required" })
    })

    it("returns error for invalid disbursement source", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const result = await createLoanAction({
        ...validInput,
        disbursementSource: "pillow" as any,
      })
      expect(result).toHaveProperty("error")
      expect((result as any).error).toContain("Disbursement source")
    })

    it("creates loan and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const created = { id: "new-loan-id" }
      mockCreateLoan.mockReturnValue(Effect.succeed(created) as any)

      const result = await createLoanAction(validInput)

      expect(result).toEqual({ data: created })
      expect(mockCreateLoan).toHaveBeenCalled()
      expect(mockRevalidatePath).toHaveBeenCalledWith("/loans")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/customers/c1")
    })

    it("returns error when customer not found", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      mockCreateLoan.mockReturnValue(
        Effect.fail(new CustomerNotFound({ id: "c1" })) as any,
      )
      const result = await createLoanAction(validInput)
      expect(result).toEqual({ error: "Customer not found" })
    })

    it("returns error for incomplete requirements", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      mockCreateLoan.mockReturnValue(
        Effect.fail(new IncompleteLoanRequirements({ missing: ["NIN"] })) as any,
      )
      const result = await createLoanAction(validInput)
      expect(result).toEqual({ error: "Missing fields: NIN" })
    })

    it("requires supervisor role for rollover loans", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("loanOfficer")
      const result = await createLoanAction({
        ...validInput,
        rollover: {
          fromLoanId: "old-loan",
          carriedPrincipal: "500000",
          carriedInterest: "50000",
        },
      })
      expect(result).toEqual({
        error: "Only supervisors and above can perform loan rollovers",
      })
    })

    it("requires term months for fixed_rate loans", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const result = await createLoanAction({
        ...validInput,
        loanType: "fixed_rate",
      })
      expect(result).toEqual({
        error: "Term months must be a positive integer for fixed rate and reducing balance loans",
      })
    })
  })
})
