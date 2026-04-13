import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------- Mocks ----------

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
  requireRole: vi.fn(),
  checkPermission: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/db", () => {
  const mockFrom = vi.fn().mockResolvedValue([{ key: "default_interest_rate", value: "0.10" }])
  const mockReturning = vi.fn().mockResolvedValue([{ key: "default_interest_rate", value: "0.12" }])
  const mockOnConflictDoUpdate = vi.fn().mockReturnValue({ returning: mockReturning })
  const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate })
  return {
    db: {
      select: vi.fn().mockReturnValue({ from: mockFrom }),
      insert: vi.fn().mockReturnValue({ values: mockValues }),
    },
  }
})

vi.mock("@/lib/db/schema/settings", () => ({
  systemSettings: { key: "key", value: "value", updatedBy: "updatedBy", updatedAt: "updatedAt" },
}))

// ---------- Imports ----------

import { getSession, requireRole, checkPermission } from "@/lib/action-utils"
import { db } from "@/lib/db"

import { getSettingsAction, updateSettingAction } from "../settings.actions"

import { superAdminSession } from "./test-utils"
const mockGetSession = vi.mocked(getSession)
const mockRequireRole = vi.mocked(requireRole)
const mockCheckPermission = vi.mocked(checkPermission)

const fakeSession = superAdminSession

// ---------- Tests ----------

describe("Settings Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===== getSettingsAction =====
  describe("getSettingsAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await getSettingsAction()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns settings on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const result = await getSettingsAction()
      expect(result).toHaveProperty("data")
    })

    it("returns error when db fails", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockRejectedValueOnce(new Error("db fail")),
      } as any)
      const result = await getSettingsAction()
      expect(result).toEqual({ error: "Failed to load settings" })
    })
  })

  // ===== updateSettingAction =====
  describe("updateSettingAction", () => {
    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await updateSettingAction({ key: "default_interest_rate", value: "0.12" })
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns error when role is insufficient", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue("Only Super Admin can edit system settings")
      const result = await updateSettingAction({ key: "default_interest_rate", value: "0.12" })
      expect(result).toEqual({ error: "Only Super Admin can edit system settings" })
    })

    it("returns error for invalid setting key", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const result = await updateSettingAction({ key: "bogus_key", value: "0.12" })
      expect(result).toHaveProperty("error")
      expect((result as any).error).toContain("Invalid setting key")
    })

    it("returns error for empty value", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const result = await updateSettingAction({ key: "default_interest_rate", value: "" })
      expect(result).toEqual({ error: "Setting value is required" })
    })

    it("updates setting on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockCheckPermission.mockResolvedValue(null)
      const result = await updateSettingAction({ key: "default_interest_rate", value: "0.12" })
      expect(result).toHaveProperty("data")
    })
  })
})
