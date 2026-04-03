import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements, adminAc } from "better-auth/plugins/admin/access"

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
