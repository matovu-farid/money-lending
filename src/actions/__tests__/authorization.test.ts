import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"
import { ROLE_PERMISSIONS, getPermissionsForRole } from "@/lib/permissions"
import type { Permission, UserRole } from "@/types"

/**
 * Authorization regression tests.
 *
 * These tests verify that server actions enforce the correct permission gates.
 * They were written to catch three classes of authorization bugs:
 *
 *   1. Missing permission gate — editPaymentAction and deletePaymentAction
 *      originally had no `permission` property, letting any authenticated user
 *      invoke them.
 *
 *   2. Wrong permission level — waivePenaltyAction and adjustPenaltyMultiplierAction
 *      originally used `loan:update` (granted to loan officers) instead of
 *      `settings:update` (admin-only).
 *
 *   3. Missing read gate — getSettingsAction had no permission check, allowing
 *      any authenticated user to read system settings.
 */

// ---------- Mocks ----------

vi.mock("@/lib/validators", () => ({
  validatePositiveDecimal: vi.fn(() => null),
  validateRequired: vi.fn(),
}))

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
  getUserRole: vi.fn((session: any) => session?.user?.role ?? "unassigned"),
  requireRole: vi.fn(),
  checkPermission: vi.fn(async (_session: any, permission: string) => {
    // Real implementation delegates to getEffectivePermissions.
    // In these tests we control it directly per-test.
    return null
  }),
  getEffectivePermissions: vi.fn().mockResolvedValue(new Set<Permission>()),
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
  getErrorField: () => undefined,
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

// Payment action deps
vi.mock("@/services/payment.service", () => ({
  recordPayment: vi.fn(),
  editPayment: vi.fn(),
  deletePayment: vi.fn(),
  listPayments: vi.fn(),
  searchActiveLoans: vi.fn(),
  getRecentlyCollectedLoans: vi.fn(),
  getLoanBalanceSummary: vi.fn(),
}))

vi.mock("@/lib/db", () => {
  const mockWhere = vi.fn().mockResolvedValue([])
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })
  const mockUpdate = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  })
  return {
    db: {
      select: mockSelect,
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ key: "k", value: "v" }]),
          }),
        }),
      }),
      update: mockUpdate,
    },
  }
})

vi.mock("@/lib/db/schema/payments", () => ({
  payments: { id: "id", loanId: "loanId", deletedAt: "deletedAt", recordedBy: "recordedBy", paymentDate: "paymentDate", createdAt: "createdAt", markedWrong: "markedWrong" },
}))

vi.mock("@/lib/db/schema/loans", () => ({
  loans: { id: "id", customerId: "customerId", deletedAt: "deletedAt" },
}))

vi.mock("@/lib/db/schema/settings", () => ({
  systemSettings: { key: "key", value: "value", updatedBy: "updatedBy", updatedAt: "updatedAt" },
}))

vi.mock("@/lib/db/schema/customers", () => ({
  customers: { id: "id", fullName: "fullName" },
}))

vi.mock("@/lib/db/schema", () => ({
  collateral: { nature: "nature", description: "description", loanId: "loanId" },
}))

vi.mock("@/lib/db/schema/auth", () => ({
  user: { id: "id" },
}))

vi.mock("@/lib/interest/effective-rate", () => ({
  getBaseRate: vi.fn(),
}))

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  asc: vi.fn((col: any) => col),
  desc: vi.fn((col: any) => col),
  isNull: vi.fn((col: any) => col),
  inArray: vi.fn((...args: any[]) => args),
}))

vi.mock("@/lib/email", () => ({
  sendAdminNotification: vi.fn().mockResolvedValue(undefined),
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
  getLoanBalancesFromLedger: vi.fn(),
  getInterestEarnedFromLedger: vi.fn(),
}))

vi.mock("@/lib/interest/engine", () => ({
  allocatePayment: vi.fn(),
  formatAmount: vi.fn((v: any) => String(v)),
}))

vi.mock("@/lib/db/utils", () => ({
  daysBetween: vi.fn(),
}))

vi.mock("@/services/loan.service", () => ({
  createLoan: vi.fn(),
  listLoans: vi.fn(),
  updateLoan: vi.fn(),
  deleteLoan: vi.fn(),
}))

vi.mock("@/lib/interest/overdue", () => ({
  computeLoanOverdueInfo: vi.fn(),
}))

vi.mock("@/services/export/excel.service", () => ({
  generateLoansExcel: vi.fn(),
}))

vi.mock("@/services/report.service", () => ({
  getLocationBalances: vi.fn().mockReturnValue(
    Effect.succeed({ cash: "99999999", bank: "99999999", strong_room: "99999999" })
  ),
}))

// ---------- Imports (after mocks) ----------

import { getSession, checkPermission, getEffectivePermissions } from "@/lib/action-utils"
import { editPayment, deletePayment } from "@/services/payment.service"

import {
  editPaymentAction,
  deletePaymentAction,
} from "../payment.actions"

import {
  waivePenaltyAction,
  adjustPenaltyMultiplierAction,
} from "../loan.actions"

import {
  getSettingsAction,
} from "../settings.actions"

import { fakeSession, lowRoleSession, loanOfficerSession, supervisorSession } from "./test-utils"

const mockGetSession = vi.mocked(getSession)
const mockCheckPermission = vi.mocked(checkPermission)
const mockGetEffectivePermissions = vi.mocked(getEffectivePermissions)
const mockEditPayment = vi.mocked(editPayment)
const mockDeletePayment = vi.mocked(deletePayment)

// ---------- Helpers ----------

/**
 * Configure mocks so that checkPermission behaves like the real implementation:
 * it checks whether the session user's role grants the requested permission.
 */
function useRealPermissionCheck() {
  mockCheckPermission.mockImplementation(async (session, permission, message) => {
    const role = (session as any).user?.role ?? "unassigned"
    const perms = getPermissionsForRole(role as UserRole)
    return perms.has(permission) ? null : (message ?? "Forbidden")
  })
}

// ---------- Tests ----------

describe("Authorization regression tests", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: use real permission check logic
    useRealPermissionCheck()
    // Default: getEffectivePermissions returns role-based perms
    mockGetEffectivePermissions.mockImplementation(async (_userId, role) => {
      return getPermissionsForRole(role as UserRole)
    })
  })

  // ==========================================================================
  // Bug 1: editPaymentAction had no permission gate
  // ==========================================================================
  describe("editPaymentAction authorization", () => {
    const validInput = {
      paymentId: "p1",
      amount: "60000",
      reason: "Correction",
    }

    it("requires payment:create permission (checkPermission is called with 'payment:create')", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      mockEditPayment.mockReturnValue(Effect.succeed({ id: "p1", loanId: "l1", amount: "60000" }) as any)

      await editPaymentAction(validInput)

      expect(mockCheckPermission).toHaveBeenCalledWith(
        fakeSession,
        "payment:create",
        undefined,
      )
    })

    it("rejects unauthenticated users", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await editPaymentAction(validInput)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("rejects unassigned role (no payment:create permission)", async () => {
      mockGetSession.mockResolvedValue(lowRoleSession)
      const result = await editPaymentAction(validInput)
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("allows loan officers (who have payment:create)", async () => {
      mockGetSession.mockResolvedValue(loanOfficerSession)
      mockEditPayment.mockReturnValue(Effect.succeed({ id: "p1", loanId: "l1", amount: "60000" }) as any)

      const result = await editPaymentAction(validInput)
      expect(result).not.toEqual({ error: "Forbidden" })
      expect(result).not.toEqual({ error: "Unauthorized" })
    })
  })

  // ==========================================================================
  // Bug 1: deletePaymentAction had no permission gate
  // ==========================================================================
  describe("deletePaymentAction authorization", () => {
    const validInput = {
      paymentId: "p1",
      reason: "Duplicate entry",
    }

    it("requires payment:create permission (checkPermission is called with 'payment:create')", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      mockDeletePayment.mockReturnValue(Effect.succeed({ id: "p1", loanId: "l1", amount: "50000" }) as any)

      await deletePaymentAction(validInput)

      expect(mockCheckPermission).toHaveBeenCalledWith(
        fakeSession,
        "payment:create",
        undefined,
      )
    })

    it("rejects unauthenticated users", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await deletePaymentAction(validInput)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("rejects unassigned role (no payment:create permission)", async () => {
      mockGetSession.mockResolvedValue(lowRoleSession)
      const result = await deletePaymentAction(validInput)
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("allows loan officers (who have payment:create)", async () => {
      mockGetSession.mockResolvedValue(loanOfficerSession)
      mockDeletePayment.mockReturnValue(Effect.succeed({ id: "p1", loanId: "l1", amount: "50000" }) as any)

      const result = await deletePaymentAction(validInput)
      expect(result).not.toEqual({ error: "Forbidden" })
      expect(result).not.toEqual({ error: "Unauthorized" })
    })
  })

  // ==========================================================================
  // Bug 2: waivePenaltyAction used loan:update instead of settings:update
  // ==========================================================================
  describe("waivePenaltyAction authorization", () => {
    it("requires settings:update permission (checkPermission is called with 'settings:update')", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)

      await waivePenaltyAction("loan-1")

      expect(mockCheckPermission).toHaveBeenCalledWith(
        fakeSession,
        "settings:update",
        "Only admins can waive penalties",
      )
    })

    it("rejects unauthenticated users", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await waivePenaltyAction("loan-1")
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("rejects unassigned role", async () => {
      mockGetSession.mockResolvedValue(lowRoleSession)
      const result = await waivePenaltyAction("loan-1")
      expect(result).toEqual({ error: "Only admins can waive penalties" })
    })

    it("rejects loan officers (settings:update is admin-only, NOT loan:update)", async () => {
      mockGetSession.mockResolvedValue(loanOfficerSession)
      const result = await waivePenaltyAction("loan-1")
      expect(result).toEqual({ error: "Only admins can waive penalties" })
    })

    it("rejects supervisors (settings:update is admin-only)", async () => {
      mockGetSession.mockResolvedValue(supervisorSession)
      const result = await waivePenaltyAction("loan-1")
      expect(result).toEqual({ error: "Only admins can waive penalties" })
    })

    it("allows admins (who have settings:update)", async () => {
      mockGetSession.mockResolvedValue(fakeSession) // admin role
      const result = await waivePenaltyAction("loan-1")
      expect(result).not.toEqual({ error: "Only admins can waive penalties" })
      expect(result).not.toEqual({ error: "Forbidden" })
      expect(result).not.toEqual({ error: "Unauthorized" })
    })
  })

  // ==========================================================================
  // Bug 2: adjustPenaltyMultiplierAction used loan:update instead of settings:update
  // ==========================================================================
  describe("adjustPenaltyMultiplierAction authorization", () => {
    it("requires settings:update permission (checkPermission is called with 'settings:update')", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)

      await adjustPenaltyMultiplierAction("loan-1", "0.05")

      expect(mockCheckPermission).toHaveBeenCalledWith(
        fakeSession,
        "settings:update",
        "Only admins can adjust penalty rates",
      )
    })

    it("rejects unauthenticated users", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await adjustPenaltyMultiplierAction("loan-1", "0.05")
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("rejects unassigned role", async () => {
      mockGetSession.mockResolvedValue(lowRoleSession)
      const result = await adjustPenaltyMultiplierAction("loan-1", "0.05")
      expect(result).toEqual({ error: "Only admins can adjust penalty rates" })
    })

    it("rejects loan officers (settings:update is admin-only, NOT loan:update)", async () => {
      mockGetSession.mockResolvedValue(loanOfficerSession)
      const result = await adjustPenaltyMultiplierAction("loan-1", "0.05")
      expect(result).toEqual({ error: "Only admins can adjust penalty rates" })
    })

    it("rejects supervisors (settings:update is admin-only)", async () => {
      mockGetSession.mockResolvedValue(supervisorSession)
      const result = await adjustPenaltyMultiplierAction("loan-1", "0.05")
      expect(result).toEqual({ error: "Only admins can adjust penalty rates" })
    })

    it("allows admins (who have settings:update)", async () => {
      mockGetSession.mockResolvedValue(fakeSession) // admin role
      const result = await adjustPenaltyMultiplierAction("loan-1", "0.05")
      expect(result).not.toEqual({ error: "Only admins can adjust penalty rates" })
      expect(result).not.toEqual({ error: "Forbidden" })
      expect(result).not.toEqual({ error: "Unauthorized" })
    })
  })

  // ==========================================================================
  // Bug 3: getSettingsAction had no permission check
  // ==========================================================================
  describe("getSettingsAction authorization", () => {
    it("requires settings:read permission (checkPermission is called with 'settings:read')", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)

      await getSettingsAction()

      expect(mockCheckPermission).toHaveBeenCalledWith(
        fakeSession,
        "settings:read",
        undefined,
      )
    })

    it("rejects unauthenticated users", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await getSettingsAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("rejects unassigned role (no settings:read permission)", async () => {
      mockGetSession.mockResolvedValue(lowRoleSession)
      const result = await getSettingsAction()
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("rejects loan officers (settings:read is admin-only)", async () => {
      mockGetSession.mockResolvedValue(loanOfficerSession)
      const result = await getSettingsAction()
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("rejects supervisors (settings:read is admin-only)", async () => {
      mockGetSession.mockResolvedValue(supervisorSession)
      const result = await getSettingsAction()
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("allows admins (who have settings:read)", async () => {
      mockGetSession.mockResolvedValue(fakeSession) // admin role
      const result = await getSettingsAction()
      expect(result).not.toEqual({ error: "Forbidden" })
      expect(result).not.toEqual({ error: "Unauthorized" })
    })
  })

  // ==========================================================================
  // Cross-cutting: verify the permission catalog assigns correctly
  // ==========================================================================
  describe("permission catalog sanity checks", () => {
    it("unassigned role has zero permissions", () => {
      const perms = getPermissionsForRole("unassigned")
      expect(perms.size).toBe(0)
    })

    it("loanOfficer has payment:create but NOT settings:update", () => {
      const perms = getPermissionsForRole("loanOfficer")
      expect(perms.has("payment:create")).toBe(true)
      expect(perms.has("settings:update")).toBe(false)
      expect(perms.has("settings:read")).toBe(false)
    })

    it("supervisor has payment:create but NOT settings:update", () => {
      const perms = getPermissionsForRole("supervisor")
      expect(perms.has("payment:create")).toBe(true)
      expect(perms.has("settings:update")).toBe(false)
      expect(perms.has("settings:read")).toBe(false)
    })

    it("admin has payment:create AND settings:update AND settings:read", () => {
      const perms = getPermissionsForRole("admin")
      expect(perms.has("payment:create")).toBe(true)
      expect(perms.has("settings:update")).toBe(true)
      expect(perms.has("settings:read")).toBe(true)
    })

    it("superAdmin inherits all admin permissions including settings:update", () => {
      const perms = getPermissionsForRole("superAdmin")
      expect(perms.has("payment:create")).toBe(true)
      expect(perms.has("settings:update")).toBe(true)
      expect(perms.has("settings:read")).toBe(true)
    })
  })
})
