import { describe, it, expect } from "vitest"
import {
  ac,
  unassignedRole,
  loanOfficerRole,
  adminRole,
  superAdminRole,
} from "../permissions"

describe("ac (access control)", () => {
  it("exposes the full statement definitions", () => {
    expect(ac.statements).toHaveProperty("user")
    expect(ac.statements).toHaveProperty("session")
    expect(ac.statements).toHaveProperty("loan")
    expect(ac.statements).toHaveProperty("customer")
    expect(ac.statements).toHaveProperty("payment")
    expect(ac.statements).toHaveProperty("role")
    expect(ac.statements).toHaveProperty("settings")
  })

  it("includes default better-auth user actions", () => {
    expect(ac.statements.user).toContain("create")
    expect(ac.statements.user).toContain("list")
    expect(ac.statements.user).toContain("set-role")
    expect(ac.statements.user).toContain("ban")
    expect(ac.statements.user).toContain("impersonate")
    expect(ac.statements.user).toContain("delete")
  })

  it("includes default better-auth session actions", () => {
    expect(ac.statements.session).toContain("list")
    expect(ac.statements.session).toContain("revoke")
    expect(ac.statements.session).toContain("delete")
  })

  it("defines custom loan actions", () => {
    expect(ac.statements.loan).toEqual(["create", "read", "update", "delete"])
  })

  it("defines custom customer actions", () => {
    expect(ac.statements.customer).toEqual(["create", "read", "update"])
  })

  it("defines custom payment actions", () => {
    expect(ac.statements.payment).toEqual([
      "create",
      "read",
      "update",
      "delete",
    ])
  })

  it("defines role assignment actions", () => {
    expect(ac.statements.role).toEqual([
      "assign-loan-officer",
      "assign-admin",
      "assign-super-admin",
    ])
  })

  it("defines settings actions", () => {
    expect(ac.statements.settings).toEqual(["read", "update"])
  })

  it("can create new roles via newRole", () => {
    const custom = ac.newRole({ loan: ["read"] })
    expect(custom).toHaveProperty("authorize")
    expect(custom).toHaveProperty("statements")
    expect(custom.statements.loan).toEqual(["read"])
  })
})

describe("unassignedRole", () => {
  it("has an authorize method", () => {
    expect(typeof unassignedRole.authorize).toBe("function")
  })

  it("denies loan:create", () => {
    const result = unassignedRole.authorize({ loan: ["create"] })
    expect(result.success).toBe(false)
  })

  it("denies customer:read", () => {
    const result = unassignedRole.authorize({ customer: ["read"] })
    expect(result.success).toBe(false)
  })

  it("denies payment:create", () => {
    const result = unassignedRole.authorize({ payment: ["create"] })
    expect(result.success).toBe(false)
  })

  it("denies role:assign-loan-officer", () => {
    const result = unassignedRole.authorize({ role: ["assign-loan-officer"] })
    expect(result.success).toBe(false)
  })

  it("denies settings:read", () => {
    const result = unassignedRole.authorize({ settings: ["read"] })
    expect(result.success).toBe(false)
  })
})

describe("loanOfficerRole", () => {
  describe("statements", () => {
    it("has loan, customer, and payment resources", () => {
      expect(loanOfficerRole.statements).toHaveProperty("loan")
      expect(loanOfficerRole.statements).toHaveProperty("customer")
      expect(loanOfficerRole.statements).toHaveProperty("payment")
    })

    it("does not have role or settings resources", () => {
      expect(loanOfficerRole.statements).not.toHaveProperty("role")
      expect(loanOfficerRole.statements).not.toHaveProperty("settings")
    })

    it("does not have user or session resources", () => {
      expect(loanOfficerRole.statements).not.toHaveProperty("user")
      expect(loanOfficerRole.statements).not.toHaveProperty("session")
    })
  })

  describe("loan permissions", () => {
    it("allows loan:create", () => {
      const result = loanOfficerRole.authorize({ loan: ["create"] })
      expect(result.success).toBe(true)
    })

    it("allows loan:read", () => {
      const result = loanOfficerRole.authorize({ loan: ["read"] })
      expect(result.success).toBe(true)
    })

    it("allows loan:update", () => {
      const result = loanOfficerRole.authorize({ loan: ["update"] })
      expect(result.success).toBe(true)
    })

    it("allows loan:delete", () => {
      const result = loanOfficerRole.authorize({ loan: ["delete"] })
      expect(result.success).toBe(true)
    })

    it("allows all loan actions together", () => {
      const result = loanOfficerRole.authorize({
        loan: ["create", "read", "update", "delete"],
      })
      expect(result.success).toBe(true)
    })
  })

  describe("customer permissions", () => {
    it("allows customer:create", () => {
      const result = loanOfficerRole.authorize({ customer: ["create"] })
      expect(result.success).toBe(true)
    })

    it("allows customer:read", () => {
      const result = loanOfficerRole.authorize({ customer: ["read"] })
      expect(result.success).toBe(true)
    })

    it("allows customer:update", () => {
      const result = loanOfficerRole.authorize({ customer: ["update"] })
      expect(result.success).toBe(true)
    })
  })

  describe("payment permissions", () => {
    it("allows payment:create", () => {
      const result = loanOfficerRole.authorize({ payment: ["create"] })
      expect(result.success).toBe(true)
    })

    it("allows payment:read", () => {
      const result = loanOfficerRole.authorize({ payment: ["read"] })
      expect(result.success).toBe(true)
    })

    it("allows payment:update", () => {
      const result = loanOfficerRole.authorize({ payment: ["update"] })
      expect(result.success).toBe(true)
    })

    it("allows payment:delete", () => {
      const result = loanOfficerRole.authorize({ payment: ["delete"] })
      expect(result.success).toBe(true)
    })
  })

  describe("denied permissions", () => {
    it("denies role:assign-loan-officer", () => {
      const result = loanOfficerRole.authorize({
        role: ["assign-loan-officer"],
      } as any)
      expect(result.success).toBe(false)
    })

    it("denies settings:read", () => {
      const result = loanOfficerRole.authorize({ settings: ["read"] } as any)
      expect(result.success).toBe(false)
    })

    it("denies settings:update", () => {
      const result = loanOfficerRole.authorize({ settings: ["update"] } as any)
      expect(result.success).toBe(false)
    })

    it("denies user:ban (no user management for officers)", () => {
      const result = loanOfficerRole.authorize({ user: ["ban"] } as any)
      expect(result.success).toBe(false)
    })
  })
})

describe("adminRole", () => {
  describe("statements", () => {
    it("inherits loan officer resources", () => {
      expect(adminRole.statements).toHaveProperty("loan")
      expect(adminRole.statements).toHaveProperty("customer")
      expect(adminRole.statements).toHaveProperty("payment")
    })

    it("has role and settings resources", () => {
      expect(adminRole.statements).toHaveProperty("role")
      expect(adminRole.statements).toHaveProperty("settings")
    })

    it("has user and session resources from adminAc", () => {
      expect(adminRole.statements).toHaveProperty("user")
      expect(adminRole.statements).toHaveProperty("session")
    })
  })

  describe("inherited loan officer permissions", () => {
    it("allows loan:create", () => {
      const result = adminRole.authorize({ loan: ["create"] })
      expect(result.success).toBe(true)
    })

    it("allows loan:delete", () => {
      const result = adminRole.authorize({ loan: ["delete"] })
      expect(result.success).toBe(true)
    })

    it("allows customer:create", () => {
      const result = adminRole.authorize({ customer: ["create"] })
      expect(result.success).toBe(true)
    })

    it("allows payment:create", () => {
      const result = adminRole.authorize({ payment: ["create"] })
      expect(result.success).toBe(true)
    })
  })

  describe("role assignment permissions", () => {
    it("allows role:assign-loan-officer", () => {
      const result = adminRole.authorize({ role: ["assign-loan-officer"] })
      expect(result.success).toBe(true)
    })

    it("denies role:assign-admin", () => {
      const result = adminRole.authorize({ role: ["assign-admin"] })
      expect(result.success).toBe(false)
    })

    it("denies role:assign-super-admin", () => {
      const result = adminRole.authorize({ role: ["assign-super-admin"] })
      expect(result.success).toBe(false)
    })
  })

  describe("settings permissions", () => {
    it("allows settings:read", () => {
      const result = adminRole.authorize({ settings: ["read"] })
      expect(result.success).toBe(true)
    })

    it("allows settings:update", () => {
      const result = adminRole.authorize({ settings: ["update"] })
      expect(result.success).toBe(true)
    })
  })

  describe("user management permissions (from adminAc)", () => {
    it("allows user management actions", () => {
      const result = adminRole.authorize({ user: ["create"] })
      expect(result.success).toBe(true)
    })

    it("allows session management actions", () => {
      const result = adminRole.authorize({ session: ["list"] })
      expect(result.success).toBe(true)
    })

    it("allows user:ban (inherited from adminAc)", () => {
      const result = adminRole.authorize({ user: ["ban"] })
      expect(result.success).toBe(true)
    })
  })
})

describe("superAdminRole", () => {
  describe("statements", () => {
    it("inherits all admin resources", () => {
      expect(superAdminRole.statements).toHaveProperty("loan")
      expect(superAdminRole.statements).toHaveProperty("customer")
      expect(superAdminRole.statements).toHaveProperty("payment")
      expect(superAdminRole.statements).toHaveProperty("role")
      expect(superAdminRole.statements).toHaveProperty("settings")
      expect(superAdminRole.statements).toHaveProperty("user")
      expect(superAdminRole.statements).toHaveProperty("session")
    })
  })

  describe("role assignment — full escalation", () => {
    it("allows role:assign-loan-officer", () => {
      const result = superAdminRole.authorize({
        role: ["assign-loan-officer"],
      })
      expect(result.success).toBe(true)
    })

    it("allows role:assign-admin", () => {
      const result = superAdminRole.authorize({ role: ["assign-admin"] })
      expect(result.success).toBe(true)
    })

    it("allows role:assign-super-admin", () => {
      const result = superAdminRole.authorize({
        role: ["assign-super-admin"],
      })
      expect(result.success).toBe(true)
    })

    it("allows all role actions together", () => {
      const result = superAdminRole.authorize({
        role: ["assign-loan-officer", "assign-admin", "assign-super-admin"],
      })
      expect(result.success).toBe(true)
    })
  })

  describe("inherits all admin permissions", () => {
    it("allows loan operations", () => {
      const result = superAdminRole.authorize({
        loan: ["create", "read", "update", "delete"],
      })
      expect(result.success).toBe(true)
    })

    it("allows customer operations", () => {
      const result = superAdminRole.authorize({
        customer: ["create", "read", "update"],
      })
      expect(result.success).toBe(true)
    })

    it("allows payment operations", () => {
      const result = superAdminRole.authorize({
        payment: ["create", "read", "update", "delete"],
      })
      expect(result.success).toBe(true)
    })

    it("allows settings operations", () => {
      const result = superAdminRole.authorize({
        settings: ["read", "update"],
      })
      expect(result.success).toBe(true)
    })

    it("allows user management", () => {
      const result = superAdminRole.authorize({ user: ["create"] })
      expect(result.success).toBe(true)
    })

    it("allows session management", () => {
      const result = superAdminRole.authorize({ session: ["list"] })
      expect(result.success).toBe(true)
    })
  })
})

describe("role hierarchy — privilege escalation boundaries", () => {
  it("unassigned < loanOfficer: unassigned cannot do what loanOfficer can", () => {
    const allowed = loanOfficerRole.authorize({ loan: ["create"] })
    const denied = unassignedRole.authorize({ loan: ["create"] })
    expect(allowed.success).toBe(true)
    expect(denied.success).toBe(false)
  })

  it("loanOfficer < admin: loanOfficer cannot assign roles", () => {
    const allowed = adminRole.authorize({ role: ["assign-loan-officer"] })
    const denied = loanOfficerRole.authorize({ role: ["assign-loan-officer"] } as any)
    expect(allowed.success).toBe(true)
    expect(denied.success).toBe(false)
  })

  it("loanOfficer < admin: loanOfficer cannot manage settings", () => {
    const allowed = adminRole.authorize({ settings: ["read"] })
    const denied = loanOfficerRole.authorize({ settings: ["read"] } as any)
    expect(allowed.success).toBe(true)
    expect(denied.success).toBe(false)
  })

  it("admin < superAdmin: admin cannot assign admin role", () => {
    const allowed = superAdminRole.authorize({ role: ["assign-admin"] })
    const denied = adminRole.authorize({ role: ["assign-admin"] })
    expect(allowed.success).toBe(true)
    expect(denied.success).toBe(false)
  })

  it("admin < superAdmin: admin cannot assign super-admin role", () => {
    const allowed = superAdminRole.authorize({ role: ["assign-super-admin"] })
    const denied = adminRole.authorize({ role: ["assign-super-admin"] })
    expect(allowed.success).toBe(true)
    expect(denied.success).toBe(false)
  })
})

describe("authorize — connector modes", () => {
  it("AND connector requires all requested actions (default)", () => {
    const result = loanOfficerRole.authorize({
      loan: ["create", "read", "update", "delete"],
    })
    expect(result.success).toBe(true)
  })

  it("OR connector on multi-resource request", () => {
    const result = loanOfficerRole.authorize(
      { loan: ["create"], customer: ["read"] },
      "OR"
    )
    expect(result.success).toBe(true)
  })

  it("AND connector on multi-resource request succeeds when all present", () => {
    const result = loanOfficerRole.authorize(
      { loan: ["create"], customer: ["read"] },
      "AND"
    )
    expect(result.success).toBe(true)
  })

  it("OR connector: succeeds when one resource is allowed and one is denied", () => {
    // loanOfficer can access loan but NOT settings
    const result = loanOfficerRole.authorize(
      { loan: ["create"], settings: ["read"] } as any,
      "OR"
    )
    expect(result.success).toBe(true)
  })

  it("AND connector: fails when one resource is allowed but another is denied", () => {
    // loanOfficer can access loan but NOT settings
    const result = loanOfficerRole.authorize(
      { loan: ["create"], settings: ["read"] } as any,
      "AND"
    )
    expect(result.success).toBe(false)
  })

  it("failed authorization returns an error string", () => {
    const result = loanOfficerRole.authorize({ settings: ["read"] } as any)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(typeof result.error).toBe("string")
      expect(result.error.length).toBeGreaterThan(0)
    }
  })
})
