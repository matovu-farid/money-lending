import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements, adminAc } from "better-auth/plugins/admin/access"
import type { Permission, UserRole } from "@/types/common"

// ─── better-auth access control (kept for plugin compatibility) ───

const statement = {
  ...defaultStatements,
  loan: ["create", "read", "update", "delete"],
  customer: ["create", "read", "update"],
  payment: ["create", "read", "update", "delete"],
  role: ["assign-loan-officer", "assign-supervisor", "assign-admin", "assign-super-admin"],
  settings: ["read", "update"],
  rateChangeRequest: ["create", "review"],
} as const

export const ac = createAccessControl(statement)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const unassignedRole = ac.newRole({} as any)

export const loanOfficerRole = ac.newRole({
  loan: ["create", "read", "update", "delete"],
  customer: ["create", "read", "update"],
  payment: ["create", "read", "update", "delete"],
  rateChangeRequest: ["create"],
})

export const supervisorRole = ac.newRole({
  ...loanOfficerRole.statements,
  role: ["assign-loan-officer"],
  rateChangeRequest: ["create", "review"],
})

export const adminRole = ac.newRole({
  ...supervisorRole.statements,
  role: ["assign-loan-officer", "assign-supervisor"],
  settings: ["read", "update"],
  ...adminAc.statements,
})

export const superAdminRole = ac.newRole({
  ...adminRole.statements,
  role: ["assign-loan-officer", "assign-supervisor", "assign-admin", "assign-super-admin"],
})

// ─── Granular permission catalog ───

export const PERMISSIONS: readonly Permission[] = [
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
  "reports:read", "reports:financial",
  "settings:read", "settings:update",
  "user:list", "user:ban", "user:impersonate", "user:invite",
  "session:list", "session:revoke", "session:delete",
  // delegation
  "delegation:create", "delegation:revoke", "delegation:read",
  // activity monitoring
  "activity:read",
  // roles
  "role:assign-loan-officer", "role:assign-supervisor", "role:assign-admin", "role:assign-super-admin",
] as const

// ─── Role → Permission mappings ───

const loanOfficerPerms: Permission[] = [
  "loan:create", "loan:read", "loan:update",
  "customer:create", "customer:read", "customer:update",
  "payment:create", "payment:read", "payment:update", "payment:delete",
  "expense:create", "expense:read",
  "income:create", "income:read",
  "rate-change:create",
  "reports:read",
]

const supervisorExtras: Permission[] = [
  "fund-transfer:create", "fund-transfer:read",
  "loan:disburse", "loan:rollover", "loan:settle",
  "backdate:beyond-3-days",
  "rate-change:approve-standard",
  "dashboard:read",
  "reports:financial",
  "role:assign-loan-officer",
  "payment:edit-any", "payment:delete-any",
  "activity:read",
]

const adminExtras: Permission[] = [
  "rate-change:approve-low",
  "role:assign-supervisor",
  "creditor:read", "creditor:create", "creditor:update",
  "settings:read", "settings:update",
  "user:list", "user:ban", "user:impersonate", "user:invite",
  "session:list", "session:revoke", "session:delete",
  "delegation:create", "delegation:revoke", "delegation:read",
]

const superAdminExtras: Permission[] = [
  "role:assign-admin", "role:assign-super-admin",
]

const loanOfficerSet = new Set<Permission>(loanOfficerPerms)
const supervisorSet = new Set<Permission>([...loanOfficerSet, ...supervisorExtras])
const adminSet = new Set<Permission>([...supervisorSet, ...adminExtras])
const superAdminSet = new Set<Permission>([...adminSet, ...superAdminExtras])

export const ROLE_PERMISSIONS: Record<UserRole, Set<Permission>> = {
  unassigned: new Set<Permission>(),
  loanOfficer: loanOfficerSet,
  supervisor: supervisorSet,
  admin: adminSet,
  superAdmin: superAdminSet,
}

/** Admin operational permissions minus creditor:*, role:*, delegation:* */
export const MANAGING_SUPERVISOR_ELEVATED = new Set<Permission>(
  [...adminSet].filter(
    (p) => !p.startsWith("creditor:") && !p.startsWith("role:") && !p.startsWith("delegation:")
  )
)

export function getPermissionsForRole(role: UserRole): Set<Permission> {
  return ROLE_PERMISSIONS[role] ?? new Set<Permission>()
}
