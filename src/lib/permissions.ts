import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements, adminAc } from "better-auth/plugins/admin/access"

const statement = {
  ...defaultStatements,
  loan: ["create", "read", "update"],
  customer: ["create", "read", "update"],
  payment: ["create", "read", "update", "delete"],
  role: ["assign-loan-officer", "assign-admin", "assign-super-admin"],
  settings: ["read", "update"],
} as const

export const ac = createAccessControl(statement)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const unassignedRole = ac.newRole({} as any)

export const loanOfficerRole = ac.newRole({
  loan: ["create", "read", "update"],
  customer: ["create", "read", "update"],
  payment: ["create", "read", "update", "delete"],
})

export const adminRole = ac.newRole({
  ...loanOfficerRole.statements,
  role: ["assign-loan-officer"],
  settings: ["read", "update"],
  ...adminAc.statements,
})

export const superAdminRole = ac.newRole({
  ...adminRole.statements,
  role: ["assign-loan-officer", "assign-admin", "assign-super-admin"],
})
