# Activity Monitoring System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a role-based activity monitoring system so supervisors and admins can view what their subordinates have done in the system, with a dedicated activities page and a simplified dashboard widget.

**Architecture:** Reuse the existing `audit_log` table as the data source. Add a new `activity.service.ts` that queries with role-based filtering, a new `/activities` page with table view and filters, and simplify the dashboard activity feed to 3 capped items.

**Tech Stack:** Drizzle ORM, Effect-TS, Next.js Server Actions, TanStack Query, Tailwind CSS, shadcn/ui components

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/types/common.ts` | Add `"activity:read"` to Permission union |
| Modify | `src/lib/permissions.ts` | Add `"activity:read"` to PERMISSIONS array and supervisor+ role sets |
| Modify | `src/lib/db/schema/audit.ts` | Add index on `actorId` |
| Create | `src/types/activity.ts` | ActivityItem type definition |
| Create | `src/services/activity.service.ts` | getActivities query with role filtering, description formatter, link generator |
| Create | `src/services/__tests__/activity.service.test.ts` | Unit tests for description formatter and link generator |
| Create | `src/actions/activity.actions.ts` | getActivitiesAction server action |
| Create | `src/actions/__tests__/activity.actions.test.ts` | Action tests (auth, permission, success, error) |
| Create | `src/hooks/use-activities.ts` | TanStack Query hook for activities list |
| Modify | `src/hooks/query-keys.ts` | Add activities query keys |
| Create | `src/app/(app)/activities/page.tsx` | Page wrapper with Suspense |
| Create | `src/app/(app)/activities/ActivitiesClient.tsx` | Client component with table, filters, pagination |
| Modify | `src/components/layout/sidebar.tsx` | Add Activities nav item for supervisor+ |
| Modify | `src/app/(app)/dashboard/page.tsx` | Replace infinite scroll with 3-item capped card |
| Modify | `src/actions/dashboard.actions.ts` | Simplify getRecentActivityAction |

---

### Task 1: Add `activity:read` Permission

**Files:**
- Modify: `src/types/common.ts`
- Modify: `src/lib/permissions.ts`

- [ ] **Step 1: Add `activity:read` to the Permission type**

In `src/types/common.ts`, add `"activity:read"` to the Permission union after the delegation permissions:

```typescript
  // delegation
  | "delegation:create" | "delegation:revoke" | "delegation:read"
  // activity monitoring
  | "activity:read"
  // roles
  | "role:assign-loan-officer" | "role:assign-supervisor" | "role:assign-admin" | "role:assign-super-admin"
```

- [ ] **Step 2: Add `activity:read` to the PERMISSIONS array and role mappings**

In `src/lib/permissions.ts`, add `"activity:read"` to the `PERMISSIONS` array after `"delegation:read"`:

```typescript
  // delegation
  "delegation:create", "delegation:revoke", "delegation:read",
  // activity monitoring
  "activity:read",
  // roles
```

Add `"activity:read"` to `supervisorExtras` (this cascades to admin and superAdmin automatically):

```typescript
const supervisorExtras: Permission[] = [
  "loan:disburse", "loan:rollover", "loan:settle",
  "backdate:beyond-3-days",
  "rate-change:approve-standard",
  "dashboard:read",
  "role:assign-loan-officer",
  "creditor:read", "creditor:create", "creditor:update",
  "payment:edit-any", "payment:delete-any",
  "activity:read",
]
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors related to `activity:read`.

- [ ] **Step 4: Commit**

```bash
git add src/types/common.ts src/lib/permissions.ts
git commit -m "feat: add activity:read permission for supervisor+"
```

---

### Task 2: Add Index on `audit_log.actorId`

**Files:**
- Modify: `src/lib/db/schema/audit.ts`

- [ ] **Step 1: Add the actorId index**

In `src/lib/db/schema/audit.ts`, add a new index to the table definition:

```typescript
import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core"
import { user } from "./auth"

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: text("actor_id").notNull().references(() => user.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  beforeValue: text("before_value"),
  afterValue: text("after_value"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_audit_entity_type").on(table.entityType),
  index("idx_audit_occurred_at").on(table.occurredAt),
  index("idx_audit_actor_id").on(table.actorId),
])
```

- [ ] **Step 2: Push schema to database**

Run: `npx drizzle-kit push`
Expected: Index `idx_audit_actor_id` created successfully.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/schema/audit.ts
git commit -m "feat: add actorId index on audit_log for activity queries"
```

---

### Task 3: Define ActivityItem Type

**Files:**
- Create: `src/types/activity.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Create the ActivityItem type**

Create `src/types/activity.ts`:

```typescript
export interface ActivityItem {
  id: string
  actorName: string
  actorRole: string
  action: string
  entityType: string
  entityId: string
  description: string
  href: string | null
  occurredAt: Date
}

export interface GetActivitiesInput {
  actorId?: string
  entityType?: string
  dateFrom?: string
  dateTo?: string
  page: number
  pageSize: number
}

export interface GetActivitiesResult {
  items: ActivityItem[]
  total: number
}
```

- [ ] **Step 2: Add barrel export**

In `src/types/index.ts`, add the export:

```typescript
export * from "./activity"
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/activity.ts src/types/index.ts
git commit -m "feat: add ActivityItem and GetActivitiesInput types"
```

---

### Task 4: Create Activity Service — Description Formatter and Link Generator

**Files:**
- Create: `src/services/activity.service.ts`
- Create: `src/services/__tests__/activity.service.test.ts`

- [ ] **Step 1: Write tests for formatActivityDescription**

Create `src/services/__tests__/activity.service.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { formatActivityDescription, getActivityHref } from "../activity.service"

describe("formatActivityDescription", () => {
  it("formats loan.create with customer name and amount", () => {
    const result = formatActivityDescription("loan.create", "loan", null, {
      principalAmount: "500000",
      customerId: "c1",
    }, new Map([["c1", "John Mukasa"]]))
    expect(result).toBe("Loan issued to John Mukasa — UGX 500,000")
  })

  it("formats loan.create without customer name", () => {
    const result = formatActivityDescription("loan.create", "loan", null, {
      principalAmount: "500000",
      customerId: "c1",
    }, new Map())
    expect(result).toBe("Loan issued — UGX 500,000")
  })

  it("formats payment.create with amount", () => {
    const result = formatActivityDescription("payment.create", "payment", null, {
      amount: "50000",
    }, new Map())
    expect(result).toBe("Payment received — UGX 50,000")
  })

  it("formats customer.create with full name", () => {
    const result = formatActivityDescription("customer.create", "customer", null, {
      fullName: "Grace Atim",
    }, new Map())
    expect(result).toBe("Customer Grace Atim created")
  })

  it("formats customer.update with full name", () => {
    const result = formatActivityDescription("customer.update", "customer", null, {
      fullName: "Grace Atim",
    }, new Map())
    expect(result).toBe("Customer Grace Atim updated")
  })

  it("formats creditor.create with name", () => {
    const result = formatActivityDescription("creditor.create", "creditor", null, {
      name: "ABC Finance",
    }, new Map())
    expect(result).toBe("Creditor ABC Finance added")
  })

  it("formats fund_transfer.create with amount", () => {
    const result = formatActivityDescription("fund_transfer.create", "fund_transfer", null, {
      amount: "1000000",
    }, new Map())
    expect(result).toBe("Fund transfer — UGX 1,000,000")
  })

  it("formats loan.rollover with carried amount", () => {
    const result = formatActivityDescription("loan.rollover", "loan", {
      customerId: "c1",
    }, {
      carriedPrincipal: "400000",
      carriedInterest: "100000",
    }, new Map([["c1", "John Mukasa"]]))
    expect(result).toBe("Loan rolled over for John Mukasa — UGX 500,000")
  })

  it("formats loan.disburse", () => {
    const result = formatActivityDescription("loan.disburse", "loan", null, {}, new Map())
    expect(result).toBe("Loan disbursed")
  })

  it("formats loan.settle_with_collateral", () => {
    const result = formatActivityDescription("loan.settle_with_collateral", "loan", null, {}, new Map())
    expect(result).toBe("Loan settled with collateral")
  })

  it("formats loan.rate_change.approved", () => {
    const result = formatActivityDescription("loan.rate_change.approved", "loan", null, {}, new Map())
    expect(result).toBe("Loan rate change approved")
  })

  it("formats loan.rate_change.rejected", () => {
    const result = formatActivityDescription("loan.rate_change.rejected", "loan", null, {}, new Map())
    expect(result).toBe("Loan rate change rejected")
  })

  it("formats loan.rate_change.immediate", () => {
    const result = formatActivityDescription("loan.rate_change.immediate", "loan", null, {}, new Map())
    expect(result).toBe("Loan rate changed")
  })

  it("formats payment.delete", () => {
    const result = formatActivityDescription("payment.delete", "payment", null, {}, new Map())
    expect(result).toBe("Payment deleted")
  })

  it("formats payment.update", () => {
    const result = formatActivityDescription("payment.update", "payment", null, {}, new Map())
    expect(result).toBe("Payment updated")
  })

  it("formats loan.update", () => {
    const result = formatActivityDescription("loan.update", "loan", null, {}, new Map())
    expect(result).toBe("Loan details updated")
  })

  it("formats loan.delete", () => {
    const result = formatActivityDescription("loan.delete", "loan", null, {}, new Map())
    expect(result).toBe("Loan deleted")
  })

  it("falls back to entityType + action for unknown actions", () => {
    const result = formatActivityDescription("some.unknown", "widget", null, {}, new Map())
    expect(result).toBe("widget some.unknown")
  })
})

describe("getActivityHref", () => {
  it("returns loan detail path", () => {
    expect(getActivityHref("loan", "loan-123", null)).toBe("/loans/loan-123")
  })

  it("returns loan path for payment with loanId in afterValue", () => {
    expect(getActivityHref("payment", "pay-1", { loanId: "loan-456" })).toBe("/loans/loan-456")
  })

  it("returns null for payment without loanId", () => {
    expect(getActivityHref("payment", "pay-1", null)).toBeNull()
  })

  it("returns customer detail path", () => {
    expect(getActivityHref("customer", "cust-1", null)).toBe("/customers/cust-1")
  })

  it("returns creditor detail path", () => {
    expect(getActivityHref("creditor", "cred-1", null)).toBe("/creditors/cred-1")
  })

  it("returns null for unknown entity types", () => {
    expect(getActivityHref("transaction", "tx-1", null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/__tests__/activity.service.test.ts 2>&1 | tail -20`
Expected: FAIL — `../activity.service` cannot resolve `formatActivityDescription` or `getActivityHref`.

- [ ] **Step 3: Implement formatActivityDescription and getActivityHref**

Create `src/services/activity.service.ts`:

```typescript
import { Effect } from "effect"
import { db } from "@/lib/db"
import { auditLog } from "@/lib/db/schema/audit"
import { user } from "@/lib/db/schema/auth"
import { customers } from "@/lib/db/schema/customers"
import { eq, desc, and, inArray, gte, lte, sql } from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import { ROLE_LEVELS } from "@/types/common"
import type { UserRole } from "@/types/common"
import type { ActivityItem, GetActivitiesInput, GetActivitiesResult } from "@/types/activity"
import BigNumber from "bignumber.js"

// ─── Formatting helpers ───

function formatAmount(amount: string | number | undefined): string {
  if (amount === undefined || amount === null) return "?"
  const str = String(typeof amount === "number" ? amount : parseFloat(String(amount)))
  const [int, dec] = str.split(".")
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return dec ? `${withCommas}.${dec}` : withCommas
}

export function formatActivityDescription(
  action: string,
  entityType: string,
  beforeValue: Record<string, unknown> | null,
  afterValue: Record<string, unknown> | null,
  customerNameMap: Map<string, string>,
): string {
  const after = afterValue ?? {}
  const before = beforeValue ?? {}

  if (entityType === "loan") {
    if (action === "loan.create") {
      const amount = formatAmount(after.principalAmount as string | undefined)
      const customerId = after.customerId as string | undefined
      const customerName = customerId ? customerNameMap.get(customerId) : undefined
      return customerName
        ? `Loan issued to ${customerName} — UGX ${amount}`
        : `Loan issued — UGX ${amount}`
    }
    if (action === "loan.rollover") {
      const customerId = (before.customerId ?? after.customerId) as string | undefined
      const customerName = customerId ? customerNameMap.get(customerId) : undefined
      const carried = new BigNumber(String(after.carriedPrincipal ?? "0"))
        .plus(new BigNumber(String(after.carriedInterest ?? "0")))
      const amount = formatAmount(carried.toFixed(0))
      return customerName
        ? `Loan rolled over for ${customerName} — UGX ${amount}`
        : `Loan rolled over — UGX ${amount}`
    }
    if (action === "loan.disburse") return "Loan disbursed"
    if (action === "loan.update") return "Loan details updated"
    if (action === "loan.delete") return "Loan deleted"
    if (action === "loan.rate_change.immediate") return "Loan rate changed"
    if (action === "loan.rate_change.approved") return "Loan rate change approved"
    if (action === "loan.rate_change.rejected") return "Loan rate change rejected"
    if (action === "loan.settle_with_collateral") return "Loan settled with collateral"
  }

  if (entityType === "payment") {
    if (action === "payment.create") {
      const amount = formatAmount(after.amount as string | undefined)
      return `Payment received — UGX ${amount}`
    }
    if (action === "payment.update") return "Payment updated"
    if (action === "payment.delete") return "Payment deleted"
  }

  if (entityType === "customer") {
    const name = (after.fullName ?? before.fullName ?? "") as string
    if (action === "customer.create") return name ? `Customer ${name} created` : "Customer created"
    if (action === "customer.update") return name ? `Customer ${name} updated` : "Customer updated"
    if (action === "customer.delete") return name ? `Customer ${name} deleted` : "Customer deleted"
  }

  if (entityType === "creditor") {
    const name = (after.name ?? before.name ?? "") as string
    if (action === "creditor.create") return name ? `Creditor ${name} added` : "Creditor added"
    if (action === "creditor.update") return name ? `Creditor ${name} updated` : "Creditor updated"
    if (action === "creditor.delete") return name ? `Creditor ${name} deleted` : "Creditor deleted"
  }

  if (entityType === "fund_transfer") {
    if (action === "fund_transfer.create") {
      const amount = formatAmount(after.amount as string | undefined)
      return `Fund transfer — UGX ${amount}`
    }
  }

  return `${entityType} ${action}`
}

export function getActivityHref(
  entityType: string,
  entityId: string,
  afterValue: Record<string, unknown> | null,
): string | null {
  if (entityType === "loan") return `/loans/${entityId}`
  if (entityType === "payment") {
    const loanId = afterValue?.loanId as string | undefined
    return loanId ? `/loans/${loanId}` : null
  }
  if (entityType === "customer") return `/customers/${entityId}`
  if (entityType === "creditor") return `/creditors/${entityId}`
  return null
}

// ─── Visible roles for a given viewer role ───

function getVisibleRoles(viewerRole: UserRole): UserRole[] {
  const viewerLevel = ROLE_LEVELS[viewerRole] ?? 0
  return (Object.entries(ROLE_LEVELS) as [UserRole, number][])
    .filter(([, level]) => level > 0 && level < viewerLevel)
    .map(([role]) => role)
}

// ─── Main query ───

export const getActivities = (
  input: GetActivitiesInput & { viewerRole: UserRole },
): Effect.Effect<GetActivitiesResult, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const { actorId, entityType, dateFrom, dateTo, page, pageSize, viewerRole } = input
      const visibleRoles = getVisibleRoles(viewerRole)

      if (visibleRoles.length === 0) {
        return { items: [], total: 0 }
      }

      // Build conditions
      const conditions = [inArray(user.role, visibleRoles)]
      if (actorId) conditions.push(eq(auditLog.actorId, actorId))
      if (entityType) conditions.push(eq(auditLog.entityType, entityType))
      if (dateFrom) conditions.push(gte(auditLog.occurredAt, new Date(dateFrom)))
      if (dateTo) {
        const endOfDay = new Date(dateTo)
        endOfDay.setHours(23, 59, 59, 999)
        conditions.push(lte(auditLog.occurredAt, endOfDay))
      }

      const where = and(...conditions)

      // Count
      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(auditLog)
        .innerJoin(user, eq(auditLog.actorId, user.id))
        .where(where)
      const total = Number(countResult?.count ?? 0)

      if (total === 0) {
        return { items: [], total: 0 }
      }

      // Fetch page
      const rows = await db
        .select({
          id: auditLog.id,
          actorId: auditLog.actorId,
          actorName: user.name,
          actorRole: user.role,
          action: auditLog.action,
          entityType: auditLog.entityType,
          entityId: auditLog.entityId,
          beforeValue: auditLog.beforeValue,
          afterValue: auditLog.afterValue,
          occurredAt: auditLog.occurredAt,
        })
        .from(auditLog)
        .innerJoin(user, eq(auditLog.actorId, user.id))
        .where(where)
        .orderBy(desc(auditLog.occurredAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize)

      // Pre-fetch customer names for loan entries
      const customerIdsToFetch = new Set<string>()
      for (const row of rows) {
        if (row.entityType === "loan") {
          const afterVal = row.afterValue ? JSON.parse(row.afterValue) : {}
          const beforeVal = row.beforeValue ? JSON.parse(row.beforeValue) : {}
          if (afterVal.customerId) customerIdsToFetch.add(afterVal.customerId)
          if (beforeVal.customerId) customerIdsToFetch.add(beforeVal.customerId)
        }
      }
      const customerNameMap = new Map<string, string>()
      if (customerIdsToFetch.size > 0) {
        const customerRows = await db
          .select({ id: customers.id, fullName: customers.fullName })
          .from(customers)
          .where(inArray(customers.id, [...customerIdsToFetch]))
        for (const row of customerRows) {
          customerNameMap.set(row.id, row.fullName)
        }
      }

      // Map to ActivityItem
      const items: ActivityItem[] = rows.map((row) => {
        const beforeVal = row.beforeValue ? JSON.parse(row.beforeValue) : null
        const afterVal = row.afterValue ? JSON.parse(row.afterValue) : null
        return {
          id: row.id,
          actorName: row.actorName,
          actorRole: row.actorRole ?? "unassigned",
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          description: formatActivityDescription(row.action, row.entityType, beforeVal, afterVal, customerNameMap),
          href: getActivityHref(row.entityType, row.entityId, afterVal),
          occurredAt: row.occurredAt,
        }
      })

      return { items, total }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/__tests__/activity.service.test.ts 2>&1 | tail -20`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/activity.service.ts src/services/__tests__/activity.service.test.ts
git commit -m "feat: add activity service with description formatter and link generator"
```

---

### Task 5: Create Activity Server Action

**Files:**
- Create: `src/actions/activity.actions.ts`
- Create: `src/actions/__tests__/activity.actions.test.ts`

- [ ] **Step 1: Write tests for the activity action**

Create `src/actions/__tests__/activity.actions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// ---------- Mocks ----------

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
  checkPermission: vi.fn().mockResolvedValue(null),
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
}))

vi.mock("@/services/activity.service", () => ({
  getActivities: vi.fn(),
}))

// ---------- Imports ----------

import { getSession } from "@/lib/action-utils"
import { getActivities } from "@/services/activity.service"
import { DatabaseError } from "@/lib/errors"
import { getActivitiesAction } from "../activity.actions"
import { fakeSession, supervisorSession, loanOfficerSession } from "./test-utils"

const mockGetSession = vi.mocked(getSession)
const mockGetActivities = vi.mocked(getActivities)

// ---------- Tests ----------

describe("Activity Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("getActivitiesAction", () => {
    const validInput = { page: 1, pageSize: 25 }

    it("returns error when not authenticated", async () => {
      mockGetSession.mockResolvedValue(null)
      const result = await getActivitiesAction(validInput)
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns activities on success", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      const activities = { items: [{ id: "a1", description: "Test" }], total: 1 }
      mockGetActivities.mockReturnValue(Effect.succeed(activities) as any)

      const result = await getActivitiesAction(validInput)

      expect(result).toEqual({ data: activities })
      expect(mockGetActivities).toHaveBeenCalledWith({
        ...validInput,
        viewerRole: "admin",
      })
    })

    it("passes filters through to service", async () => {
      mockGetSession.mockResolvedValue(supervisorSession)
      const inputWithFilters = {
        page: 1,
        pageSize: 25,
        actorId: "u3",
        entityType: "loan",
        dateFrom: "2026-04-01",
        dateTo: "2026-04-13",
      }
      mockGetActivities.mockReturnValue(Effect.succeed({ items: [], total: 0 }) as any)

      await getActivitiesAction(inputWithFilters)

      expect(mockGetActivities).toHaveBeenCalledWith({
        ...inputWithFilters,
        viewerRole: "supervisor",
      })
    })

    it("returns database error when service fails", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetActivities.mockReturnValue(
        Effect.fail(new DatabaseError({ cause: "db down" })) as any,
      )
      const result = await getActivitiesAction(validInput)
      expect(result).toEqual({ error: "Database error" })
    })

    it("returns generic error for unknown failures", async () => {
      mockGetSession.mockResolvedValue(fakeSession)
      mockGetActivities.mockReturnValue(Effect.fail(new Error("unknown")) as any)
      const result = await getActivitiesAction(validInput)
      expect(result).toEqual({ error: "Internal server error" })
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/actions/__tests__/activity.actions.test.ts 2>&1 | tail -20`
Expected: FAIL — `../activity.actions` not found.

- [ ] **Step 3: Implement the activity action**

Create `src/actions/activity.actions.ts`:

```typescript
"use server"

import { withAction } from "@/lib/with-action"
import { getActivities } from "@/services/activity.service"
import type { GetActivitiesInput } from "@/types/activity"

export const getActivitiesAction = withAction<GetActivitiesInput, any>({
  permission: "activity:read",
  effect: (session, input) =>
    getActivities({ ...input, viewerRole: (session.user as any).role ?? "unassigned" }),
  errors: { DatabaseError: "Database error" },
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/actions/__tests__/activity.actions.test.ts 2>&1 | tail -20`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/actions/activity.actions.ts src/actions/__tests__/activity.actions.test.ts
git commit -m "feat: add getActivitiesAction server action"
```

---

### Task 6: Add Activities Query Keys and Hook

**Files:**
- Modify: `src/hooks/query-keys.ts`
- Create: `src/hooks/use-activities.ts`

- [ ] **Step 1: Add activities query keys**

In `src/hooks/query-keys.ts`, add an `activities` section to the `queryKeys` object (add it before the closing `} as const`):

```typescript
  activities: {
    all: ["activities"] as const,
    list: (params: Record<string, string>, page: number) =>
      [...queryKeys.activities.all, params, page] as const,
  },
```

- [ ] **Step 2: Create the useActivities hook**

Create `src/hooks/use-activities.ts`:

```typescript
"use client"

import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { getActivitiesAction } from "@/actions/activity.actions"
import { queryKeys } from "./query-keys"
import { unwrapAction } from "./query-utils"
import type { GetActivitiesResult } from "@/types/activity"

const PAGE_SIZE = 25

export type ActivityFilterParams = {
  actorId: string
  entityType: string
  dateFrom: string
  dateTo: string
}

export function useActivities(
  params: ActivityFilterParams,
  page: number,
  enabled = true,
) {
  return useQuery<GetActivitiesResult>({
    queryKey: queryKeys.activities.list(params, page),
    queryFn: async () => {
      const input = {
        page,
        pageSize: PAGE_SIZE,
        ...(params.actorId ? { actorId: params.actorId } : {}),
        ...(params.entityType ? { entityType: params.entityType } : {}),
        ...(params.dateFrom ? { dateFrom: params.dateFrom } : {}),
        ...(params.dateTo ? { dateTo: params.dateTo } : {}),
      }
      const result = await getActivitiesAction(input)
      return unwrapAction(result as { data: GetActivitiesResult } | { error: string })
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    enabled,
  })
}

export { PAGE_SIZE as ACTIVITIES_PAGE_SIZE }
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/query-keys.ts src/hooks/use-activities.ts
git commit -m "feat: add activities query keys and useActivities hook"
```

---

### Task 7: Create Activities Page

**Files:**
- Create: `src/app/(app)/activities/page.tsx`
- Create: `src/app/(app)/activities/ActivitiesClient.tsx`

- [ ] **Step 1: Create the page wrapper**

Create `src/app/(app)/activities/page.tsx`:

```typescript
"use client"

import { Suspense } from "react"
import { ActivitiesClient } from "./ActivitiesClient"

export default function ActivitiesPage() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <Suspense fallback={<div className="space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="h-12 rounded-md bg-muted-foreground/10 animate-pulse" />)}</div>}>
        <ActivitiesClient />
      </Suspense>
    </div>
  )
}
```

- [ ] **Step 2: Create the ActivitiesClient component**

Create `src/app/(app)/activities/ActivitiesClient.tsx`:

```typescript
"use client"

import { ExternalLink } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { useUrlFilters } from "@/hooks/use-url-filters"
import { useActivities, ACTIVITIES_PAGE_SIZE } from "@/hooks/use-activities"
import { useAdminUsers } from "@/hooks/use-admin-users"
import { usePermissions } from "@/hooks/use-permissions"
import { formatRelativeTime, formatDate } from "@/lib/utils"
import type { ActivityItem } from "@/types/activity"

const ENTITY_TYPES = [
  { value: "", label: "All types" },
  { value: "loan", label: "Loan" },
  { value: "payment", label: "Payment" },
  { value: "customer", label: "Customer" },
  { value: "creditor", label: "Creditor" },
  { value: "fund_transfer", label: "Fund Transfer" },
  { value: "rate_change_request", label: "Rate Change" },
  { value: "collateral_settlement", label: "Settlement" },
  { value: "transaction_category", label: "Category" },
  { value: "transaction", label: "Transaction" },
]

const ACTION_BADGE_COLORS: Record<string, string> = {
  loan: "bg-indigo-500/15 text-indigo-400",
  payment: "bg-green-500/15 text-green-400",
  customer: "bg-amber-500/15 text-amber-400",
  creditor: "bg-blue-500/15 text-blue-400",
  fund_transfer: "bg-purple-500/15 text-purple-400",
  rate_change_request: "bg-rose-500/15 text-rose-400",
  collateral_settlement: "bg-orange-500/15 text-orange-400",
}

function ActionBadge({ action, entityType }: { action: string; entityType: string }) {
  const colors = ACTION_BADGE_COLORS[entityType] ?? "bg-muted text-muted-foreground"
  const label = action.split(".").pop() ?? action
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors}`}>
      {label}
    </span>
  )
}

function formatTime(date: Date): string {
  const now = new Date()
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()

  if (isToday) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
  }
  return formatDate(date) + " " + date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
}

export function ActivitiesClient() {
  const { has } = usePermissions()
  const { filters, page, setFilter, clearFilters, setPage, hasFilters, activeFilterCount } =
    useUrlFilters({
      basePath: "/activities",
      defaults: { actorId: "", entityType: "", dateFrom: "", dateTo: "" },
    })

  const { data, isLoading } = useActivities(filters, page)
  const { data: users } = useAdminUsers(has("activity:read"))

  const items = data?.items ?? []
  const total = data?.total ?? 0

  const columns: Column<ActivityItem>[] = [
    {
      key: "time",
      header: "Time",
      primary: true,
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
          {formatTime(new Date(row.occurredAt))}
        </span>
      ),
    },
    {
      key: "user",
      header: "User",
      render: (row) => <span>{row.actorName}</span>,
    },
    {
      key: "action",
      header: "Action",
      render: (row) => <ActionBadge action={row.action} entityType={row.entityType} />,
    },
    {
      key: "description",
      header: "Details",
      render: (row) => <span className="text-sm">{row.description}</span>,
    },
    {
      key: "link",
      header: "",
      align: "right",
      hideInCard: true,
      render: (row) =>
        row.href ? (
          <Link
            href={row.href}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="View details"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        ) : null,
    },
  ]

  return (
    <>
      <PageHeader title="Activities" subtitle="Monitor team activity across the system" />

      <FilterPanel activeCount={activeFilterCount}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <Label htmlFor="actorId" className="text-xs mb-1 block">User</Label>
            <Select value={filters.actorId} onValueChange={(v) => setFilter("actorId", v)}>
              <SelectTrigger id="actorId">
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All users</SelectItem>
                {(users ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="entityType" className="text-xs mb-1 block">Entity Type</Label>
            <Select value={filters.entityType} onValueChange={(v) => setFilter("entityType", v)}>
              <SelectTrigger id="entityType">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="dateFrom" className="text-xs mb-1 block">From</Label>
            <Input
              id="dateFrom"
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilter("dateFrom", e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="dateTo" className="text-xs mb-1 block">To</Label>
            <Input
              id="dateTo"
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilter("dateTo", e.target.value)}
            />
          </div>
        </div>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="mt-2">
            Clear filters
          </Button>
        )}
      </FilterPanel>

      <ResponsiveTable
        columns={columns}
        rows={items}
        getRowKey={(row) => row.id}
        emptyState={
          <p className="text-muted-foreground text-center py-8">
            {hasFilters
              ? "No activities found. Try adjusting your filters."
              : "No team activity recorded yet."}
          </p>
        }
      />

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm text-muted-foreground">
            Showing {(page - 1) * ACTIVITIES_PAGE_SIZE + 1}–{Math.min(page * ACTIVITIES_PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page * ACTIVITIES_PAGE_SIZE >= total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors related to activities.

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/activities/
git commit -m "feat: add /activities page with table, filters, and pagination"
```

---

### Task 8: Add Activities to Sidebar Navigation

**Files:**
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Add the Activity icon import**

In `src/components/layout/sidebar.tsx`, add `Activity` to the lucide-react import:

```typescript
import {
  LayoutDashboard,
  Users,
  Banknote,
  CreditCard,
  Landmark,
  Receipt,
  BarChart3,
  Shield,
  LogOut,
  ClipboardCheck,
  ArrowRightLeft,
  Activity,
} from "lucide-react"
```

- [ ] **Step 2: Add Activities nav item to the Insights group**

In the `getNavGroups` function, change the Insights group to conditionally include Activities:

Find the line:

```typescript
    { label: "Insights", items: [{ label: "Reports", href: "/reports", icon: BarChart3 }] },
```

Replace with:

```typescript
    { label: "Insights", items: [
      { label: "Reports", href: "/reports", icon: BarChart3 },
      ...(has("activity:read") ? [{ label: "Activities", href: "/activities", icon: Activity }] : []),
    ] },
```

- [ ] **Step 3: Add prefetch for activities page**

In the sidebar's prefetch section (search for the block that calls `prefetchQueue.add`), add an entry for the activities page. Find a nearby prefetch block and add:

```typescript
if (has("activity:read")) {
  prefetchQueue.add(
    queryKeys.activities.list({ actorId: "", entityType: "", dateFrom: "", dateTo: "" }, 1),
    () => getActivitiesAction({ page: 1, pageSize: 25 }).then((r) => ("data" in r ? r.data : Promise.reject(r.error))),
    Priority.LOW,
  )
}
```

Also add the import at the top:

```typescript
import { getActivitiesAction } from "@/actions/activity.actions"
```

And ensure `queryKeys.activities` is available (it should be from the earlier query-keys modification).

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "feat: add Activities nav item to sidebar for supervisor+"
```

---

### Task 9: Simplify Dashboard Activity Feed

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`
- Modify: `src/actions/dashboard.actions.ts`

- [ ] **Step 1: Update dashboard.actions.ts to use activity service for subordinate view**

Replace `src/actions/dashboard.actions.ts` with:

```typescript
"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import { getDashboardKPIs, getRecentActivity } from "@/services/dashboard.service"
import { getActivities } from "@/services/activity.service"
import type { UserRole } from "@/types/common"

export const getDashboardAction = withAction({
  permission: "dashboard:read",
  effect: () => Effect.map(getDashboardKPIs(), (kpis) => ({ kpis })),
  errors: { DatabaseError: "Database error" },
})

export const getDashboardActivityAction = withAction({
  permission: "dashboard:read",
  effect: (session) => {
    const role = (session.user as any).role as UserRole | undefined
    const hasActivityRead = role === "supervisor" || role === "admin" || role === "superAdmin"

    if (hasActivityRead) {
      return getActivities({ page: 1, pageSize: 3, viewerRole: role! })
    }
    // Loan officers see general recent activity (current behavior)
    return getRecentActivity(1, 3)
  },
  errors: { DatabaseError: "Database error" },
})

// Keep old action for backwards compat during transition
export async function getRecentActivityAction(page = 1, pageSize = 10) {
  return getRecentActivityWrapped({ page, pageSize })
}

const getRecentActivityWrapped = withAction<{ page: number; pageSize: number }, any>({
  permission: "dashboard:read",
  effect: (_session, { page, pageSize }) => getRecentActivity(page, pageSize),
  errors: { DatabaseError: "Database error" },
})
```

- [ ] **Step 2: Replace the dashboard activity feed**

In `src/app/(app)/dashboard/page.tsx`, make the following changes:

**Replace the imports** — remove the infinite query imports and add the new ones. Change:

```typescript
import { useEffect, useRef, useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { Banknote, CreditCard, TrendingUp, Users, AlertTriangle, Landmark, CreditCard as PaymentIcon, ChevronDown, ChevronUp, Loader2, ExternalLink } from "lucide-react"
```

To:

```typescript
import { Banknote, CreditCard, TrendingUp, Users, AlertTriangle, Landmark, ExternalLink } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
```

**Replace the activity action import:**

```typescript
import { getRecentActivityAction } from "@/actions/dashboard.actions"
```

To:

```typescript
import { getDashboardActivityAction } from "@/actions/dashboard.actions"
```

**Remove these lines/blocks** from inside the `DashboardPage` component:

1. Remove `const [expandedId, setExpandedId] = useState<string | null>(null)`
2. Remove the entire `useInfiniteQuery` block (the `activityData`, `fetchNextPage`, `hasNextPage`, `isFetchingNextPage`, `isLoading: activityLoading` block)
3. Remove `const activity = activityData?.pages.flatMap((p) => p.items) ?? []`
4. Remove the entire `sentinelRef` + `useEffect` for the intersection observer
5. Remove the `activityIcon` function (outside the component)
6. Remove the `DETAIL_LABELS` constant
7. Remove the `formatDetailValue` function
8. Remove the `PAGE_SIZE` constant

**Add the new simple query** (inside the component, after the `useDashboard()` call):

```typescript
  const {
    data: activityData,
    isLoading: activityLoading,
  } = useQuery({
    queryKey: queryKeys.dashboard.activity(),
    queryFn: async () => {
      const result = await getDashboardActivityAction()
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
  })

  const activity = activityData?.items ?? []
```

**Replace the Activity Feed Card** — find the entire `{/* Activity Feed */}` Card section and replace it with:

```typescript
      {/* Recent Activity */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-xl font-semibold">Recent Activity</CardTitle>
          {has("activity:read") && (
            <Link href="/activities" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              View all →
            </Link>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {activityLoading ? (
            <div className="space-y-0">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 px-6 py-4 border-b last:border-b-0">
                  <div className="h-4 w-4 rounded bg-muted-foreground/10 animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1">
                    <div className="h-4 w-48 rounded bg-muted-foreground/10 animate-pulse" />
                    <div className="h-3 w-24 rounded bg-muted-foreground/10 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : activity.length === 0 ? (
            <p className="text-muted-foreground text-center py-8 px-6">
              No recent activity
            </p>
          ) : (
            <div>
              {activity.map((item, index) => {
                const href = "href" in item ? (item as any).href : (item as any).loanId ? `/loans/${(item as any).loanId}` : null
                const description = "description" in item ? item.description : ""
                const actorName = "actorName" in item ? item.actorName : undefined
                const timestamp = "occurredAt" in item ? (item as any).occurredAt : (item as any).timestamp
                return (
                  <div
                    key={item.id}
                    className={`flex items-start gap-3 px-6 py-4 ${index < activity.length - 1 ? "border-b" : ""}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm">{description}</p>
                        {href && (
                          <Link
                            href={href}
                            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                            title="View details"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-muted-foreground font-mono">
                          {formatRelativeTime(timestamp)}
                        </p>
                        {actorName && (
                          <span className="text-xs text-muted-foreground">
                            · by {actorName}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
```

**Add Link import** if not present:

```typescript
import Link from "next/link"
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 4: Run existing dashboard tests to ensure nothing is broken**

Run: `npx vitest run src/actions/__tests__/dashboard.actions.test.ts 2>&1 | tail -20`
Expected: All existing tests PASS (the old `getRecentActivityAction` is still exported).

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/dashboard/page.tsx src/actions/dashboard.actions.ts
git commit -m "feat: simplify dashboard activity feed to 3-item capped card with View all link"
```

---

### Task 10: E2E Tests for Activities Page

**Files:**
- Create: `cypress/e2e/activities.cy.ts`

- [ ] **Step 1: Write Cypress E2E tests**

Create `cypress/e2e/activities.cy.ts`:

```typescript
describe("Activities Page", () => {
  beforeEach(() => {
    cy.login("admin")
  })

  it("renders page header and table", () => {
    cy.visit("/activities")
    cy.contains("Activities").should("be.visible")
    cy.contains("Monitor team activity").should("be.visible")
    cy.get("table").should("exist")
  })

  it("shows filter panel with user, entity type, and date filters", () => {
    cy.visit("/activities")
    cy.get("#actorId").should("exist")
    cy.get("#entityType").should("exist")
    cy.get("#dateFrom").should("exist")
    cy.get("#dateTo").should("exist")
  })

  it("filters by entity type", () => {
    cy.visit("/activities")
    cy.get("#entityType").click()
    cy.contains("Loan").click()
    cy.url().should("include", "entityType=loan")
  })

  it("filters by date range", () => {
    cy.visit("/activities")
    const today = new Date().toISOString().slice(0, 10)
    cy.get("#dateFrom").type(today)
    cy.url().should("include", "dateFrom=")
  })

  it("clears filters", () => {
    cy.visit("/activities?entityType=loan")
    cy.contains("Clear filters").click()
    cy.url().should("not.include", "entityType")
  })

  it("shows empty state when no results", () => {
    cy.visit("/activities?entityType=transaction&dateFrom=2020-01-01&dateTo=2020-01-02")
    cy.contains("No activities found").should("be.visible")
  })

  it("shows pagination when results exist", () => {
    cy.visit("/activities")
    cy.get("body").then(($body) => {
      if ($body.text().includes("Showing")) {
        cy.contains("Previous").should("be.visible")
        cy.contains("Next").should("be.visible")
      }
    })
  })

  it("links to entity detail pages", () => {
    cy.visit("/activities")
    cy.get("body").then(($body) => {
      if ($body.find("a[title='View details']").length > 0) {
        cy.get("a[title='View details']").first().should("have.attr", "href")
      }
    })
  })
})

describe("Activities Page - Authorization", () => {
  it("is not accessible to loan officers (no activity:read)", () => {
    cy.login("loanOfficer")
    cy.visit("/activities")
    // Should either redirect or show forbidden
    cy.url().should("not.include", "/activities")
  })

  it("is visible in sidebar for supervisors", () => {
    cy.login("supervisor")
    cy.visit("/dashboard")
    cy.contains("Activities").should("be.visible")
  })

  it("is not visible in sidebar for loan officers", () => {
    cy.login("loanOfficer")
    cy.visit("/loans")
    cy.get("nav").should("not.contain", "Activities")
  })
})

describe("Dashboard - Recent Activity Widget", () => {
  beforeEach(() => {
    cy.login("admin")
  })

  it("shows at most 3 activity items", () => {
    cy.visit("/dashboard")
    cy.contains("Recent Activity").should("be.visible")
    cy.get("[class*='border-b']").should("have.length.at.most", 3)
  })

  it("shows View all link for supervisors+", () => {
    cy.visit("/dashboard")
    cy.contains("View all →").should("be.visible")
    cy.contains("View all →").should("have.attr", "href", "/activities")
  })
})
```

- [ ] **Step 2: Run the E2E tests**

Run: `npx cypress run --spec cypress/e2e/activities.cy.ts 2>&1 | tail -30`
Expected: Tests pass (some may need adjustment based on actual auth setup — fix any failures).

- [ ] **Step 3: Commit**

```bash
git add cypress/e2e/activities.cy.ts
git commit -m "test: add E2E tests for activities page and dashboard widget"
```
