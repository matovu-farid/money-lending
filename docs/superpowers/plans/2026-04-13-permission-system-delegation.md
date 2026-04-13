# Permission-Based Authorization & Managing Supervisor Delegation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace role-level authorization with granular permission-based checks, then add a delegation system that temporarily elevates Supervisors to "Managing Supervisor" with admin-level operational permissions.

**Architecture:** Define a permission catalog as `resource:action` strings. Each role maps to a static `Set<Permission>`. `withAction` switches from `minRole` to `permission`. A `delegations` table tracks temporary elevation — when active, a Supervisor's effective permissions merge with the Managing Supervisor elevated set. The role hierarchy (levels 0–4) remains only for role assignment guards.

**Tech Stack:** Drizzle ORM (Postgres), better-auth, Next.js server actions, React (sidebar/layouts), Vitest

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/permissions.ts` | Rewrite | Permission catalog, role→permission maps, `getPermissionsForRole()`, Managing Supervisor elevated set |
| `src/types/common.ts` | Modify | Add `Permission` type |
| `src/lib/with-action.ts` | Modify | Replace `minRole` with `permission`, resolve effective permissions |
| `src/lib/action-utils.ts` | Modify | Add `getEffectivePermissions()`, `hasPermission()`, replace `requireRole()` |
| `src/lib/db/schema/delegations.ts` | Create | `delegations` table schema |
| `src/lib/db/schema/index.ts` | Modify | Export delegations schema |
| `src/services/delegation.service.ts` | Create | CRUD for delegations |
| `src/actions/delegation.actions.ts` | Create | Server actions for create/revoke/list delegations |
| `src/actions/loan.actions.ts` | Modify | Replace `minRole` and inline `ROLE_LEVELS` checks with permission checks |
| `src/actions/rate-change-request.actions.ts` | Modify | Replace `getRequiredApproverRole()` with permission-based approval |
| `src/actions/expense.actions.ts` | Modify | Replace `minRole` with `permission` |
| `src/actions/income.actions.ts` | Modify | Replace `minRole` with `permission` |
| `src/actions/payment.actions.ts` | Modify | Replace `minRole` and inline checks with `permission` |
| `src/actions/dashboard.actions.ts` | Modify | Replace `minRole` with `permission` |
| `src/actions/creditor.actions.ts` | Modify | Replace `minRole` with `permission` |
| `src/actions/fund-transfer.actions.ts` | Modify | Replace `minRole` with `permission` |
| `src/actions/settlement.actions.ts` | Modify | Replace `minRole` with `permission` |
| `src/actions/settings.actions.ts` | Modify | Replace `minRole` with `permission` |
| `src/actions/customer.actions.ts` | Modify | Replace `minRole` with `permission` |
| `src/actions/user.actions.ts` | Modify | Replace inline `ROLE_LEVELS` checks with permission checks (keep hierarchy for assignment level guard) |
| `src/components/layout/sidebar.tsx` | Modify | Replace `ROLE_LEVELS` checks with permission-set checks |
| `src/app/(app)/admin/layout.tsx` | Modify | Permission-based guard |
| `src/app/(app)/dashboard/layout.tsx` | Modify | Permission-based guard |
| `src/app/(app)/reports/layout.tsx` | Modify | Permission-based guard |
| `src/app/(app)/fund-transfers/layout.tsx` | Modify | Permission-based guard |
| `src/app/(app)/admin/page.tsx` | Modify | Add delegation UI section |
| `src/lib/__tests__/permissions.test.ts` | Rewrite | Test permission catalog, role maps, effective permissions with delegation |
| `src/lib/__tests__/with-action.test.ts` | Modify | Update tests for `permission` param instead of `minRole` |

---

### Task 1: Define Permission Catalog and Role Maps

**Files:**
- Modify: `src/types/common.ts`
- Rewrite: `src/lib/permissions.ts`

- [ ] **Step 1: Write failing tests for the permission catalog**

Create `src/lib/__tests__/permissions.test.ts` (replacing existing content):

```ts
import { describe, it, expect } from "vitest"
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  MANAGING_SUPERVISOR_ELEVATED,
  getPermissionsForRole,
  type Permission,
} from "../permissions"

describe("PERMISSIONS catalog", () => {
  it("contains all expected operation permissions", () => {
    expect(PERMISSIONS).toContain("loan:create")
    expect(PERMISSIONS).toContain("loan:read")
    expect(PERMISSIONS).toContain("loan:update")
    expect(PERMISSIONS).toContain("loan:disburse")
    expect(PERMISSIONS).toContain("loan:rollover")
    expect(PERMISSIONS).toContain("loan:settle")
    expect(PERMISSIONS).toContain("customer:create")
    expect(PERMISSIONS).toContain("customer:read")
    expect(PERMISSIONS).toContain("customer:update")
    expect(PERMISSIONS).toContain("payment:create")
    expect(PERMISSIONS).toContain("payment:read")
    expect(PERMISSIONS).toContain("payment:update")
    expect(PERMISSIONS).toContain("payment:delete")
    expect(PERMISSIONS).toContain("expense:create")
    expect(PERMISSIONS).toContain("expense:read")
    expect(PERMISSIONS).toContain("income:create")
    expect(PERMISSIONS).toContain("income:read")
    expect(PERMISSIONS).toContain("fund-transfer:create")
    expect(PERMISSIONS).toContain("fund-transfer:read")
    expect(PERMISSIONS).toContain("backdate:beyond-3-days")
  })

  it("contains all expected approval permissions", () => {
    expect(PERMISSIONS).toContain("rate-change:create")
    expect(PERMISSIONS).toContain("rate-change:approve-standard")
    expect(PERMISSIONS).toContain("rate-change:approve-low")
  })

  it("contains all expected creditor permissions", () => {
    expect(PERMISSIONS).toContain("creditor:read")
    expect(PERMISSIONS).toContain("creditor:create")
    expect(PERMISSIONS).toContain("creditor:update")
  })

  it("contains all expected admin permissions", () => {
    expect(PERMISSIONS).toContain("role:assign-loan-officer")
    expect(PERMISSIONS).toContain("role:assign-supervisor")
    expect(PERMISSIONS).toContain("role:assign-admin")
    expect(PERMISSIONS).toContain("role:assign-super-admin")
    expect(PERMISSIONS).toContain("settings:read")
    expect(PERMISSIONS).toContain("settings:update")
    expect(PERMISSIONS).toContain("user:list")
    expect(PERMISSIONS).toContain("user:ban")
    expect(PERMISSIONS).toContain("user:impersonate")
    expect(PERMISSIONS).toContain("session:list")
    expect(PERMISSIONS).toContain("session:revoke")
    expect(PERMISSIONS).toContain("session:delete")
  })

  it("contains delegation permissions", () => {
    expect(PERMISSIONS).toContain("delegation:create")
    expect(PERMISSIONS).toContain("delegation:revoke")
    expect(PERMISSIONS).toContain("delegation:read")
  })

  it("contains report permissions", () => {
    expect(PERMISSIONS).toContain("dashboard:read")
    expect(PERMISSIONS).toContain("reports:read")
  })
})

describe("ROLE_PERMISSIONS", () => {
  it("unassigned has no permissions", () => {
    expect(ROLE_PERMISSIONS.unassigned.size).toBe(0)
  })

  it("loanOfficer has basic operations", () => {
    const perms = ROLE_PERMISSIONS.loanOfficer
    expect(perms.has("loan:create")).toBe(true)
    expect(perms.has("loan:read")).toBe(true)
    expect(perms.has("customer:create")).toBe(true)
    expect(perms.has("payment:create")).toBe(true)
    expect(perms.has("rate-change:create")).toBe(true)
    expect(perms.has("reports:read")).toBe(true)
    // Should NOT have supervisor+ perms
    expect(perms.has("loan:disburse")).toBe(false)
    expect(perms.has("dashboard:read")).toBe(false)
    expect(perms.has("creditor:read")).toBe(false)
    expect(perms.has("backdate:beyond-3-days")).toBe(false)
  })

  it("supervisor includes loanOfficer and adds supervisor-level perms", () => {
    const perms = ROLE_PERMISSIONS.supervisor
    // Inherited from loanOfficer
    expect(perms.has("loan:create")).toBe(true)
    expect(perms.has("payment:create")).toBe(true)
    // Supervisor additions
    expect(perms.has("loan:disburse")).toBe(true)
    expect(perms.has("loan:rollover")).toBe(true)
    expect(perms.has("loan:settle")).toBe(true)
    expect(perms.has("backdate:beyond-3-days")).toBe(true)
    expect(perms.has("rate-change:approve-standard")).toBe(true)
    expect(perms.has("dashboard:read")).toBe(true)
    expect(perms.has("role:assign-loan-officer")).toBe(true)
    expect(perms.has("creditor:read")).toBe(true)
    expect(perms.has("creditor:create")).toBe(true)
    expect(perms.has("creditor:update")).toBe(true)
    // Should NOT have admin perms
    expect(perms.has("rate-change:approve-low")).toBe(false)
    expect(perms.has("settings:read")).toBe(false)
    expect(perms.has("delegation:create")).toBe(false)
  })

  it("admin includes supervisor and adds admin-level perms", () => {
    const perms = ROLE_PERMISSIONS.admin
    // Inherited
    expect(perms.has("loan:disburse")).toBe(true)
    expect(perms.has("creditor:read")).toBe(true)
    // Admin additions
    expect(perms.has("rate-change:approve-low")).toBe(true)
    expect(perms.has("role:assign-supervisor")).toBe(true)
    expect(perms.has("settings:read")).toBe(true)
    expect(perms.has("settings:update")).toBe(true)
    expect(perms.has("user:list")).toBe(true)
    expect(perms.has("user:ban")).toBe(true)
    expect(perms.has("user:impersonate")).toBe(true)
    expect(perms.has("session:list")).toBe(true)
    expect(perms.has("delegation:create")).toBe(true)
    expect(perms.has("delegation:revoke")).toBe(true)
    expect(perms.has("delegation:read")).toBe(true)
    // Should NOT have superAdmin perms
    expect(perms.has("role:assign-admin")).toBe(false)
    expect(perms.has("role:assign-super-admin")).toBe(false)
  })

  it("superAdmin has everything admin has plus full role assignment", () => {
    const perms = ROLE_PERMISSIONS.superAdmin
    expect(perms.has("role:assign-admin")).toBe(true)
    expect(perms.has("role:assign-super-admin")).toBe(true)
    // All admin perms should also be present
    for (const p of ROLE_PERMISSIONS.admin) {
      expect(perms.has(p)).toBe(true)
    }
  })
})

describe("MANAGING_SUPERVISOR_ELEVATED", () => {
  it("includes admin operational permissions", () => {
    expect(MANAGING_SUPERVISOR_ELEVATED.has("rate-change:approve-low")).toBe(true)
    expect(MANAGING_SUPERVISOR_ELEVATED.has("settings:read")).toBe(true)
    expect(MANAGING_SUPERVISOR_ELEVATED.has("settings:update")).toBe(true)
    expect(MANAGING_SUPERVISOR_ELEVATED.has("user:list")).toBe(true)
    expect(MANAGING_SUPERVISOR_ELEVATED.has("user:ban")).toBe(true)
    expect(MANAGING_SUPERVISOR_ELEVATED.has("user:impersonate")).toBe(true)
    expect(MANAGING_SUPERVISOR_ELEVATED.has("session:list")).toBe(true)
    expect(MANAGING_SUPERVISOR_ELEVATED.has("session:revoke")).toBe(true)
    expect(MANAGING_SUPERVISOR_ELEVATED.has("session:delete")).toBe(true)
  })

  it("excludes creditor permissions", () => {
    for (const p of MANAGING_SUPERVISOR_ELEVATED) {
      expect(p.startsWith("creditor:")).toBe(false)
    }
  })

  it("excludes role assignment permissions", () => {
    for (const p of MANAGING_SUPERVISOR_ELEVATED) {
      expect(p.startsWith("role:")).toBe(false)
    }
  })

  it("excludes delegation permissions", () => {
    for (const p of MANAGING_SUPERVISOR_ELEVATED) {
      expect(p.startsWith("delegation:")).toBe(false)
    }
  })
})

describe("getPermissionsForRole", () => {
  it("returns empty set for unassigned", () => {
    expect(getPermissionsForRole("unassigned").size).toBe(0)
  })

  it("returns loanOfficer permissions", () => {
    const perms = getPermissionsForRole("loanOfficer")
    expect(perms).toEqual(ROLE_PERMISSIONS.loanOfficer)
  })

  it("returns empty set for unknown role", () => {
    expect(getPermissionsForRole("bogus" as any).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/permissions.test.ts`
Expected: FAIL — `PERMISSIONS`, `ROLE_PERMISSIONS`, `MANAGING_SUPERVISOR_ELEVATED`, `getPermissionsForRole` don't exist yet.

- [ ] **Step 3: Add Permission type to common.ts**

In `src/types/common.ts`, add after the `UserRole` type:

```ts
export type Permission =
  // Operations
  | "loan:create" | "loan:read" | "loan:update" | "loan:disburse" | "loan:rollover" | "loan:settle"
  | "customer:create" | "customer:read" | "customer:update"
  | "payment:create" | "payment:read" | "payment:update" | "payment:delete"
  | "expense:create" | "expense:read"
  | "income:create" | "income:read"
  | "fund-transfer:create" | "fund-transfer:read"
  | "backdate:beyond-3-days"
  // Approvals
  | "rate-change:create" | "rate-change:approve-standard" | "rate-change:approve-low"
  // Creditors
  | "creditor:read" | "creditor:create" | "creditor:update"
  // Reports
  | "dashboard:read" | "reports:read"
  // Administration
  | "role:assign-loan-officer" | "role:assign-supervisor" | "role:assign-admin" | "role:assign-super-admin"
  | "settings:read" | "settings:update"
  | "user:list" | "user:ban" | "user:impersonate"
  | "session:list" | "session:revoke" | "session:delete"
  // Delegation
  | "delegation:create" | "delegation:revoke" | "delegation:read"
  // Payment edit/delete own or admin override
  | "payment:edit-any" | "payment:delete-any"
```

- [ ] **Step 4: Rewrite permissions.ts with catalog and role maps**

Replace `src/lib/permissions.ts` entirely:

```ts
import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements, adminAc } from "better-auth/plugins/admin/access"
import type { Permission, UserRole } from "@/types"

// ---------------------------------------------------------------------------
// better-auth access control (kept for plugin compatibility)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Permission catalog (source of truth for authorization)
// ---------------------------------------------------------------------------

export const PERMISSIONS: readonly Permission[] = [
  // Operations
  "loan:create", "loan:read", "loan:update", "loan:disburse", "loan:rollover", "loan:settle",
  "customer:create", "customer:read", "customer:update",
  "payment:create", "payment:read", "payment:update", "payment:delete",
  "payment:edit-any", "payment:delete-any",
  "expense:create", "expense:read",
  "income:create", "income:read",
  "fund-transfer:create", "fund-transfer:read",
  "backdate:beyond-3-days",
  // Approvals
  "rate-change:create", "rate-change:approve-standard", "rate-change:approve-low",
  // Creditors
  "creditor:read", "creditor:create", "creditor:update",
  // Reports
  "dashboard:read", "reports:read",
  // Administration
  "role:assign-loan-officer", "role:assign-supervisor", "role:assign-admin", "role:assign-super-admin",
  "settings:read", "settings:update",
  "user:list", "user:ban", "user:impersonate",
  "session:list", "session:revoke", "session:delete",
  // Delegation
  "delegation:create", "delegation:revoke", "delegation:read",
] as const

// ---------------------------------------------------------------------------
// Role -> Permission mapping
// ---------------------------------------------------------------------------

const LOAN_OFFICER_PERMS: Permission[] = [
  "loan:create", "loan:read", "loan:update",
  "customer:create", "customer:read", "customer:update",
  "payment:create", "payment:read", "payment:update", "payment:delete",
  "expense:create", "expense:read",
  "income:create", "income:read",
  "fund-transfer:create", "fund-transfer:read",
  "rate-change:create",
  "reports:read",
]

const SUPERVISOR_EXTRA: Permission[] = [
  "loan:disburse", "loan:rollover", "loan:settle",
  "backdate:beyond-3-days",
  "rate-change:approve-standard",
  "dashboard:read",
  "role:assign-loan-officer",
  "creditor:read", "creditor:create", "creditor:update",
  "payment:edit-any", "payment:delete-any",
]

const ADMIN_EXTRA: Permission[] = [
  "rate-change:approve-low",
  "role:assign-supervisor",
  "settings:read", "settings:update",
  "user:list", "user:ban", "user:impersonate",
  "session:list", "session:revoke", "session:delete",
  "delegation:create", "delegation:revoke", "delegation:read",
]

const SUPER_ADMIN_EXTRA: Permission[] = [
  "role:assign-admin", "role:assign-super-admin",
]

export const ROLE_PERMISSIONS: Record<UserRole, Set<Permission>> = {
  unassigned: new Set(),
  loanOfficer: new Set(LOAN_OFFICER_PERMS),
  supervisor: new Set([...LOAN_OFFICER_PERMS, ...SUPERVISOR_EXTRA]),
  admin: new Set([...LOAN_OFFICER_PERMS, ...SUPERVISOR_EXTRA, ...ADMIN_EXTRA]),
  superAdmin: new Set([...LOAN_OFFICER_PERMS, ...SUPERVISOR_EXTRA, ...ADMIN_EXTRA, ...SUPER_ADMIN_EXTRA]),
}

// ---------------------------------------------------------------------------
// Managing Supervisor elevated set
// Admin permissions minus creditor:*, role:*, delegation:*
// ---------------------------------------------------------------------------

export const MANAGING_SUPERVISOR_ELEVATED: Set<Permission> = new Set(
  [...ROLE_PERMISSIONS.admin].filter(
    (p) => !p.startsWith("creditor:") && !p.startsWith("role:") && !p.startsWith("delegation:")
  )
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getPermissionsForRole(role: UserRole): Set<Permission> {
  return ROLE_PERMISSIONS[role] ?? new Set()
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/permissions.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/types/common.ts src/lib/permissions.ts src/lib/__tests__/permissions.test.ts
git commit -m "feat: define permission catalog and role-to-permission maps"
```

---

### Task 2: Create Delegations DB Schema

**Files:**
- Create: `src/lib/db/schema/delegations.ts`
- Modify: `src/lib/db/schema/index.ts`

- [ ] **Step 1: Create delegations schema file**

Create `src/lib/db/schema/delegations.ts`:

```ts
import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { user } from "./auth"

export const delegations = pgTable(
  "delegation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    delegatedBy: text("delegated_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
    revokedBy: text("revoked_by").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [
    index("delegation_userId_idx").on(table.userId),
    index("delegation_active_idx").on(table.userId, table.revokedAt),
  ],
)

export const delegationRelations = relations(delegations, ({ one }) => ({
  user: one(user, { fields: [delegations.userId], references: [user.id], relationName: "delegationUser" }),
  delegator: one(user, { fields: [delegations.delegatedBy], references: [user.id], relationName: "delegationDelegator" }),
  revoker: one(user, { fields: [delegations.revokedBy], references: [user.id], relationName: "delegationRevoker" }),
}))
```

- [ ] **Step 2: Export from schema index**

In `src/lib/db/schema/index.ts`, add at the end:

```ts
export * from "./delegations"
```

- [ ] **Step 3: Push schema to dev database**

Run: `npx drizzle-kit push`
Expected: Table `delegation` created with columns and indexes.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema/delegations.ts src/lib/db/schema/index.ts
git commit -m "feat: add delegations table schema"
```

---

### Task 3: Refactor withAction and action-utils for Permission-Based Auth

**Files:**
- Modify: `src/lib/action-utils.ts`
- Modify: `src/lib/with-action.ts`
- Modify: `src/lib/__tests__/with-action.test.ts`

- [ ] **Step 1: Write failing tests for the new permission-based withAction**

Replace `src/lib/__tests__/with-action.test.ts` entirely:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect, Data } from "effect"

// ---------- Mocks ----------

const mockGetSession = vi.fn()
const mockCheckPermission = vi.fn()
const mockGetErrorTag = vi.fn()
const mockRevalidatePath = vi.fn()

vi.mock("@/lib/action-utils", () => ({
  getSession: () => mockGetSession(),
  checkPermission: (...args: any[]) => mockCheckPermission(...args),
  getErrorTag: (error: unknown) => mockGetErrorTag(error),
  getUserRole: (session: any) => (session.user.role ?? "unassigned"),
}))

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => mockRevalidatePath(path),
}))

import { withAction } from "../with-action"

// ---------- Test helpers ----------

const fakeSession = {
  user: { id: "u1", name: "Test", role: "admin" },
  session: { id: "s1" },
}

class NotFoundError extends Data.TaggedError("NotFoundError")<{
  message: string
}> {}

// ---------- Tests ----------

describe("withAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(fakeSession)
    mockCheckPermission.mockReturnValue(null) // no forbidden
  })

  describe("classic mode", () => {
    it("calls the action with session and returns its result", async () => {
      const action = withAction({
        action: async (session) => ({ data: [1, 2, 3] }),
      })
      const result = await action()
      expect(result).toEqual({ data: [1, 2, 3] })
    })

    it("passes input to the action", async () => {
      const action = withAction<{ id: string }, { data: string }>({
        action: async (session, input) => ({ data: input.id }),
      })
      const result = await action({ id: "abc" })
      expect(result).toEqual({ data: "abc" })
    })

    it("returns Unauthorized when session is null", async () => {
      mockGetSession.mockResolvedValue(null)
      const action = withAction({
        action: async () => ({ data: "ok" }),
      })
      const result = await action()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns forbidden when permission check fails", async () => {
      mockCheckPermission.mockReturnValue("Forbidden")
      const action = withAction({
        permission: "loan:create",
        action: async () => ({ data: "ok" }),
      })
      const result = await action()
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("calls checkPermission with session and permission string", async () => {
      const action = withAction({
        permission: "loan:create",
        action: async () => ({ data: "ok" }),
      })
      await action()
      expect(mockCheckPermission).toHaveBeenCalledWith(fakeSession, "loan:create", undefined)
    })

    it("passes forbiddenMessage to checkPermission", async () => {
      const action = withAction({
        permission: "settings:update",
        forbiddenMessage: "Only admins can do this",
        action: async () => ({ data: "ok" }),
      })
      await action()
      expect(mockCheckPermission).toHaveBeenCalledWith(fakeSession, "settings:update", "Only admins can do this")
    })
  })

  describe("effect mode", () => {
    it("runs Effect and returns { data } on success", async () => {
      const action = withAction({
        effect: (_session) => Effect.succeed({ items: [1, 2] }),
      })
      const result = await action()
      expect(result).toEqual({ data: { items: [1, 2] } })
    })

    it("checks permission before running effect", async () => {
      mockCheckPermission.mockReturnValue("Forbidden")
      const effectFn = vi.fn(() => Effect.succeed("data"))
      const action = withAction({
        permission: "settings:update",
        effect: effectFn,
      })
      const result = await action()
      expect(result).toEqual({ error: "Forbidden" })
      expect(effectFn).not.toHaveBeenCalled()
    })

    it("maps tagged errors to user-facing messages", async () => {
      mockGetErrorTag.mockReturnValue("NotFoundError")
      const action = withAction({
        effect: () => Effect.fail(new NotFoundError({ message: "gone" })),
        errors: { NotFoundError: "The item was not found" },
      })
      const result = await action()
      expect(result).toEqual({ error: "The item was not found" })
    })

    it("revalidates static paths on success", async () => {
      const action = withAction({
        effect: () => Effect.succeed("ok"),
        revalidate: ["/loans", "/dashboard"],
      })
      await action()
      expect(mockRevalidatePath).toHaveBeenCalledTimes(2)
      expect(mockRevalidatePath).toHaveBeenCalledWith("/loans")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard")
    })

    it("returns Unauthorized when session is null", async () => {
      mockGetSession.mockResolvedValue(null)
      const action = withAction({
        effect: () => Effect.succeed("data"),
      })
      const result = await action()
      expect(result).toEqual({ error: "Unauthorized" })
    })
  })

  describe("no permission required", () => {
    it("skips permission check when no permission specified", async () => {
      const action = withAction({
        action: async () => ({ data: "ok" }),
      })
      await action()
      expect(mockCheckPermission).not.toHaveBeenCalled()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/with-action.test.ts`
Expected: FAIL — `checkPermission` not exported from action-utils, `permission` not a valid option.

- [ ] **Step 3: Add getEffectivePermissions, hasPermission, and checkPermission to action-utils**

Replace `src/lib/action-utils.ts` with:

```ts
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { ROLE_LEVELS, type UserRole, type Permission } from "@/types"
import { getPermissionsForRole, MANAGING_SUPERVISOR_ELEVATED } from "@/lib/permissions"
import { db } from "@/lib/db"
import { delegations } from "@/lib/db/schema/delegations"
import { eq, isNull, and } from "drizzle-orm"

/**
 * Get the current authenticated session, or null if not logged in.
 */
export async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user ? session : null
}

/**
 * Extract the user's role from a session, defaulting to "unassigned".
 */
export function getUserRole(session: { user: { role?: string | null } }): UserRole {
  return (session.user.role ?? "unassigned") as UserRole
}

/**
 * Check if the session user meets the minimum role requirement.
 * Returns an error string if forbidden, or null if permitted.
 * LEGACY — kept for role assignment guards only.
 */
export function requireRole(
  session: { user: { role?: string | null } },
  minRole: UserRole,
  message?: string,
): string | null {
  const role = getUserRole(session)
  return ROLE_LEVELS[role] < ROLE_LEVELS[minRole] ? (message ?? "Forbidden") : null
}

/**
 * Check if user has an active delegation (supervisor → managing supervisor).
 */
export async function hasActiveDelegation(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: delegations.id })
    .from(delegations)
    .where(and(eq(delegations.userId, userId), isNull(delegations.revokedAt)))
    .limit(1)
  return !!row
}

/**
 * Resolve the effective permission set for a user, merging delegation if active.
 */
export async function getEffectivePermissions(
  userId: string,
  role: UserRole,
): Promise<Set<Permission>> {
  const basePerms = getPermissionsForRole(role)

  if (role === "supervisor") {
    const delegated = await hasActiveDelegation(userId)
    if (delegated) {
      return new Set([...basePerms, ...MANAGING_SUPERVISOR_ELEVATED])
    }
  }

  return basePerms
}

/**
 * Check if a user has a specific permission. Returns error string or null.
 */
export async function checkPermission(
  session: { user: { id: string; role?: string | null } },
  permission: Permission,
  message?: string,
): Promise<string | null> {
  const role = getUserRole(session)
  const perms = await getEffectivePermissions(session.user.id, role)
  return perms.has(permission) ? null : (message ?? "Forbidden")
}

/**
 * Extract the `_tag` string from an Effect FiberFailure error.
 */
export function getErrorTag(error: unknown): string | undefined {
  if (error == null || typeof error !== "object") return undefined
  if ("_tag" in error && typeof (error as any)._tag === "string") {
    return (error as any)._tag
  }
  const cause =
    (error as any)[Symbol.for("effect/Runtime/FiberFailure/Cause")] ??
    (error as any).cause
  if (cause && typeof cause === "object") {
    const inner = cause.failure ?? cause.error
    if (inner && typeof inner === "object" && "_tag" in inner) {
      return inner._tag as string
    }
  }
  return undefined
}

/**
 * Extract a specific field from an Effect FiberFailure's inner error.
 */
export function getErrorField(error: unknown, field: string): unknown {
  if (error == null || typeof error !== "object") return undefined
  if ("_tag" in error && field in error) return (error as any)[field]
  const cause =
    (error as any)[Symbol.for("effect/Runtime/FiberFailure/Cause")] ??
    (error as any).cause
  if (cause && typeof cause === "object") {
    const inner = cause.failure ?? cause.error
    if (inner && typeof inner === "object" && field in inner) {
      return (inner as any)[field]
    }
  }
  return undefined
}
```

- [ ] **Step 4: Refactor withAction to use permission instead of minRole**

Replace `src/lib/with-action.ts` with:

```ts
import { getSession, checkPermission, getErrorTag } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import { Effect } from "effect"
import type { Permission } from "@/types"

/** The session type returned by getSession() when non-null. */
export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>

// ---------------------------------------------------------------------------
// Classic mode interfaces
// ---------------------------------------------------------------------------

interface ActionOptionsWithInput<TInput, TResult> {
  permission?: Permission
  forbiddenMessage?: string
  action: (session: Session, input: TInput) => Promise<TResult>
}

interface ActionOptionsNoInput<TResult> {
  permission?: Permission
  forbiddenMessage?: string
  action: (session: Session) => Promise<TResult>
}

// ---------------------------------------------------------------------------
// Effect mode interfaces
// ---------------------------------------------------------------------------

interface EffectOptionsBase {
  permission?: Permission
  forbiddenMessage?: string
  errors?: Record<string, string>
}

interface EffectOptionsWithInput<TInput, TData> extends EffectOptionsBase {
  effect: (session: Session, input: TInput) => Effect.Effect<TData, any>
  revalidate?: string[] | ((input: TInput) => string[])
}

interface EffectOptionsNoInput<TData> extends EffectOptionsBase {
  effect: (session: Session) => Effect.Effect<TData, any>
  revalidate?: string[]
}

// ---------------------------------------------------------------------------
// Overloads
// ---------------------------------------------------------------------------

/** Classic mode — no input */
export function withAction<TResult>(
  opts: ActionOptionsNoInput<TResult>,
): () => Promise<TResult | { error: string }>

/** Classic mode — with input */
export function withAction<TInput, TResult>(
  opts: ActionOptionsWithInput<TInput, TResult>,
): (input: TInput) => Promise<TResult | { error: string }>

/** Effect mode — no input */
export function withAction<TData>(
  opts: EffectOptionsNoInput<TData>,
): () => Promise<{ data: TData } | { error: string }>

/** Effect mode — with input */
export function withAction<TInput, TData>(
  opts: EffectOptionsWithInput<TInput, TData>,
): (input: TInput) => Promise<{ data: TData } | { error: string }>

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function withAction(opts: any): (input?: any) => Promise<any> {
  return async (input?: any) => {
    const session = await getSession()
    if (!session) return { error: "Unauthorized" }

    if (opts.permission) {
      const forbidden = await checkPermission(session, opts.permission, opts.forbiddenMessage)
      if (forbidden) return { error: forbidden }
    }

    // Effect mode
    if ("effect" in opts) {
      try {
        const eff = opts.effect(session, input)
        const data = await Effect.runPromise(eff)

        if (opts.revalidate) {
          const paths =
            typeof opts.revalidate === "function"
              ? opts.revalidate(input)
              : opts.revalidate
          for (const p of paths) {
            revalidatePath(p)
          }
        }

        return { data }
      } catch (error) {
        const tag = getErrorTag(error)
        if (tag && opts.errors && tag in opts.errors) {
          return { error: opts.errors[tag] }
        }
        return { error: "Internal server error" }
      }
    }

    // Classic mode
    return opts.action(session, input)
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/with-action.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/action-utils.ts src/lib/with-action.ts src/lib/__tests__/with-action.test.ts
git commit -m "feat: refactor withAction from minRole to permission-based checks"
```

---

### Task 4: Migrate All Server Actions to Permission-Based Checks

**Files:**
- Modify: `src/actions/dashboard.actions.ts`
- Modify: `src/actions/expense.actions.ts`
- Modify: `src/actions/income.actions.ts`
- Modify: `src/actions/creditor.actions.ts`
- Modify: `src/actions/fund-transfer.actions.ts`
- Modify: `src/actions/settlement.actions.ts`
- Modify: `src/actions/settings.actions.ts`
- Modify: `src/actions/customer.actions.ts`
- Modify: `src/actions/payment.actions.ts`

This task is mechanical: replace every `minRole: "xxx"` with the appropriate `permission: "yyy"`.

- [ ] **Step 1: Migrate dashboard.actions.ts**

Replace all `minRole` occurrences:

```
minRole: "supervisor"  →  permission: "dashboard:read"
```

Both `getDashboardAction` and `getRecentActivityWrapped` get `permission: "dashboard:read"`.

- [ ] **Step 2: Migrate expense.actions.ts**

```
recordExpenseAction:          minRole: "loanOfficer"  →  permission: "expense:create"
deleteExpenseAction:          minRole: "loanOfficer"  →  permission: "expense:create"
createExpenseCategoryAction:  minRole: "loanOfficer"  →  permission: "expense:create"
deleteExpenseCategoryAction:  minRole: "loanOfficer"  →  permission: "expense:create"
```

Also replace the inline backdating check. Change:

```ts
if (daysDiff > 3 && ROLE_LEVELS[role] < ROLE_LEVELS.supervisor) {
```

to:

```ts
const { getEffectivePermissions } = await import("@/lib/action-utils")
const role = getUserRole(session)
const perms = await getEffectivePermissions(session.user.id, role)
if (daysDiff > 3 && !perms.has("backdate:beyond-3-days")) {
```

And similarly replace the `isLoanOfficer` check:

```ts
const isLoanOfficer = ROLE_LEVELS[role] < ROLE_LEVELS.supervisor
```

to:

```ts
const isLoanOfficer = !perms.has("backdate:beyond-3-days")
```

(Use the already-resolved `perms` from the backdating block above, or resolve it once at the top of the action.)

- [ ] **Step 3: Migrate income.actions.ts**

Same pattern as expenses:

```
recordIncomeAction:          minRole: "loanOfficer"  →  permission: "income:create"
deleteIncomeAction:          minRole: "loanOfficer"  →  permission: "income:create"
createIncomeCategoryAction:  minRole: "loanOfficer"  →  permission: "income:create"
deleteIncomeCategoryAction:  minRole: "loanOfficer"  →  permission: "income:create"
```

Replace the inline backdating check with permission-based check (same as expense).

- [ ] **Step 4: Migrate creditor.actions.ts**

```
listCreditorsAction:              minRole: "supervisor"  →  permission: "creditor:read"
getSystemCapitalAction:           minRole: "supervisor"  →  permission: "creditor:read"
createCreditorAction:             minRole: "supervisor"  →  permission: "creditor:create"
updateCreditorWrapped:            minRole: "supervisor"  →  permission: "creditor:update"
addInvestmentAction:              minRole: "supervisor"  →  permission: "creditor:create"
recordCreditorRepaymentAction:    minRole: "supervisor"  →  permission: "creditor:update"
```

- [ ] **Step 5: Migrate fund-transfer.actions.ts**

```
createFundTransferAction:     minRole: "supervisor"  →  permission: "fund-transfer:create"
createCapitalInjectionAction: minRole: "supervisor"  →  permission: "fund-transfer:create"
listFundTransfersAction:      minRole: "supervisor"  →  permission: "fund-transfer:read"
```

- [ ] **Step 6: Migrate settlement.actions.ts**

```
settleWithCollateralAction:  minRole: "supervisor"  →  permission: "loan:settle"
```

- [ ] **Step 7: Migrate settings.actions.ts**

```
updateSettingAction:  minRole: "superAdmin"  →  permission: "settings:update"
```

- [ ] **Step 8: Migrate customer.actions.ts**

```
changeCustomerStatusAction:  minRole: "admin"  →  permission: "user:ban"
```

(Customer status change is an admin-level action; `user:ban` is the closest permission. If you prefer a dedicated `customer:change-status` permission, add it to the catalog — but `user:ban` covers this use case.)

- [ ] **Step 9: Migrate payment.actions.ts**

```
markPaymentWrongWrapped:    minRole: "supervisor"  →  permission: "payment:edit-any"
unmarkPaymentWrongAction:   minRole: "supervisor"  →  permission: "payment:edit-any"
```

Replace the two inline role checks in `editPaymentAction` and `deletePaymentAction`:

```ts
// OLD
if (ROLE_LEVELS[role] < ROLE_LEVELS.admin) {
  // check own payment
}

// NEW
import { getEffectivePermissions } from "@/lib/action-utils"
const role = getUserRole(session)
const perms = await getEffectivePermissions(session.user.id, role)
if (!perms.has("payment:edit-any")) {
  // check own payment
}
```

Same pattern for `deletePaymentAction` with `payment:delete-any`.

- [ ] **Step 10: Run the full test suite**

Run: `npx vitest run`
Expected: All existing tests pass. Fix any import issues if tests mock `requireRole` — update them to mock `checkPermission`.

- [ ] **Step 11: Commit**

```bash
git add src/actions/
git commit -m "feat: migrate all server actions from minRole to permission-based checks"
```

---

### Task 5: Migrate Inline Role Checks in loan.actions.ts and rate-change-request.actions.ts

**Files:**
- Modify: `src/actions/loan.actions.ts`
- Modify: `src/actions/rate-change-request.actions.ts`

These files have complex inline role logic that needs careful migration.

- [ ] **Step 1: Migrate loan.actions.ts**

For `updateLoanAction` and `deleteLoanAction` (both permanently disabled): change `minRole: "admin"` to `permission: "loan:update"` (it returns an error regardless, so the permission choice doesn't matter much, but keep it consistent).

For `createLoanAction` (inline auth), replace at the top:

```ts
// OLD
const role = getUserRole(session)
if (ROLE_LEVELS[role] < ROLE_LEVELS.loanOfficer) {
  return { error: "Forbidden" }
}

// NEW
import { getEffectivePermissions } from "@/lib/action-utils"
const role = getUserRole(session)
const perms = await getEffectivePermissions(session.user.id, role)
if (!perms.has("loan:create")) {
  return { error: "Forbidden" }
}
```

Then replace rollover check:

```ts
// OLD
if (ROLE_LEVELS[role] < ROLE_LEVELS.supervisor) {

// NEW
if (!perms.has("loan:rollover")) {
```

Backdating check:

```ts
// OLD
if (daysDiff > 3 && ROLE_LEVELS[role] < ROLE_LEVELS.supervisor) {

// NEW
if (daysDiff > 3 && !perms.has("backdate:beyond-3-days")) {
```

Insufficient funds message:

```ts
// OLD
const isLoanOfficer = ROLE_LEVELS[role] < ROLE_LEVELS.supervisor

// NEW
const isLoanOfficer = !perms.has("fund-transfer:create")
```

Interest rate override guard:

```ts
// OLD
if (ROLE_LEVELS[role] < ROLE_LEVELS.admin) {
  loanInput.interestRateOverride = null
  loanInput.minPeriodOverride = null
}

// NEW
if (!perms.has("settings:update")) {
  loanInput.interestRateOverride = null
  loanInput.minPeriodOverride = null
}
```

For `waivePenaltyAction` and `adjustPenaltyMultiplierAction`:

```
minRole: "admin"  →  permission: "loan:update"
```

- [ ] **Step 2: Migrate rate-change-request.actions.ts**

Remove `getRequiredApproverRole()` function. Replace the approval logic.

In `requestRateChangeAction`, after computing `requestedRateFloat`, replace:

```ts
// OLD
const requiredApproverRole = getRequiredApproverRole(input.requestedRate)
if (requiredApproverRole === null || ROLE_LEVELS[role] >= ROLE_LEVELS[requiredApproverRole]) {
  // apply immediately
}

// NEW
import { getEffectivePermissions } from "@/lib/action-utils"
const perms = await getEffectivePermissions(session.user.id, role)

// Determine which permission is needed to approve this rate
const requiredPermission: Permission | null =
  requestedRateFloat >= 0.10 ? null :
  requestedRateFloat >= 0.08 ? "rate-change:approve-standard" :
  "rate-change:approve-low"

// Store which permission level is needed for the request record
const requiredApprovalLevel: string | null =
  requestedRateFloat >= 0.10 ? null :
  requestedRateFloat >= 0.08 ? "rate-change:approve-standard" :
  "rate-change:approve-low"

if (requiredPermission === null || perms.has(requiredPermission)) {
  // apply immediately
}
```

Update the insert to store `requiredApprovalLevel` instead of `requiredApproverRole`:

```ts
// The rateChangeRequests table's requiredApproverRole column stores the required permission string now
requiredApproverRole: requiredApprovalLevel,
```

In `reviewRateChangeRequestAction`, replace:

```ts
// OLD
if (ROLE_LEVELS[role] < ROLE_LEVELS.supervisor) {
  return { error: "Forbidden" }
}
...
const requiredRole = request.requiredApproverRole as UserRole
if (ROLE_LEVELS[role] < ROLE_LEVELS[requiredRole]) {
  return { error: `This request requires ${requiredRole} or higher to review` }
}

// NEW
const perms = await getEffectivePermissions(session.user.id, role)
if (!perms.has("rate-change:approve-standard")) {
  return { error: "Forbidden" }
}
...
const requiredPermission = request.requiredApproverRole as Permission
if (!perms.has(requiredPermission)) {
  return { error: `You do not have permission to review this request (requires ${requiredPermission})` }
}
```

In `listAllRequestsAction` and `countPendingRequestsAction`, replace:

```ts
// OLD
if (ROLE_LEVELS[role] < ROLE_LEVELS.supervisor)

// NEW
const perms = await getEffectivePermissions(session.user.id, role)
if (!perms.has("rate-change:approve-standard"))
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/actions/loan.actions.ts src/actions/rate-change-request.actions.ts
git commit -m "feat: migrate loan and rate-change actions to permission-based checks"
```

---

### Task 6: Migrate User Actions (Role Assignment)

**Files:**
- Modify: `src/actions/user.actions.ts`

- [ ] **Step 1: Refactor assignRole to use permission checks**

Replace `src/actions/user.actions.ts`:

```ts
"use server"

import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { getSession, getEffectivePermissions, getUserRole } from "@/lib/action-utils"
import { ROLE_LEVELS, type UserRole } from "@/types"
import type { Permission } from "@/types"

const VALID_ROLES: UserRole[] = ["unassigned", "loanOfficer", "supervisor", "admin", "superAdmin"]

/** Map each assignable role to the permission required to assign it. */
const ROLE_ASSIGN_PERMISSION: Record<string, Permission> = {
  loanOfficer: "role:assign-loan-officer",
  supervisor: "role:assign-supervisor",
  admin: "role:assign-admin",
  superAdmin: "role:assign-super-admin",
}

export async function assignRole(input: { userId: string; role: UserRole }) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  const { userId, role: targetRole } = input

  if (!userId) {
    return { error: "User ID is required" }
  }
  if (!VALID_ROLES.includes(targetRole)) {
    return { error: "Invalid role" }
  }

  if (userId === session.user.id) {
    return { error: "Cannot change your own role" }
  }

  const actorRole = getUserRole(session)
  const actorLevel = ROLE_LEVELS[actorRole] ?? 0
  const targetLevel = ROLE_LEVELS[targetRole] ?? 0

  // Keep hierarchy guard: can't assign at or above your own level
  if (targetLevel >= actorLevel) {
    return { error: "Cannot assign role at or above your own level" }
  }

  // Check permission for the specific role being assigned
  const requiredPermission = ROLE_ASSIGN_PERMISSION[targetRole]
  if (!requiredPermission) {
    return { error: "Cannot assign this role" }
  }

  const perms = await getEffectivePermissions(session.user.id, actorRole)
  if (!perms.has(requiredPermission)) {
    return { error: "Insufficient permissions to assign roles" }
  }

  try {
    const targetUser = await auth.api.getUser({ query: { id: userId }, headers: await headers() })
    if (targetUser) {
      const existingRole = (targetUser.role ?? "unassigned") as UserRole
      const existingLevel = ROLE_LEVELS[existingRole] ?? 0
      if (existingLevel >= actorLevel) {
        return { error: "Cannot modify a user at or above your own role level" }
      }
    }

    await auth.api.setRole({
      body: { userId, role: targetRole },
      headers: await headers(),
    })
    return { data: { role: targetRole } }
  } catch {
    return { error: "Failed to update role" }
  }
}
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/actions/__tests__/user.actions.test.ts`
Expected: PASS (or update mocks if test mocks `ROLE_LEVELS` directly)

- [ ] **Step 3: Commit**

```bash
git add src/actions/user.actions.ts
git commit -m "feat: migrate role assignment to permission-based checks"
```

---

### Task 7: Migrate UI Layout Guards and Sidebar

**Files:**
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/app/(app)/admin/layout.tsx`
- Modify: `src/app/(app)/dashboard/layout.tsx`
- Modify: `src/app/(app)/reports/layout.tsx`
- Modify: `src/app/(app)/fund-transfers/layout.tsx`

These are client components, so they can't call `getEffectivePermissions` (which does a DB query). We need to expose the user's effective permission set client-side.

- [ ] **Step 1: Create a server action to get effective permissions**

Add to `src/actions/user.actions.ts`:

```ts
export async function getEffectivePermissionsAction(): Promise<string[]> {
  const session = await getSession()
  if (!session) return []
  const role = getUserRole(session)
  const perms = await getEffectivePermissions(session.user.id, role)
  return [...perms]
}
```

- [ ] **Step 2: Create a client-side permissions hook**

Create `src/hooks/use-permissions.ts`:

```ts
"use client"

import { useSession } from "@/lib/auth-client"
import { useQuery } from "@tanstack/react-query"
import { getEffectivePermissionsAction } from "@/actions/user.actions"
import type { Permission } from "@/types"

export function usePermissions() {
  const { data: session } = useSession()
  const userId = session?.user?.id

  const { data: permissions = [] } = useQuery({
    queryKey: ["effective-permissions", userId],
    queryFn: () => getEffectivePermissionsAction(),
    enabled: !!userId,
    staleTime: 30_000, // 30 seconds
  })

  const permSet = new Set(permissions as Permission[])

  return {
    permissions: permSet,
    has: (p: Permission) => permSet.has(p),
    hasAny: (...ps: Permission[]) => ps.some((p) => permSet.has(p)),
  }
}
```

- [ ] **Step 3: Update layout guards to use usePermissions**

Replace `src/app/(app)/admin/layout.tsx`:

```tsx
"use client"

import { useRouter } from "next/navigation"
import { usePermissions } from "@/hooks/use-permissions"
import { useSession } from "@/lib/auth-client"

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isPending } = useSession()
  const { has } = usePermissions()
  const router = useRouter()

  if (isPending) return null

  if (!has("user:list")) {
    router.replace("/dashboard")
    return null
  }

  return <>{children}</>
}
```

Replace `src/app/(app)/dashboard/layout.tsx`:

```tsx
"use client"

import { useRouter } from "next/navigation"
import { usePermissions } from "@/hooks/use-permissions"
import { useSession } from "@/lib/auth-client"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isPending } = useSession()
  const { has } = usePermissions()
  const router = useRouter()

  if (isPending) return null

  if (!has("dashboard:read")) {
    router.replace("/loans")
    return null
  }

  return <>{children}</>
}
```

Replace `src/app/(app)/reports/layout.tsx`:

```tsx
"use client"

import { useRouter } from "next/navigation"
import { usePermissions } from "@/hooks/use-permissions"
import { useSession } from "@/lib/auth-client"

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  const { isPending } = useSession()
  const { has } = usePermissions()
  const router = useRouter()

  if (isPending) return null

  if (!has("reports:read")) {
    router.replace("/dashboard")
    return null
  }

  return <>{children}</>
}
```

Replace `src/app/(app)/fund-transfers/layout.tsx`:

```tsx
"use client"

import { useRouter } from "next/navigation"
import { usePermissions } from "@/hooks/use-permissions"
import { useSession } from "@/lib/auth-client"

export default function FundTransfersLayout({ children }: { children: React.ReactNode }) {
  const { isPending } = useSession()
  const { has } = usePermissions()
  const router = useRouter()

  if (isPending) return null

  if (!has("fund-transfer:read")) {
    router.replace("/loans")
    return null
  }

  return <>{children}</>
}
```

- [ ] **Step 4: Update sidebar to use usePermissions**

In `src/components/layout/sidebar.tsx`, replace the `getNavGroups` function and its usage.

Change the function signature to accept a permission checker:

```ts
function getNavGroups(has: (p: Permission) => boolean): NavGroup[] {
  const operationsItems: NavItem[] = [
    { label: "Customers", href: "/customers", icon: Users },
    { label: "Loans", href: "/loans", icon: Banknote },
    { label: "Payments", href: "/payments", icon: CreditCard },
  ]
  if (has("rate-change:approve-standard")) {
    operationsItems.push({ label: "Approvals", href: "/approvals", icon: ClipboardCheck })
  }

  const topItems: NavItem[] = []
  if (has("dashboard:read")) {
    topItems.push({ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard })
  }

  const capitalItems: NavItem[] = [
    { label: "Expenses", href: "/expenses", icon: Receipt },
  ]
  if (has("fund-transfer:read")) {
    capitalItems.push({ label: "Fund Transfers", href: "/fund-transfers", icon: ArrowRightLeft })
  }
  if (has("creditor:read")) {
    capitalItems.push({ label: "Creditors", href: "/creditors", icon: Landmark })
  }

  const systemItems: NavItem[] = []
  if (has("user:list")) {
    systemItems.push({ label: "Admin", href: "/admin", icon: Shield })
  }

  return [
    { items: topItems },
    { label: "Operations", items: operationsItems },
    { label: "Capital", items: capitalItems },
    { label: "Insights", items: [{ label: "Reports", href: "/reports", icon: BarChart3 }] },
    ...(systemItems.length > 0 ? [{ label: "System", items: systemItems }] : []),
  ]
}
```

In the `Sidebar` component, replace `getNavGroups(userRole)` with:

```ts
import { usePermissions } from "@/hooks/use-permissions"

// Inside Sidebar component:
const { has } = usePermissions()
const navGroups = getNavGroups(has)
```

Also update the prefetch logic to use `has` instead of `ROLE_LEVELS`:

```ts
// OLD
if (userLevel >= ROLE_LEVELS.supervisor) {
// NEW
if (has("dashboard:read")) {
```

- [ ] **Step 5: Commit**

```bash
git add src/actions/user.actions.ts src/hooks/use-permissions.ts src/components/layout/sidebar.tsx src/app/(app)/admin/layout.tsx src/app/(app)/dashboard/layout.tsx src/app/(app)/reports/layout.tsx src/app/(app)/fund-transfers/layout.tsx
git commit -m "feat: migrate UI guards and sidebar to permission-based checks"
```

---

### Task 8: Update Remaining UI Pages with Inline Role Checks

**Files:**
- Modify: `src/app/(app)/admin/page.tsx`
- Modify: `src/app/(app)/approvals/page.tsx`
- Modify: `src/app/(app)/creditors/page.tsx`
- Modify: `src/app/(app)/creditors/[id]/page.tsx`
- Modify: `src/app/(app)/creditors/new/page.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx`
- Modify: `src/app/(app)/payments/PaymentsClient.tsx`
- Modify: `src/app/(app)/fund-transfers/page.tsx`
- Modify: `src/app/(app)/loans/[loanId]/rate-change-dialog.tsx`
- Modify: `src/app/(app)/loans/[loanId]/loan-info-cards.tsx`
- Modify: `src/app/(app)/loans/[loanId]/loan-detail-client.tsx`
- Modify: `src/app/(app)/loans/new/_components/loan-details-step.tsx`

- [ ] **Step 1: Update each file to use usePermissions instead of ROLE_LEVELS**

For each file, the pattern is the same:

```ts
// OLD
import { ROLE_LEVELS, type UserRole } from "@/types"
const isAdmin = ROLE_LEVELS[userRole] >= ROLE_LEVELS.admin

// NEW
import { usePermissions } from "@/hooks/use-permissions"
const { has } = usePermissions()
const isAdmin = has("user:list") // or whatever permission is relevant
```

Specific mappings for each file:

**admin/page.tsx**: Keep `ROLE_LEVELS` for the role assignment dropdown filtering (`getRoleOptions` still needs hierarchy). Add `usePermissions` for the access check at the top.

**approvals/page.tsx**: Replace `ROLE_LEVELS[actorRole] >= ROLE_LEVELS[request.requiredApproverRole as UserRole]` with `has(request.requiredApproverRole as Permission)`.

**creditors/page.tsx**: Replace `ROLE_LEVELS[actorRole] >= ROLE_LEVELS.supervisor` with `has("creditor:read")`.

**creditors/[id]/page.tsx**: Replace redirect check with `has("creditor:read")`.

**creditors/new/page.tsx**: Replace `ROLE_LEVELS[actorRole] >= ROLE_LEVELS.supervisor` with `has("creditor:create")`.

**dashboard/page.tsx**: Replace `ROLE_LEVELS[userRole] >= ROLE_LEVELS.admin` with `has("settings:read")` (or relevant admin permission for what's gated).

**payments/PaymentsClient.tsx**: Replace `isAdmin` check with `has("payment:edit-any")` and `isSupervisor` with `has("payment:edit-any")`.

**fund-transfers/page.tsx**: Replace supervisor check with `has("fund-transfer:create")`.

**loans/[loanId]/rate-change-dialog.tsx**: Replace `ROLE_LEVELS[userRole] >= ROLE_LEVELS.supervisor` with `has("rate-change:approve-standard")`.

**loans/[loanId]/loan-info-cards.tsx**: Replace admin check with appropriate permission (`has("settings:update")` for override controls, `has("rate-change:create")` for rate change button).

**loans/[loanId]/loan-detail-client.tsx**: Replace supervisor check with `has("loan:settle")`.

**loans/new/_components/loan-details-step.tsx**: Replace the `ROLE_LEVELS` checks that determine minimum rate with permission checks:
```ts
// OLD
if (ROLE_LEVELS[role] >= ROLE_LEVELS.admin) return 0
if (ROLE_LEVELS[role] >= ROLE_LEVELS.supervisor) return 8

// NEW
if (has("rate-change:approve-low")) return 0
if (has("rate-change:approve-standard")) return 8
```

- [ ] **Step 2: Run the dev server and verify no TypeScript errors**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/ src/components/
git commit -m "feat: migrate all UI components from role-level to permission-based checks"
```

---

### Task 9: Build Delegation Service and Actions

**Files:**
- Create: `src/services/delegation.service.ts`
- Create: `src/actions/delegation.actions.ts`

- [ ] **Step 1: Write tests for delegation service**

Create `src/services/__tests__/delegation.service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the db module
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockFrom = vi.fn()
const mockWhere = vi.fn()
const mockLimit = vi.fn()
const mockReturning = vi.fn()
const mockValues = vi.fn()
const mockSet = vi.fn()
const mockOrderBy = vi.fn()

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: mockFrom }),
    insert: () => ({ values: mockValues }),
    update: () => ({ set: mockSet }),
  },
}))

// These are integration-level tests that verify the service signatures.
// Full integration tests should be done via Cypress E2E.

describe("delegation.service", () => {
  it("module exports expected functions", async () => {
    const mod = await import("../delegation.service")
    expect(typeof mod.createDelegation).toBe("function")
    expect(typeof mod.revokeDelegation).toBe("function")
    expect(typeof mod.getActiveDelegation).toBe("function")
    expect(typeof mod.listDelegations).toBe("function")
  })
})
```

- [ ] **Step 2: Create delegation service**

Create `src/services/delegation.service.ts`:

```ts
import { db } from "@/lib/db"
import { delegations } from "@/lib/db/schema/delegations"
import { user } from "@/lib/db/schema/auth"
import { eq, isNull, and, desc } from "drizzle-orm"

export async function createDelegation(userId: string, delegatedBy: string) {
  // Check for existing active delegation
  const [existing] = await db
    .select({ id: delegations.id })
    .from(delegations)
    .where(and(eq(delegations.userId, userId), isNull(delegations.revokedAt)))
    .limit(1)

  if (existing) {
    throw new Error("User already has an active delegation")
  }

  // Verify user is a supervisor
  const [targetUser] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId))

  if (!targetUser || targetUser.role !== "supervisor") {
    throw new Error("Only supervisors can receive delegations")
  }

  const [row] = await db
    .insert(delegations)
    .values({ userId, delegatedBy })
    .returning()

  return row
}

export async function revokeDelegation(delegationId: string, revokedBy: string) {
  const [row] = await db
    .update(delegations)
    .set({ revokedAt: new Date(), revokedBy })
    .where(and(eq(delegations.id, delegationId), isNull(delegations.revokedAt)))
    .returning()

  if (!row) {
    throw new Error("Active delegation not found")
  }

  return row
}

export async function getActiveDelegation(userId: string) {
  const [row] = await db
    .select()
    .from(delegations)
    .where(and(eq(delegations.userId, userId), isNull(delegations.revokedAt)))
    .limit(1)

  return row ?? null
}

export async function listDelegations() {
  const rows = await db
    .select({
      id: delegations.id,
      userId: delegations.userId,
      userName: user.name,
      delegatedBy: delegations.delegatedBy,
      createdAt: delegations.createdAt,
      revokedAt: delegations.revokedAt,
      revokedBy: delegations.revokedBy,
    })
    .from(delegations)
    .leftJoin(user, eq(delegations.userId, user.id))
    .orderBy(desc(delegations.createdAt))

  return rows
}
```

- [ ] **Step 3: Create delegation actions**

Create `src/actions/delegation.actions.ts`:

```ts
"use server"

import { withAction } from "@/lib/with-action"
import { revalidatePath } from "next/cache"
import {
  createDelegation,
  revokeDelegation,
  listDelegations,
} from "@/services/delegation.service"

export const createDelegationAction = withAction<{ userId: string }, any>({
  permission: "delegation:create",
  forbiddenMessage: "Only admins can create delegations",
  action: async (session, input) => {
    if (!input.userId?.trim()) {
      return { error: "User ID is required" }
    }

    try {
      const data = await createDelegation(input.userId, session.user.id)
      revalidatePath("/admin")
      return { data }
    } catch (e: any) {
      return { error: e.message ?? "Failed to create delegation" }
    }
  },
})

export const revokeDelegationAction = withAction<{ delegationId: string }, any>({
  permission: "delegation:revoke",
  forbiddenMessage: "Only admins can revoke delegations",
  action: async (session, input) => {
    if (!input.delegationId?.trim()) {
      return { error: "Delegation ID is required" }
    }

    try {
      const data = await revokeDelegation(input.delegationId, session.user.id)
      revalidatePath("/admin")
      return { data }
    } catch (e: any) {
      return { error: e.message ?? "Failed to revoke delegation" }
    }
  },
})

export const listDelegationsAction = withAction({
  permission: "delegation:read",
  action: async () => {
    try {
      const data = await listDelegations()
      return { data }
    } catch {
      return { error: "Failed to load delegations" }
    }
  },
})
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/services/__tests__/delegation.service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/delegation.service.ts src/actions/delegation.actions.ts src/services/__tests__/delegation.service.test.ts
git commit -m "feat: add delegation service and server actions"
```

---

### Task 10: Build Delegation UI in Admin Page

**Files:**
- Modify: `src/app/(app)/admin/page.tsx`

- [ ] **Step 1: Add delegation section to admin page**

In `src/app/(app)/admin/page.tsx`, add a new section below the user management table. This section should:

1. Show a "Delegations" heading
2. Show a table of active delegations with: user name, delegated by, created at, and a "Revoke" button
3. Show a collapsible history section with past delegations (revoked ones)
4. In the user table, add a "Delegate" button next to each supervisor who doesn't have an active delegation

The delegation section should use `usePermissions` to only show if the user has `delegation:read`.

Add TanStack Query hooks for fetching/mutating delegations:

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { createDelegationAction, revokeDelegationAction, listDelegationsAction } from "@/actions/delegation.actions"

// Inside the admin page component:
const { data: delegationsResult } = useQuery({
  queryKey: ["delegations"],
  queryFn: () => listDelegationsAction(),
  enabled: has("delegation:read"),
})

const delegations = delegationsResult && "data" in delegationsResult ? delegationsResult.data : []
const activeDelegations = delegations.filter((d) => !d.revokedAt)
const pastDelegations = delegations.filter((d) => d.revokedAt)
```

Add mutation hooks:

```ts
const queryClient = useQueryClient()

const delegateMutation = useMutation({
  mutationFn: (userId: string) => createDelegationAction({ userId }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["delegations"] })
    queryClient.invalidateQueries({ queryKey: ["effective-permissions"] })
  },
})

const revokeMutation = useMutation({
  mutationFn: (delegationId: string) => revokeDelegationAction({ delegationId }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["delegations"] })
    queryClient.invalidateQueries({ queryKey: ["effective-permissions"] })
  },
})
```

Render the delegation section:

```tsx
{has("delegation:read") && (
  <section className="mt-8">
    <h2 className="text-lg font-semibold mb-4">Active Delegations</h2>
    {activeDelegations.length === 0 ? (
      <p className="text-muted-foreground text-sm">No active delegations.</p>
    ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2">Supervisor</th>
            <th className="text-left py-2">Delegated By</th>
            <th className="text-left py-2">Since</th>
            <th className="text-left py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {activeDelegations.map((d) => (
            <tr key={d.id} className="border-b">
              <td className="py-2">{d.userName}</td>
              <td className="py-2">{d.delegatedBy}</td>
              <td className="py-2">{new Date(d.createdAt).toLocaleDateString()}</td>
              <td className="py-2">
                {has("delegation:revoke") && (
                  <button
                    onClick={() => revokeMutation.mutate(d.id)}
                    className="text-red-600 hover:underline text-sm"
                    disabled={revokeMutation.isPending}
                  >
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}

    {pastDelegations.length > 0 && (
      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-muted-foreground">
          Delegation History ({pastDelegations.length})
        </summary>
        <table className="w-full text-sm mt-2">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2">Supervisor</th>
              <th className="text-left py-2">Delegated By</th>
              <th className="text-left py-2">Active Period</th>
              <th className="text-left py-2">Revoked By</th>
            </tr>
          </thead>
          <tbody>
            {pastDelegations.map((d) => (
              <tr key={d.id} className="border-b">
                <td className="py-2">{d.userName}</td>
                <td className="py-2">{d.delegatedBy}</td>
                <td className="py-2">
                  {new Date(d.createdAt).toLocaleDateString()} — {d.revokedAt ? new Date(d.revokedAt).toLocaleDateString() : "—"}
                </td>
                <td className="py-2">{d.revokedBy ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    )}
  </section>
)}
```

In the user table, add a "Delegate" button for supervisors without active delegation:

```tsx
{user.role === "supervisor" && has("delegation:create") && !activeDelegations.some(d => d.userId === user.id) && (
  <button
    onClick={() => delegateMutation.mutate(user.id)}
    className="text-blue-600 hover:underline text-sm ml-2"
    disabled={delegateMutation.isPending}
  >
    Delegate
  </button>
)}
```

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/admin/page.tsx
git commit -m "feat: add delegation management UI to admin page"
```

---

### Task 11: Write Cypress E2E Tests for Permission System and Delegation

**Files:**
- Create: `cypress/e2e/permissions-delegation.cy.ts`

- [ ] **Step 1: Write E2E tests**

Create `cypress/e2e/permissions-delegation.cy.ts`:

```ts
describe("Permission System & Delegation", () => {
  describe("Role-based page access", () => {
    it("loan officer cannot access dashboard", () => {
      cy.loginAs("loanOfficer")
      cy.visit("/dashboard")
      cy.url().should("include", "/loans")
    })

    it("supervisor can access dashboard", () => {
      cy.loginAs("supervisor")
      cy.visit("/dashboard")
      cy.url().should("include", "/dashboard")
    })

    it("supervisor cannot access admin page", () => {
      cy.loginAs("supervisor")
      cy.visit("/admin")
      cy.url().should("include", "/dashboard")
    })

    it("admin can access admin page", () => {
      cy.loginAs("admin")
      cy.visit("/admin")
      cy.url().should("include", "/admin")
    })
  })

  describe("Sidebar visibility", () => {
    it("loan officer sees operations but not dashboard or admin", () => {
      cy.loginAs("loanOfficer")
      cy.visit("/loans")
      cy.get("nav").should("contain", "Loans")
      cy.get("nav").should("contain", "Payments")
      cy.get("nav").should("not.contain", "Dashboard")
      cy.get("nav").should("not.contain", "Admin")
    })

    it("supervisor sees dashboard and approvals", () => {
      cy.loginAs("supervisor")
      cy.visit("/dashboard")
      cy.get("nav").should("contain", "Dashboard")
      cy.get("nav").should("contain", "Approvals")
      cy.get("nav").should("contain", "Creditors")
    })
  })

  describe("Delegation flow", () => {
    it("admin can delegate to supervisor and revoke", () => {
      cy.loginAs("admin")
      cy.visit("/admin")

      // Find a supervisor and delegate
      cy.contains("Delegate").first().click()
      cy.contains("Active Delegations").should("be.visible")

      // Revoke the delegation
      cy.contains("Revoke").first().click()
      cy.contains("No active delegations").should("be.visible")
    })

    it("delegated supervisor gains elevated permissions", () => {
      // Admin delegates to supervisor
      cy.loginAs("admin")
      cy.visit("/admin")
      cy.contains("Delegate").first().click()

      // Switch to delegated supervisor
      cy.loginAs("supervisor")
      cy.visit("/admin")
      // Delegated supervisor should be able to see settings
      // (exact assertions depend on what the elevated permissions expose in UI)
    })
  })
})
```

- [ ] **Step 2: Run the E2E tests**

Run: `npx cypress run --spec cypress/e2e/permissions-delegation.cy.ts`
Expected: Tests pass (or fix issues and re-run).

- [ ] **Step 3: Commit**

```bash
git add cypress/e2e/permissions-delegation.cy.ts
git commit -m "test: add E2E tests for permission system and delegation"
```

---

### Task 12: Clean Up and Push Schema

- [ ] **Step 1: Remove unused ROLE_LEVELS imports**

Search for any remaining `ROLE_LEVELS` imports in action files and UI components that were migrated. Remove unused imports. Keep `ROLE_LEVELS` in:
- `src/types/common.ts` (definition)
- `src/lib/action-utils.ts` (still used by `requireRole` for role assignment hierarchy)
- `src/actions/user.actions.ts` (role assignment level guard)
- `src/app/(app)/admin/page.tsx` (role dropdown filtering)

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Push schema to production**

Run: `npx drizzle-kit push` (against production database)
Expected: `delegation` table created in production.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: clean up unused role-level imports after permission migration"
```
