import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------- Mocks ----------

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getUser: vi.fn(),
      setRole: vi.fn(),
    },
  },
}))

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

// ---------- Imports ----------

import { getSession } from "@/lib/action-utils"
import { auth } from "@/lib/auth"
import { assignRole } from "../user.actions"
import { fakeSession, lowRoleSession, superAdminSession, supervisorSession, loanOfficerSession } from "./test-utils"

const mockGetSession = vi.mocked(getSession)
const mockGetUser = vi.mocked(auth.api.getUser)
const mockSetRole = vi.mocked(auth.api.setRole)

// ---------- Tests ----------

describe("User Actions — assignRole", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===== Authentication =====
  it("returns error when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await assignRole({ userId: "u2", role: "loanOfficer" })
    expect(result).toEqual({ error: "Unauthorized" })
  })

  // ===== Input validation =====
  it("returns error when userId is missing", async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    const result = await assignRole({ userId: "", role: "loanOfficer" })
    expect(result).toEqual({ error: "User ID is required" })
  })

  it("returns error for invalid role", async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    const result = await assignRole({ userId: "u2", role: "godMode" as any })
    expect(result).toEqual({ error: "Invalid role" })
  })

  // ===== Self-modification prevention =====
  it("prevents users from changing their own role", async () => {
    mockGetSession.mockResolvedValue(fakeSession) // fakeSession.user.id = "u1"
    const result = await assignRole({ userId: "u1", role: "loanOfficer" })
    expect(result).toEqual({ error: "Cannot change your own role" })
  })

  // ===== Privilege escalation prevention =====
  it("admin cannot assign admin role (at or above own level)", async () => {
    mockGetSession.mockResolvedValue(fakeSession) // admin level 3
    const result = await assignRole({ userId: "u2", role: "admin" })
    expect(result).toEqual({ error: "Cannot assign role at or above your own level" })
  })

  it("admin cannot assign superAdmin role (above own level)", async () => {
    mockGetSession.mockResolvedValue(fakeSession) // admin level 3
    const result = await assignRole({ userId: "u2", role: "superAdmin" })
    expect(result).toEqual({ error: "Cannot assign role at or above your own level" })
  })

  // ===== Insufficient permissions =====
  it("loanOfficer cannot assign roles (below admin level)", async () => {
    mockGetSession.mockResolvedValue(loanOfficerSession) // level 1
    const result = await assignRole({ userId: "u9", role: "unassigned" })
    expect(result).toEqual({ error: "Insufficient permissions to assign roles" })
  })

  it("supervisor cannot assign roles (below admin level)", async () => {
    mockGetSession.mockResolvedValue(supervisorSession) // level 2
    const result = await assignRole({ userId: "u9", role: "unassigned" })
    expect(result).toEqual({ error: "Insufficient permissions to assign roles" })
  })

  it("unassigned user cannot assign roles (hits level check first)", async () => {
    // unassigned (level 0) assigning "unassigned" (level 0) → "at or above"
    mockGetSession.mockResolvedValue(lowRoleSession) // level 0
    const result = await assignRole({ userId: "u9", role: "unassigned" })
    expect(result).toEqual({ error: "Cannot assign role at or above your own level" })
  })

  it("unassigned user cannot assign loanOfficer (hits both checks)", async () => {
    // unassigned (level 0) assigning "loanOfficer" (level 1) → "at or above"
    mockGetSession.mockResolvedValue(lowRoleSession) // level 0
    const result = await assignRole({ userId: "u9", role: "loanOfficer" })
    expect(result).toEqual({ error: "Cannot assign role at or above your own level" })
  })

  // ===== Target user role hierarchy enforcement =====
  it("admin cannot modify a user at or above their own level", async () => {
    mockGetSession.mockResolvedValue(fakeSession) // admin level 3
    mockGetUser.mockResolvedValue({ role: "admin" } as any)
    const result = await assignRole({ userId: "u9", role: "loanOfficer" })
    expect(result).toEqual({ error: "Cannot modify a user at or above your own role level" })
  })

  it("admin cannot modify a superAdmin user", async () => {
    mockGetSession.mockResolvedValue(fakeSession) // admin level 3
    mockGetUser.mockResolvedValue({ role: "superAdmin" } as any)
    const result = await assignRole({ userId: "u9", role: "loanOfficer" })
    expect(result).toEqual({ error: "Cannot modify a user at or above your own role level" })
  })

  // ===== Successful role assignment =====
  it("admin assigns loanOfficer to an unassigned user", async () => {
    mockGetSession.mockResolvedValue(fakeSession) // admin level 3
    mockGetUser.mockResolvedValue({ role: "unassigned" } as any)
    mockSetRole.mockResolvedValue(undefined as any)

    const result = await assignRole({ userId: "u9", role: "loanOfficer" })

    expect(result).toEqual({ data: { role: "loanOfficer" } })
    expect(mockSetRole).toHaveBeenCalledWith({
      body: { userId: "u9", role: "loanOfficer" },
      headers: expect.anything(),
    })
  })

  it("superAdmin assigns admin to a supervisor", async () => {
    mockGetSession.mockResolvedValue(superAdminSession) // superAdmin level 4
    mockGetUser.mockResolvedValue({ role: "supervisor" } as any)
    mockSetRole.mockResolvedValue(undefined as any)

    const result = await assignRole({ userId: "u9", role: "admin" })

    expect(result).toEqual({ data: { role: "admin" } })
    expect(mockSetRole).toHaveBeenCalledWith({
      body: { userId: "u9", role: "admin" },
      headers: expect.anything(),
    })
  })

  it("admin assigns supervisor to a loanOfficer", async () => {
    mockGetSession.mockResolvedValue(fakeSession) // admin level 3
    mockGetUser.mockResolvedValue({ role: "loanOfficer" } as any)
    mockSetRole.mockResolvedValue(undefined as any)

    const result = await assignRole({ userId: "u9", role: "supervisor" })

    expect(result).toEqual({ data: { role: "supervisor" } })
  })

  // ===== Error handling =====
  it("returns error when auth API fails", async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockGetUser.mockResolvedValue({ role: "unassigned" } as any)
    mockSetRole.mockRejectedValue(new Error("Network error"))

    const result = await assignRole({ userId: "u9", role: "loanOfficer" })

    expect(result).toEqual({ error: "Failed to update role" })
  })

  it("handles target user with null role as unassigned", async () => {
    mockGetSession.mockResolvedValue(fakeSession) // admin level 3
    mockGetUser.mockResolvedValue({ role: null } as any)
    mockSetRole.mockResolvedValue(undefined as any)

    const result = await assignRole({ userId: "u9", role: "loanOfficer" })

    expect(result).toEqual({ data: { role: "loanOfficer" } })
  })
})
