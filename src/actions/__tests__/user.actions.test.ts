import { describe, it, expect, vi, beforeEach } from "vitest"
import type { UserRole, Permission } from "@/types"
import { getPermissionsForRole } from "@/lib/permissions"

// ---------- Mocks ----------

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
  getUserRole: vi.fn((session: { user: { role?: string | null } }): UserRole => {
    return (session.user.role ?? "unassigned") as UserRole
  }),
  getEffectivePermissions: vi.fn(async (_userId: string, role: UserRole): Promise<Set<Permission>> => {
    return getPermissionsForRole(role)
  }),
  invalidateUserPermissions: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getUser: vi.fn(),
      setRole: vi.fn(),
      revokeUserSessions: vi.fn(),
    },
  },
}))

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

vi.mock("@/services/ip-allowlist.service", () => ({
  clearAllowlistForUser: vi.fn().mockResolvedValue(undefined),
}))

// ---------- Imports ----------

import { getSession } from "@/lib/action-utils"
import { auth } from "@/lib/auth"
import { clearAllowlistForUser } from "@/services/ip-allowlist.service"
import { assignRole, getEffectivePermissionsAction } from "../user.actions"
import { fakeSession, lowRoleSession, superAdminSession, supervisorSession, loanOfficerSession } from "./test-utils"
import type { Equals, Expect } from "@/test-utils/type-assert"

// ---------- Type snapshots (protect the action→service refactor) ----------
export type UserActionTypeSnapshots = [
  Expect<
    Equals<
      Awaited<ReturnType<typeof assignRole>>,
      { data: { role: UserRole } } | { error: string }
    >
  >,
  Expect<Equals<Awaited<ReturnType<typeof getEffectivePermissionsAction>>, string[]>>,
]

const mockGetSession = vi.mocked(getSession)
const mockGetUser = vi.mocked(auth.api.getUser)
const mockSetRole = vi.mocked(auth.api.setRole)
const mockRevokeUserSessions = vi.mocked(auth.api.revokeUserSessions)
const mockClearAllowlistForUser = vi.mocked(clearAllowlistForUser)

// Typed mock helpers — avoid `as any` while shaping partial fixtures.
type GetUserResult = Awaited<ReturnType<typeof auth.api.getUser>>
const userWithRole = (role: UserRole | null): GetUserResult =>
  ({ role }) as unknown as GetUserResult
const resolvedVoid = <T>(): T => undefined as unknown as T

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
    const result = await assignRole({ userId: "u2", role: "godMode" as UserRole })
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
  it("loanOfficer cannot assign unassigned role (no permission mapping)", async () => {
    mockGetSession.mockResolvedValue(loanOfficerSession) // level 1
    const result = await assignRole({ userId: "u9", role: "unassigned" })
    expect(result).toEqual({ error: "Cannot assign this role" })
  })

  it("supervisor cannot assign unassigned role (no permission mapping)", async () => {
    mockGetSession.mockResolvedValue(supervisorSession) // level 2
    const result = await assignRole({ userId: "u9", role: "unassigned" })
    expect(result).toEqual({ error: "Cannot assign this role" })
  })

  it("loanOfficer cannot assign loanOfficer (insufficient permissions)", async () => {
    // loanOfficer (level 1) trying to assign loanOfficer (level 1) → "at or above"
    mockGetSession.mockResolvedValue(loanOfficerSession)
    const result = await assignRole({ userId: "u9", role: "loanOfficer" })
    expect(result).toEqual({ error: "Cannot assign role at or above your own level" })
  })

  it("supervisor can assign loanOfficer (has role:assign-loan-officer permission)", async () => {
    mockGetSession.mockResolvedValue(supervisorSession)
    mockGetUser.mockResolvedValue(userWithRole("unassigned"))
    mockSetRole.mockResolvedValue(resolvedVoid())
    const result = await assignRole({ userId: "u9", role: "loanOfficer" })
    expect(result).toEqual({ data: { role: "loanOfficer" } })
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
    mockGetUser.mockResolvedValue(userWithRole("admin"))
    const result = await assignRole({ userId: "u9", role: "loanOfficer" })
    expect(result).toEqual({ error: "Cannot modify a user at or above your own role level" })
  })

  it("admin cannot modify a superAdmin user", async () => {
    mockGetSession.mockResolvedValue(fakeSession) // admin level 3
    mockGetUser.mockResolvedValue(userWithRole("superAdmin"))
    const result = await assignRole({ userId: "u9", role: "loanOfficer" })
    expect(result).toEqual({ error: "Cannot modify a user at or above your own role level" })
  })

  // ===== Successful role assignment =====
  it("admin assigns loanOfficer to an unassigned user", async () => {
    mockGetSession.mockResolvedValue(fakeSession) // admin level 3
    mockGetUser.mockResolvedValue(userWithRole("unassigned"))
    mockSetRole.mockResolvedValue(resolvedVoid())

    const result = await assignRole({ userId: "u9", role: "loanOfficer" })

    expect(result).toEqual({ data: { role: "loanOfficer" } })
    expect(mockSetRole).toHaveBeenCalledWith({
      body: { userId: "u9", role: "loanOfficer" },
      headers: expect.anything(),
    })
  })

  it("superAdmin assigns admin to a supervisor", async () => {
    mockGetSession.mockResolvedValue(superAdminSession) // superAdmin level 4
    mockGetUser.mockResolvedValue(userWithRole("supervisor"))
    mockSetRole.mockResolvedValue(resolvedVoid())

    const result = await assignRole({ userId: "u9", role: "admin" })

    expect(result).toEqual({ data: { role: "admin" } })
    expect(mockSetRole).toHaveBeenCalledWith({
      body: { userId: "u9", role: "admin" },
      headers: expect.anything(),
    })
  })

  it("admin assigns supervisor to a loanOfficer", async () => {
    mockGetSession.mockResolvedValue(fakeSession) // admin level 3
    mockGetUser.mockResolvedValue(userWithRole("loanOfficer"))
    mockSetRole.mockResolvedValue(resolvedVoid())

    const result = await assignRole({ userId: "u9", role: "supervisor" })

    expect(result).toEqual({ data: { role: "supervisor" } })
  })

  // ===== Error handling =====
  it("returns error when auth API fails", async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockGetUser.mockResolvedValue(userWithRole("unassigned"))
    mockSetRole.mockRejectedValue(new Error("Network error"))

    const result = await assignRole({ userId: "u9", role: "loanOfficer" })

    expect(result).toEqual({ error: "Failed to update role" })
  })

  it("handles target user with null role as unassigned", async () => {
    mockGetSession.mockResolvedValue(fakeSession) // admin level 3
    mockGetUser.mockResolvedValue(userWithRole(null))
    mockSetRole.mockResolvedValue(resolvedVoid())

    const result = await assignRole({ userId: "u9", role: "loanOfficer" })

    expect(result).toEqual({ data: { role: "loanOfficer" } })
  })

  // ===== Session revocation =====
  it("revokes target user sessions on successful role change", async () => {
    mockGetSession.mockResolvedValue(fakeSession) // admin level 3
    mockGetUser.mockResolvedValue(userWithRole("unassigned"))
    mockSetRole.mockResolvedValue(resolvedVoid())
    mockRevokeUserSessions.mockResolvedValue(resolvedVoid())

    const result = await assignRole({ userId: "u9", role: "loanOfficer" })

    expect(result).toEqual({ data: { role: "loanOfficer" } })
    expect(mockRevokeUserSessions).toHaveBeenCalledWith({
      body: { userId: "u9" },
      headers: expect.anything(),
    })
  })

  // ===== IP allowlist clearing on demotion =====
  it("clears the target's IP allowlist when demoting an admin to a non-admin role", async () => {
    mockGetSession.mockResolvedValue(superAdminSession) // level 4
    mockGetUser.mockResolvedValue(userWithRole("admin")) // was admin
    mockSetRole.mockResolvedValue(resolvedVoid())

    const result = await assignRole({ userId: "u9", role: "loanOfficer" })

    expect(result).toEqual({ data: { role: "loanOfficer" } })
    expect(mockClearAllowlistForUser).toHaveBeenCalledWith("u9")
  })

  it("does not clear the IP allowlist when assigning to a still-admin role", async () => {
    mockGetSession.mockResolvedValue(superAdminSession) // level 4
    mockGetUser.mockResolvedValue(userWithRole("supervisor")) // not admin before
    mockSetRole.mockResolvedValue(resolvedVoid())

    const result = await assignRole({ userId: "u9", role: "admin" })

    expect(result).toEqual({ data: { role: "admin" } })
    expect(mockClearAllowlistForUser).not.toHaveBeenCalled()
  })

  it("succeeds even if clearing the IP allowlist fails on demotion", async () => {
    mockGetSession.mockResolvedValue(superAdminSession)
    mockGetUser.mockResolvedValue(userWithRole("admin"))
    mockSetRole.mockResolvedValue(resolvedVoid())
    mockClearAllowlistForUser.mockRejectedValueOnce(new Error("db down"))
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const result = await assignRole({ userId: "u9", role: "loanOfficer" })

    expect(result).toEqual({ data: { role: "loanOfficer" } })
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it("does not revoke sessions when role change fails", async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockGetUser.mockResolvedValue(userWithRole("unassigned"))
    mockSetRole.mockRejectedValue(new Error("setRole failed"))

    const result = await assignRole({ userId: "u9", role: "loanOfficer" })

    expect(result).toEqual({ error: "Failed to update role" })
    expect(mockRevokeUserSessions).not.toHaveBeenCalled()
  })

  it("succeeds even if session revocation fails", async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockGetUser.mockResolvedValue(userWithRole("unassigned"))
    mockSetRole.mockResolvedValue(resolvedVoid())
    mockRevokeUserSessions.mockRejectedValue(new Error("revoke failed"))
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const result = await assignRole({ userId: "u9", role: "loanOfficer" })

    expect(result).toEqual({ data: { role: "loanOfficer" } })
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
