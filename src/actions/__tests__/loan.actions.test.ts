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
  checkPermission: vi.fn(async () => null),
  getEffectivePermissions: vi.fn().mockResolvedValue(new Set([
    "loan:create", "loan:update", "loan:disburse", "loan:rollover", "loan:settle",
    "backdate:beyond-3-days", "fund-transfer:create", "settings:update",
    "rate-change:approve-standard", "rate-change:approve-low",
  ])),
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
  getErrorField: (error: unknown, field: string): unknown => {
    if (error == null || typeof error !== "object") return undefined
    if ("_tag" in error && field in error) {
      return (error as Record<string, unknown>)[field]
    }
    const causeContainer = error as Record<string | symbol, unknown>
    const cause = causeContainer[Symbol.for("effect/Runtime/FiberFailure/Cause")] ?? causeContainer.cause
    if (cause && typeof cause === "object") {
      const causeObj = cause as Record<string, unknown>
      const inner = causeObj.failure ?? causeObj.error
      if (inner && typeof inner === "object" && field in inner) {
        return (inner as Record<string, unknown>)[field]
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
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((col: unknown) => col),
  asc: vi.fn((col: unknown) => col),
  desc: vi.fn((col: unknown) => col),
  inArray: vi.fn((...args: unknown[]) => args),
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
  getLocationBalances: vi.fn().mockReturnValue(
    Effect.succeed({ cash: "99999999", bank: "99999999", strong_room: "99999999" })
  ),
}))

vi.mock("@/lib/interest/engine", () => ({
  formatAmount: vi.fn((v: unknown) => String(v)),
}))

// ---------- Imports ----------

import { getSession, getUserRole, checkPermission, getEffectivePermissions } from "@/lib/action-utils"
import { validatePositiveDecimal } from "@/lib/validators"
import { revalidatePath } from "next/cache"
import { createLoan, listLoans } from "@/services/loan.service"
import { getLocationBalances } from "@/services/report.service"
import { CustomerNotFound, IncompleteLoanRequirements } from "@/lib/errors"


import {
  listLoansAction,
  createLoanAction,
  updateLoanAction,
  deleteLoanAction,
  getLocationBalancesAction,
} from "../loan.actions"

const mockGetSession = vi.mocked(getSession)
const mockGetUserRole = vi.mocked(getUserRole)
const mockCheckPermission = vi.mocked(checkPermission)
const mockGetEffectivePermissions = vi.mocked(getEffectivePermissions)
const mockRevalidatePath = vi.mocked(revalidatePath)
const mockCreateLoan = vi.mocked(createLoan)
const mockListLoans = vi.mocked(listLoans)
const mockGetLocationBalances = vi.mocked(getLocationBalances)

import { fakeSession, effectReturn } from "./test-utils"
import type { CreateLoanInput } from "@/types"
void validatePositiveDecimal

const locationBalancesReturn = effectReturn<typeof getLocationBalances>
const listLoansReturn = effectReturn<typeof listLoans>
const createLoanReturn = effectReturn<typeof createLoan>

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
      mockGetLocationBalances.mockReturnValue(locationBalancesReturn(Effect.succeed(balances)))
      const result = await getLocationBalancesAction()
      expect(result).toEqual({ data: balances })
    })

    it("returns error on failure", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetLocationBalances.mockReturnValue(locationBalancesReturn(Effect.fail(new Error("boom"))))
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
      mockListLoans.mockReturnValue(listLoansReturn(Effect.succeed(loans)))
      const result = await listLoansAction()
      expect(result).toEqual({ data: loans })
    })

    it("returns error on service failure", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockListLoans.mockReturnValue(listLoansReturn(Effect.fail(new Error("fail"))))
      const result = await listLoansAction()
      expect(result).toEqual({ error: "Internal server error" })
    })
  })

  // ===== updateLoanAction (permanently disabled) =====
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

    it("returns error when permission is insufficient", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValueOnce("Forbidden")
      const result = await updateLoanAction(validInput)
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("always returns disabled message even with valid input", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await updateLoanAction(validInput)
      expect(result).toEqual({ error: "Loan editing is disabled. Issue a new loan instead." })
    })
  })

  // ===== deleteLoanAction (permanently disabled) =====
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

    it("returns error when permission is insufficient", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValueOnce("Forbidden")
      const result = await deleteLoanAction(validInput)
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("always returns disabled message even with valid input", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await deleteLoanAction(validInput)
      expect(result).toEqual({ error: "Loan deletion is disabled. Loans are permanent records." })
    })
  })

  // ===== createLoanAction =====
  describe("createLoanAction", () => {
    // Use a date that is "today" to avoid backdate logic issues
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayISO = today.toISOString()

    const validInput: CreateLoanInput = {
      customerId: "c1",
      principalAmount: "1000000",
      issuanceFee: "100000",
      interestRate: "0.10",
      minInterestDays: 30,
      startDate: todayISO,
      collateral: { nature: "Land title", description: "Plot in Kampala" },
      disbursementSource: "cash",
    }

    beforeEach(() => {
      // Restore default mocks cleared by parent beforeEach
      mockGetLocationBalances.mockReturnValue(
        locationBalancesReturn(Effect.succeed({ cash: "99999999", bank: "99999999", strong_room: "99999999" })),
      )
      mockGetEffectivePermissions.mockResolvedValue(new Set([
        "loan:create", "loan:update", "loan:disburse", "loan:rollover", "loan:settle",
        "backdate:beyond-3-days", "fund-transfer:create", "settings:update",
        "rate-change:approve-standard", "rate-change:approve-low",
      ]))
    })

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await createLoanAction(validInput)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error when role is below loanOfficer", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("unassigned")
      mockGetEffectivePermissions.mockResolvedValueOnce(new Set())
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
      expect((result as { error: string }).error).toContain("Principal")
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
        // Intentionally invalid for runtime guard test.
        disbursementSource: "pillow" as unknown as CreateLoanInput["disbursementSource"],
      })
      expect(result).toHaveProperty("error")
      expect((result as { error: string }).error).toContain("Disbursement source")
    })

    it("creates loan and revalidates on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      const created = { id: "new-loan-id" }
      mockCreateLoan.mockReturnValue(createLoanReturn(Effect.succeed(created)))

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
        createLoanReturn(Effect.fail(new CustomerNotFound({ id: "c1" }))),
      )
      const result = await createLoanAction(validInput)
      expect(result).toEqual({ error: "Customer not found" })
    })

    it("returns error for incomplete requirements", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("admin")
      mockCreateLoan.mockReturnValue(
        createLoanReturn(Effect.fail(new IncompleteLoanRequirements({ missing: ["NIN"] }))),
      )
      const result = await createLoanAction(validInput)
      expect(result).toEqual({ error: "Missing fields: NIN" })
    })

    it("requires supervisor role for rollover loans", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetUserRole.mockReturnValue("loanOfficer")
      mockGetEffectivePermissions.mockResolvedValueOnce(new Set(["loan:create"]))
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
