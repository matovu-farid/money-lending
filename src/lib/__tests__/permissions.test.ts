import { describe, it, expect } from "vitest"
import fc from "fast-check"
import {
  ac,
  unassignedRole,
  loanOfficerRole,
  adminRole,
  superAdminRole,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  MANAGING_SUPERVISOR_ELEVATED,
  getPermissionsForRole,
} from "../permissions"
import type { Permission, UserRole } from "@/types/common"
import { ROLE_LEVELS } from "@/types/common"

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
      "assign-supervisor",
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

// ─── New granular permission catalog tests ───

describe("PERMISSIONS array", () => {
  it("contains all expected permissions", () => {
    const expected: Permission[] = [
      // operations
      "loan:create", "loan:read", "loan:update", "loan:disburse", "loan:rollover", "loan:settle",
      "customer:create", "customer:read", "customer:update",
      "payment:create", "payment:read", "payment:update", "payment:delete", "payment:edit-any", "payment:delete-any",
      "expense:create", "expense:read",
      "income:create", "income:read",
      "fund-transfer:create", "fund-transfer:read",
      // approvals
      "backdate:beyond-3-days",
      "rate-change:create", "rate-change:approve-standard", "rate-change:approve-low",
      // creditors
      "creditor:read", "creditor:create", "creditor:update",
      // admin
      "dashboard:read",
      "reports:read",
      "settings:read", "settings:update",
      "user:list", "user:ban", "user:impersonate",
      "session:list", "session:revoke", "session:delete",
      // delegation
      "delegation:create", "delegation:revoke", "delegation:read",
      // activity monitoring
      "activity:read",
      // roles
      "role:assign-loan-officer", "role:assign-supervisor", "role:assign-admin", "role:assign-super-admin",
    ]
    for (const perm of expected) {
      expect(PERMISSIONS).toContain(perm)
    }
    expect(PERMISSIONS.length).toBe(expected.length)
  })
})

describe("ROLE_PERMISSIONS", () => {
  it("unassigned has empty set", () => {
    expect(ROLE_PERMISSIONS.unassigned.size).toBe(0)
  })

  it("loanOfficer has basic operations", () => {
    const lo = ROLE_PERMISSIONS.loanOfficer
    const expected: Permission[] = [
      "loan:create", "loan:read", "loan:update",
      "customer:create", "customer:read", "customer:update",
      "payment:create", "payment:read", "payment:update", "payment:delete",
      "expense:create", "expense:read",
      "income:create", "income:read",
      "fund-transfer:create", "fund-transfer:read",
      "rate-change:create",
      "reports:read",
    ]
    for (const perm of expected) {
      expect(lo.has(perm)).toBe(true)
    }
    expect(lo.size).toBe(expected.length)
  })

  it("supervisor inherits loanOfficer and adds extras", () => {
    const sup = ROLE_PERMISSIONS.supervisor
    // Should have all loanOfficer perms
    for (const perm of ROLE_PERMISSIONS.loanOfficer) {
      expect(sup.has(perm)).toBe(true)
    }
    // Supervisor extras
    const extras: Permission[] = [
      "loan:disburse", "loan:rollover", "loan:settle",
      "backdate:beyond-3-days",
      "rate-change:approve-standard",
      "dashboard:read",
      "role:assign-loan-officer",
      "creditor:read", "creditor:create", "creditor:update",
      "payment:edit-any", "payment:delete-any",
      "activity:read",
    ]
    for (const perm of extras) {
      expect(sup.has(perm)).toBe(true)
    }
  })

  it("admin inherits supervisor and adds extras", () => {
    const adm = ROLE_PERMISSIONS.admin
    // Should have all supervisor perms
    for (const perm of ROLE_PERMISSIONS.supervisor) {
      expect(adm.has(perm)).toBe(true)
    }
    // Admin extras
    const extras: Permission[] = [
      "rate-change:approve-low",
      "role:assign-supervisor",
      "settings:read", "settings:update",
      "user:list", "user:ban", "user:impersonate",
      "session:list", "session:revoke", "session:delete",
      "delegation:create", "delegation:revoke", "delegation:read",
    ]
    for (const perm of extras) {
      expect(adm.has(perm)).toBe(true)
    }
  })

  it("superAdmin has everything including role escalation", () => {
    const sa = ROLE_PERMISSIONS.superAdmin
    // Should have all admin perms
    for (const perm of ROLE_PERMISSIONS.admin) {
      expect(sa.has(perm)).toBe(true)
    }
    expect(sa.has("role:assign-admin")).toBe(true)
    expect(sa.has("role:assign-super-admin")).toBe(true)
    // superAdmin should have ALL permissions
    for (const perm of PERMISSIONS) {
      expect(sa.has(perm)).toBe(true)
    }
  })
})

describe("MANAGING_SUPERVISOR_ELEVATED", () => {
  it("contains admin operational permissions", () => {
    // Should include things like loan:disburse, settings:*, user:*, session:*, etc.
    expect(MANAGING_SUPERVISOR_ELEVATED.has("loan:disburse")).toBe(true)
    expect(MANAGING_SUPERVISOR_ELEVATED.has("settings:read")).toBe(true)
    expect(MANAGING_SUPERVISOR_ELEVATED.has("user:list")).toBe(true)
    expect(MANAGING_SUPERVISOR_ELEVATED.has("session:list")).toBe(true)
    expect(MANAGING_SUPERVISOR_ELEVATED.has("rate-change:approve-low")).toBe(true)
  })

  it("excludes creditor:* permissions", () => {
    for (const perm of MANAGING_SUPERVISOR_ELEVATED) {
      expect(perm.startsWith("creditor:")).toBe(false)
    }
  })

  it("excludes role:* permissions", () => {
    for (const perm of MANAGING_SUPERVISOR_ELEVATED) {
      expect(perm.startsWith("role:")).toBe(false)
    }
  })

  it("excludes delegation:* permissions", () => {
    for (const perm of MANAGING_SUPERVISOR_ELEVATED) {
      expect(perm.startsWith("delegation:")).toBe(false)
    }
  })
})

describe("getPermissionsForRole", () => {
  it("returns correct set for each known role", () => {
    expect(getPermissionsForRole("unassigned")).toEqual(ROLE_PERMISSIONS.unassigned)
    expect(getPermissionsForRole("loanOfficer")).toEqual(ROLE_PERMISSIONS.loanOfficer)
    expect(getPermissionsForRole("supervisor")).toEqual(ROLE_PERMISSIONS.supervisor)
    expect(getPermissionsForRole("admin")).toEqual(ROLE_PERMISSIONS.admin)
    expect(getPermissionsForRole("superAdmin")).toEqual(ROLE_PERMISSIONS.superAdmin)
  })

  it("returns empty set for unknown role", () => {
    const result = getPermissionsForRole("bogusRole" as any)
    expect(result.size).toBe(0)
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

describe("Property-Based: Permission Hierarchy", () => {
  const ALL_ROLES: UserRole[] = ["unassigned", "loanOfficer", "supervisor", "admin", "superAdmin"]
  const ROLE_ORDER = ALL_ROLES // index = privilege level

  // Arbitrary: random role
  const arbRole = fc.constantFrom(...ALL_ROLES)

  // Arbitrary: random pair of roles where first has lower privilege
  const arbRolePair = fc.tuple(
    fc.integer({ min: 0, max: ALL_ROLES.length - 2 }),
    fc.integer({ min: 1, max: ALL_ROLES.length - 1 }),
  ).filter(([lo, hi]) => lo < hi)
   .map(([lo, hi]) => [ROLE_ORDER[lo], ROLE_ORDER[hi]] as [UserRole, UserRole])

  // Arbitrary: random permission from the catalog
  const arbPermission = fc.constantFrom(...PERMISSIONS)

  it("role monotonicity: higher role is strict superset of lower role", () => {
    fc.assert(
      fc.property(arbRolePair, ([lowerRole, higherRole]) => {
        const lowerPerms = getPermissionsForRole(lowerRole)
        const higherPerms = getPermissionsForRole(higherRole)
        // Every permission in lowerPerms must be in higherPerms
        for (const perm of lowerPerms) {
          if (!higherPerms.has(perm)) return false
        }
        // Higher role must have strictly more permissions (except unassigned→unassigned edge)
        if (lowerRole !== "unassigned" || higherRole !== "unassigned") {
          if (higherPerms.size <= lowerPerms.size) return false
        }
        return true
      }),
      { numRuns: 200 }
    )
  })

  it("unassigned has zero permissions", () => {
    expect(getPermissionsForRole("unassigned").size).toBe(0)
  })

  it("superAdmin has every permission in the catalog", () => {
    fc.assert(
      fc.property(arbPermission, (perm) => {
        return getPermissionsForRole("superAdmin").has(perm)
      }),
      { numRuns: PERMISSIONS.length } // test every permission
    )
  })

  it("every permission in catalog is assigned to at least one role", () => {
    fc.assert(
      fc.property(arbPermission, (perm) => {
        return ALL_ROLES.some((role) => getPermissionsForRole(role).has(perm))
      }),
      { numRuns: PERMISSIONS.length }
    )
  })

  it("no role has permissions outside the catalog", () => {
    fc.assert(
      fc.property(arbRole, (role) => {
        const perms = getPermissionsForRole(role)
        for (const perm of perms) {
          if (!PERMISSIONS.includes(perm)) return false
        }
        return true
      }),
      { numRuns: 50 }
    )
  })

  it("getPermissionsForRole is deterministic", () => {
    fc.assert(
      fc.property(arbRole, (role) => {
        const a = getPermissionsForRole(role)
        const b = getPermissionsForRole(role)
        return a === b // same Set reference (not just equal)
      }),
      { numRuns: 50 }
    )
  })

  it("MANAGING_SUPERVISOR_ELEVATED is a subset of admin permissions", () => {
    const adminPerms = getPermissionsForRole("admin")
    for (const perm of MANAGING_SUPERVISOR_ELEVATED) {
      expect(adminPerms.has(perm)).toBe(true)
    }
  })

  it("MANAGING_SUPERVISOR_ELEVATED excludes creditor:*, role:*, delegation:*", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Array.from(MANAGING_SUPERVISOR_ELEVATED)),
        (perm) => {
          return !perm.startsWith("creditor:") && !perm.startsWith("role:") && !perm.startsWith("delegation:")
        }
      ),
      { numRuns: MANAGING_SUPERVISOR_ELEVATED.size }
    )
  })

  it("supervisor + MANAGING_SUPERVISOR_ELEVATED covers all admin perms except creditor/role/delegation", () => {
    const supervisorPerms = getPermissionsForRole("supervisor")
    const combined = new Set([...supervisorPerms, ...MANAGING_SUPERVISOR_ELEVATED])
    const adminPerms = getPermissionsForRole("admin")

    for (const perm of adminPerms) {
      if (perm.startsWith("creditor:") || perm.startsWith("role:") || perm.startsWith("delegation:")) continue
      expect(combined.has(perm)).toBe(true)
    }
  })

  it("permission set sizes are strictly increasing across role hierarchy", () => {
    const sizes = ALL_ROLES.map((role) => getPermissionsForRole(role).size)
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1])
    }
  })

  it("unknown role returns empty set", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !ALL_ROLES.includes(s as UserRole) && s !== "__proto__" && s !== "constructor" && s !== "toString" && s !== "valueOf" && s !== "hasOwnProperty"),
        (bogus) => {
          return getPermissionsForRole(bogus as UserRole).size === 0
        }
      ),
      { numRuns: 100 }
    )
  })
})
