# Supervisor Role & Interest Rate Approval Flow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a supervisor role between loan officer and admin, and implement a rate change request/approval workflow with role-based thresholds.

**Architecture:** New supervisor role at level 2 (admin shifts to 3, superAdmin to 4). New `rate_change_requests` table with status enum. Approvals page at `/approvals` visible to supervisor+. Rate changes below threshold require approval; at-or-above-threshold apply immediately.

**Tech Stack:** Next.js, Drizzle ORM, React Hook Form, TanStack Query, shadcn/ui

---

## Task 1: Update role hierarchy

**Files:**
- `src/lib/permissions.ts`
- `src/types/index.ts`
- `src/app/(app)/admin/page.tsx`

- [ ] **1.1 Add supervisorRole to permissions**

Replace the entire `src/lib/permissions.ts` with the updated role hierarchy:

```ts
// src/lib/permissions.ts
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
```

- [ ] **1.2 Update ROLE_LEVELS in types**

In `src/types/index.ts`, replace the `ROLE_LEVELS` constant:

```ts
// Before:
export const ROLE_LEVELS = {
  unassigned: 0,
  loanOfficer: 1,
  admin: 2,
  superAdmin: 3,
} as const

// After:
export const ROLE_LEVELS = {
  unassigned: 0,
  loanOfficer: 1,
  supervisor: 2,
  admin: 3,
  superAdmin: 4,
} as const
```

- [ ] **1.3 Update admin page role display to include supervisor**

In `src/app/(app)/admin/page.tsx`, update the InfoPopover role descriptions inside the `<TableHead>` for "Role". Add supervisor between Loan Officer and Admin:

```tsx
<InfoPopover>
  <p className="font-semibold text-sm mb-1">User Roles</p>
  <div className="text-xs text-muted-foreground space-y-1.5">
    <p><strong>Super Admin</strong> — Full system access. Can manage all users, change any role, and access all settings. Only the first registered user gets this role automatically.</p>
    <p><strong>Admin</strong> — Can manage loans, customers, payments, and assign roles up to supervisor. Can access admin settings.</p>
    <p><strong>Supervisor</strong> — Same as Loan Officer plus can assign loan officers and approve/reject rate change requests within their threshold.</p>
    <p><strong>Loan Officer</strong> — Can create customers, issue loans, and record payments. Cannot access admin settings or change roles.</p>
    <p><strong>Unassigned</strong> — New users start here. Cannot perform any actions until a role is assigned by an admin.</p>
  </div>
</InfoPopover>
```

Also update the role display formatting in the same file to handle the "supervisor" case. Find both occurrences of the ternary that formats role display labels and replace them. There are two places: the `<SelectValue>` and the fallback `<span>`:

```tsx
// Before (appears in SelectValue and the else span):
{userRole === "loanOfficer"
  ? "Loan Officer"
  : userRole.charAt(0).toUpperCase() + userRole.slice(1)}

// After (appears in SelectValue and the else span):
{userRole === "loanOfficer"
  ? "Loan Officer"
  : userRole === "superAdmin"
    ? "Super Admin"
    : userRole.charAt(0).toUpperCase() + userRole.slice(1)}
```

And the same pattern for the `SelectItem` rendering:

```tsx
// Before:
{role === "loanOfficer"
  ? "Loan Officer"
  : role.charAt(0).toUpperCase() + role.slice(1)}

// After:
{role === "loanOfficer"
  ? "Loan Officer"
  : role === "superAdmin"
    ? "Super Admin"
    : role.charAt(0).toUpperCase() + role.slice(1)}
```

- [ ] **1.4 Verify build**

```bash
npx next build 2>&1 | tail -20
```

- [ ] **1.5 Commit**

```bash
git add src/lib/permissions.ts src/types/index.ts src/app/\(app\)/admin/page.tsx
git commit -m "feat: add supervisor role to hierarchy between loanOfficer and admin"
```

---

## Task 2: Create rate_change_requests schema

**Files:**
- `src/lib/db/schema/rate-change-requests.ts` (new)
- `src/lib/db/schema/index.ts`
- `src/types/index.ts`

- [ ] **2.1 Create the rate_change_requests schema file**

Create `src/lib/db/schema/rate-change-requests.ts`:

```ts
// src/lib/db/schema/rate-change-requests.ts
import { pgTable, uuid, numeric, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core"
import { loans } from "./loans"

export const rateRequestStatusEnum = pgEnum("rate_request_status", [
  "pending",
  "approved",
  "rejected",
])

export const rateChangeRequests = pgTable("rate_change_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  loanId: uuid("loan_id").notNull().references(() => loans.id),
  requestedRate: numeric("requested_rate", { precision: 5, scale: 4 }).notNull(),
  currentRate: numeric("current_rate", { precision: 5, scale: 4 }).notNull(),
  requestedBy: text("requested_by").notNull(),
  requiredApproverRole: text("required_approver_role").notNull(),
  status: rateRequestStatusEnum("status").notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (table) => [
  index("idx_rate_change_requests_loan_id").on(table.loanId),
  index("idx_rate_change_requests_status").on(table.status),
])
```

- [ ] **2.2 Export from schema index**

In `src/lib/db/schema/index.ts`, add at the end:

```ts
export * from "./rate-change-requests"
```

- [ ] **2.3 Add types to src/types/index.ts**

Add the import for the new schema and the type exports at the bottom of `src/types/index.ts`:

```ts
// Add to the import block at the top:
import type { rateChangeRequests } from "@/lib/db/schema/rate-change-requests"

// Add after the existing type exports (e.g., after LoanDueToday):
export type RateChangeRequest = InferSelectModel<typeof rateChangeRequests>
export type NewRateChangeRequest = InferInsertModel<typeof rateChangeRequests>

export interface CreateRateChangeRequestInput {
  loanId: string
  requestedRate: string  // decimal string e.g. "0.08" for 8%/month
}

export interface ReviewRateChangeRequestInput {
  requestId: string
  action: "approved" | "rejected"
  reviewNote?: string
}
```

- [ ] **2.4 Generate and push migration**

```bash
npx drizzle-kit generate
npx drizzle-kit push
```

- [ ] **2.5 Verify build**

```bash
npx next build 2>&1 | tail -20
```

- [ ] **2.6 Commit**

```bash
git add src/lib/db/schema/rate-change-requests.ts src/lib/db/schema/index.ts src/types/index.ts drizzle/
git commit -m "feat: add rate_change_requests schema and types"
```

---

## Task 3: Rate change request service

**Files:**
- `src/services/rate-change-request.service.ts` (new)
- `src/lib/errors.ts`

- [ ] **3.1 Add error class for rate change requests**

In `src/lib/errors.ts`, add at the end:

```ts
export class RateChangeRequestNotFound extends Data.TaggedError("RateChangeRequestNotFound")<{ id: string }> {}
```

- [ ] **3.2 Create the rate change request service**

Create `src/services/rate-change-request.service.ts`:

```ts
// src/services/rate-change-request.service.ts
import { Effect } from "effect"
import { db } from "@/lib/db"
import { rateChangeRequests } from "@/lib/db/schema/rate-change-requests"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { eq, desc, and } from "drizzle-orm"
import { DatabaseError, LoanNotFound, RateChangeRequestNotFound, ValidationError } from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import type { CreateRateChangeRequestInput, ReviewRateChangeRequestInput, RateChangeRequest } from "@/types"

export interface RateChangeRequestWithLoan extends RateChangeRequest {
  customerName: string
  loanRef: string
  principalAmount: string
}

export const createRateChangeRequest = (
  input: CreateRateChangeRequestInput,
  requestedBy: string,
  requiredApproverRole: string,
  currentRate: string
): Effect.Effect<RateChangeRequest, LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [loan] = await db
        .select()
        .from(loans)
        .where(eq(loans.id, input.loanId))

      if (!loan) throw { _tag: "LoanNotFound", id: input.loanId }

      const [request] = await db
        .insert(rateChangeRequests)
        .values({
          loanId: input.loanId,
          requestedRate: input.requestedRate,
          currentRate,
          requestedBy,
          requiredApproverRole,
          status: "pending",
        })
        .returning()

      return request
    },
    catch: (e: any) => {
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

export const applyRateChangeImmediately = (
  loanId: string,
  newRate: string,
  actorId: string
): Effect.Effect<void, LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [loan] = await db
        .select()
        .from(loans)
        .where(eq(loans.id, loanId))

      if (!loan) throw { _tag: "LoanNotFound", id: loanId }

      await db.transaction(async (tx) => {
        await tx
          .update(loans)
          .set({ interestRate: newRate, updatedAt: new Date() })
          .where(eq(loans.id, loanId))

        await writeAuditLog(tx, {
          actorId,
          action: "loan.rate_change.immediate",
          entityType: "loan",
          entityId: loanId,
          beforeValue: { interestRate: loan.interestRate },
          afterValue: { interestRate: newRate },
        })
      })
    },
    catch: (e: any) => {
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

export const listPendingRequests = (): Effect.Effect<RateChangeRequestWithLoan[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db
        .select({
          id: rateChangeRequests.id,
          loanId: rateChangeRequests.loanId,
          requestedRate: rateChangeRequests.requestedRate,
          currentRate: rateChangeRequests.currentRate,
          requestedBy: rateChangeRequests.requestedBy,
          requiredApproverRole: rateChangeRequests.requiredApproverRole,
          status: rateChangeRequests.status,
          reviewedBy: rateChangeRequests.reviewedBy,
          reviewNote: rateChangeRequests.reviewNote,
          createdAt: rateChangeRequests.createdAt,
          reviewedAt: rateChangeRequests.reviewedAt,
          customerName: customers.fullName,
          principalAmount: loans.principalAmount,
        })
        .from(rateChangeRequests)
        .innerJoin(loans, eq(rateChangeRequests.loanId, loans.id))
        .innerJoin(customers, eq(loans.customerId, customers.id))
        .orderBy(desc(rateChangeRequests.createdAt))

      return rows.map((row) => ({
        ...row,
        loanRef: `LOAN-${row.loanId.slice(0, 8).toUpperCase()}`,
      }))
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const listRequestsForLoan = (
  loanId: string
): Effect.Effect<RateChangeRequest[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db
        .select()
        .from(rateChangeRequests)
        .where(eq(rateChangeRequests.loanId, loanId))
        .orderBy(desc(rateChangeRequests.createdAt))
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const reviewRequest = (
  input: ReviewRateChangeRequestInput,
  reviewerId: string
): Effect.Effect<RateChangeRequest, RateChangeRequestNotFound | ValidationError | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [request] = await db
        .select()
        .from(rateChangeRequests)
        .where(eq(rateChangeRequests.id, input.requestId))

      if (!request) throw { _tag: "RateChangeRequestNotFound", id: input.requestId }

      if (request.status !== "pending") {
        throw { _tag: "ValidationError", message: "Request has already been reviewed" }
      }

      const now = new Date()

      return await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(rateChangeRequests)
          .set({
            status: input.action,
            reviewedBy: reviewerId,
            reviewNote: input.reviewNote ?? null,
            reviewedAt: now,
          })
          .where(eq(rateChangeRequests.id, input.requestId))
          .returning()

        if (input.action === "approved") {
          // Apply the rate change to the loan
          await tx
            .update(loans)
            .set({ interestRate: request.requestedRate, updatedAt: now })
            .where(eq(loans.id, request.loanId))

          await writeAuditLog(tx, {
            actorId: reviewerId,
            action: "loan.rate_change.approved",
            entityType: "loan",
            entityId: request.loanId,
            beforeValue: { interestRate: request.currentRate },
            afterValue: { interestRate: request.requestedRate, requestId: request.id },
          })
        } else {
          await writeAuditLog(tx, {
            actorId: reviewerId,
            action: "loan.rate_change.rejected",
            entityType: "rate_change_request",
            entityId: request.id,
            beforeValue: null,
            afterValue: { reviewNote: input.reviewNote ?? null },
          })
        }

        return updated
      })
    },
    catch: (e: any) => {
      if (e?._tag === "RateChangeRequestNotFound") return new RateChangeRequestNotFound({ id: e.id })
      if (e?._tag === "ValidationError") return new ValidationError({ message: e.message })
      return new DatabaseError({ cause: e })
    },
  })

export const countPendingRequests = (): Effect.Effect<number, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db
        .select({ id: rateChangeRequests.id })
        .from(rateChangeRequests)
        .where(eq(rateChangeRequests.status, "pending"))
      return rows.length
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

- [ ] **3.3 Verify build**

```bash
npx next build 2>&1 | tail -20
```

- [ ] **3.4 Commit**

```bash
git add src/services/rate-change-request.service.ts src/lib/errors.ts
git commit -m "feat: add rate change request service with create, review, and list operations"
```

---

## Task 4: Rate change request server actions

**Files:**
- `src/actions/rate-change-request.actions.ts` (new)

- [ ] **4.1 Create the server actions file**

Create `src/actions/rate-change-request.actions.ts`:

```ts
// src/actions/rate-change-request.actions.ts
"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { ROLE_LEVELS, type UserRole, type CreateRateChangeRequestInput, type ReviewRateChangeRequestInput } from "@/types"
import {
  createRateChangeRequest,
  applyRateChangeImmediately,
  listPendingRequests,
  listRequestsForLoan,
  reviewRequest,
  countPendingRequests,
} from "@/services/rate-change-request.service"
import { LoanNotFound, RateChangeRequestNotFound } from "@/lib/errors"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { eq } from "drizzle-orm"

/**
 * Determine the required approver role based on the requested rate.
 * - Rate >= 8% (0.08) and < 10% (0.10) → supervisor can approve
 * - Rate < 8% (0.08) → admin must approve
 */
function getRequiredApproverRole(requestedRateDecimal: string): UserRole {
  const rate = parseFloat(requestedRateDecimal)
  if (rate >= 0.08 && rate < 0.10) {
    return "supervisor"
  }
  return "admin"
}

export async function requestRateChangeAction(input: CreateRateChangeRequestInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.loanOfficer) {
    return { error: "Forbidden" }
  }

  if (!input.loanId?.trim()) {
    return { error: "Loan ID is required" }
  }
  if (!input.requestedRate?.trim()) {
    return { error: "Requested rate is required" }
  }

  const requestedRateFloat = parseFloat(input.requestedRate)
  if (isNaN(requestedRateFloat) || requestedRateFloat <= 0 || requestedRateFloat >= 1) {
    return { error: "Rate must be a decimal between 0 and 1 (e.g., 0.10 for 10%)" }
  }

  // Look up the loan's current rate
  const [loan] = await db
    .select({ interestRate: loans.interestRate })
    .from(loans)
    .where(eq(loans.id, input.loanId))

  if (!loan) {
    return { error: "Loan not found" }
  }

  if (input.requestedRate === loan.interestRate) {
    return { error: "Requested rate is the same as the current rate" }
  }

  const requiredApproverRole = getRequiredApproverRole(input.requestedRate)

  // If the user's role meets or exceeds the required approver role, apply immediately
  if (ROLE_LEVELS[role] >= ROLE_LEVELS[requiredApproverRole]) {
    try {
      await Effect.runPromise(
        applyRateChangeImmediately(input.loanId, input.requestedRate, session.user.id)
      )
      revalidatePath("/loans")
      revalidatePath(`/loans/${input.loanId}`)
      return { data: { applied: true as const, message: "Rate changed immediately" } }
    } catch (error) {
      if (error instanceof LoanNotFound) {
        return { error: "Loan not found" }
      }
      return { error: "Internal server error" }
    }
  }

  // Otherwise, create a request for approval
  try {
    const data = await Effect.runPromise(
      createRateChangeRequest(input, session.user.id, requiredApproverRole, loan.interestRate)
    )
    revalidatePath("/approvals")
    revalidatePath(`/loans/${input.loanId}`)
    return { data: { applied: false as const, request: data, message: `Rate change request submitted for ${requiredApproverRole} approval` } }
  } catch (error) {
    if (error instanceof LoanNotFound) {
      return { error: "Loan not found" }
    }
    return { error: "Internal server error" }
  }
}

export async function listPendingRequestsAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.supervisor) {
    return { error: "Forbidden" }
  }

  try {
    const data = await Effect.runPromise(listPendingRequests())
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function listRequestsForLoanAction(loanId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  if (!loanId?.trim()) {
    return { error: "Loan ID is required" }
  }

  try {
    const data = await Effect.runPromise(listRequestsForLoan(loanId))
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function reviewRateChangeRequestAction(input: ReviewRateChangeRequestInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.supervisor) {
    return { error: "Forbidden" }
  }

  if (!input.requestId?.trim()) {
    return { error: "Request ID is required" }
  }
  if (input.action !== "approved" && input.action !== "rejected") {
    return { error: "Action must be 'approved' or 'rejected'" }
  }

  // Fetch the request to check requiredApproverRole
  try {
    // We need to import the table to check the required role
    const { rateChangeRequests } = await import("@/lib/db/schema/rate-change-requests")
    const [request] = await db
      .select({ requiredApproverRole: rateChangeRequests.requiredApproverRole, loanId: rateChangeRequests.loanId })
      .from(rateChangeRequests)
      .where(eq(rateChangeRequests.id, input.requestId))

    if (!request) {
      return { error: "Rate change request not found" }
    }

    const requiredRole = request.requiredApproverRole as UserRole
    if (ROLE_LEVELS[role] < ROLE_LEVELS[requiredRole]) {
      return { error: `This request requires ${requiredRole} or higher to review` }
    }

    const data = await Effect.runPromise(
      reviewRequest(input, session.user.id)
    )
    revalidatePath("/approvals")
    revalidatePath(`/loans/${request.loanId}`)
    revalidatePath("/loans")
    return { data }
  } catch (error) {
    if (error instanceof RateChangeRequestNotFound) {
      return { error: "Rate change request not found" }
    }
    return { error: "Internal server error" }
  }
}

export async function countPendingRequestsAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.supervisor) {
    return { data: 0 }
  }

  try {
    const count = await Effect.runPromise(countPendingRequests())
    return { data: count }
  } catch {
    return { data: 0 }
  }
}
```

- [ ] **4.2 Verify build**

```bash
npx next build 2>&1 | tail -20
```

- [ ] **4.3 Commit**

```bash
git add src/actions/rate-change-request.actions.ts
git commit -m "feat: add rate change request server actions with role-based threshold logic"
```

---

## Task 5: "Request Rate Change" UI on loan detail page

**Files:**
- `src/app/(app)/loans/[loanId]/loan-detail-client.tsx`
- `src/app/(app)/loans/[loanId]/page.tsx`
- `src/hooks/query-keys.ts`

- [ ] **5.1 Add rateChangeRequests to query keys**

In `src/hooks/query-keys.ts`, add a new entry before the closing `} as const`:

```ts
  rateChangeRequests: {
    all: ["rate-change-requests"] as const,
    pending: () => [...queryKeys.rateChangeRequests.all, "pending"] as const,
    byLoan: (loanId: string) =>
      [...queryKeys.rateChangeRequests.all, "byLoan", loanId] as const,
    pendingCount: () => [...queryKeys.rateChangeRequests.all, "pending-count"] as const,
  },
```

- [ ] **5.2 Update LoanDetailClient to accept userRole and add rate change dialog**

In `src/app/(app)/loans/[loanId]/loan-detail-client.tsx`, make the following changes:

First, add to the imports at the top:

```ts
import { ArrowUpDown } from "lucide-react"
import { requestRateChangeAction, listRequestsForLoanAction } from "@/actions/rate-change-request.actions"
import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/hooks/query-keys"
import { ROLE_LEVELS, type UserRole, type RateChangeRequest } from "@/types"
import { Badge } from "@/components/ui/badge"
```

Update the `LoanDetailClientProps` interface to include `userRole`:

```ts
interface LoanDetailClientProps {
  loan: Loan
  initialPayments: Payment[]
  customerName: string | null
  canModify: boolean
  openEditOnMount?: boolean
  userNameMap: Record<string, string>
  userRole: UserRole
}
```

Update the component signature to destructure `userRole`:

```ts
export function LoanDetailClient({ loan, initialPayments, customerName, canModify, openEditOnMount, userNameMap, userRole }: LoanDetailClientProps) {
```

Add rate change state after the existing `deletingLoan` state declarations (around line 107):

```ts
  const [requestingRateChange, setRequestingRateChange] = useState(false)
  const [newRate, setNewRate] = useState("")
  const [isRateChangePending, startRateChangeTransition] = useTransition()

  // Fetch pending rate change requests for this loan
  const { data: rateChangeRequests = [] } = useQuery({
    queryKey: queryKeys.rateChangeRequests.byLoan(loan.id),
    queryFn: async () => {
      const result = await listRequestsForLoanAction(loan.id)
      if ("error" in result) return []
      return result.data
    },
  })

  const pendingRateRequest = rateChangeRequests.find((r: RateChangeRequest) => r.status === "pending")
```

Add the rate change handler function after the existing `handleLoanDeleteSubmit` function:

```ts
  function openRateChangeDialog() {
    setNewRate((parseFloat(loan.interestRate) * 100).toFixed(1))
    setRequestingRateChange(true)
  }

  function closeRateChangeDialog() {
    setRequestingRateChange(false)
    setNewRate("")
  }

  function handleRateChangeSubmit() {
    startRateChangeTransition(async () => {
      const rateDecimal = (parseFloat(newRate) / 100).toFixed(4)

      const result = await requestRateChangeAction({
        loanId: loan.id,
        requestedRate: rateDecimal,
      })

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      if (result.data.applied) {
        toast.success("Interest rate updated immediately")
        queryClient.invalidateQueries({ queryKey: queryKeys.loans.detail(loan.id) })
        queryClient.invalidateQueries({ queryKey: queryKeys.loans.all })
      } else {
        toast.success(result.data.message)
        queryClient.invalidateQueries({ queryKey: queryKeys.rateChangeRequests.byLoan(loan.id) })
        queryClient.invalidateQueries({ queryKey: queryKeys.rateChangeRequests.pending() })
      }

      closeRateChangeDialog()
    })
  }
```

In the Interest Rate card (the second card in the grid), add a "Request Rate Change" button and pending badge. Replace the Interest Rate card div with:

```tsx
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Percent className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Interest Rate</span>
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Monthly Interest Rate</p>
              <p className="text-xs text-muted-foreground mb-2">
                The rate charged per 30-day period. Interest accrues daily using this formula:
              </p>
              <p className="text-xs font-mono bg-muted rounded px-2 py-1 mb-2">
                Daily Interest = Balance x (Rate / 30)
              </p>
              <div className="bg-muted/50 rounded-md p-2 text-xs space-y-1">
                <p className="font-medium">Example (10% / month):</p>
                <p>UGX 1,000,000 x (0.10 / 30) = UGX 3,333/day</p>
              </div>
            </InfoPopover>
          </div>
          <p className="text-2xl font-semibold font-mono tabular-nums tracking-tight">
            {(parseFloat(loan.interestRate) * 100).toFixed(1)}%
            <span className="text-sm font-normal text-muted-foreground ml-1">/ month</span>
          </p>
          {pendingRateRequest && (
            <Badge variant="outline" className="mt-2 text-xs">
              Pending: {(parseFloat(pendingRateRequest.requestedRate) * 100).toFixed(1)}%
            </Badge>
          )}
          {loan.status === "active" && ROLE_LEVELS[userRole] >= ROLE_LEVELS.loanOfficer && !pendingRateRequest && (
            <Button variant="outline" size="sm" className="mt-2" onClick={openRateChangeDialog}>
              <ArrowUpDown className="h-3.5 w-3.5 mr-1.5" />
              Request Rate Change
            </Button>
          )}
        </div>
```

Add the Rate Change Dialog at the end of the component, before the closing `</div>` of the root element (just after the Delete Loan Dialog):

```tsx
      {/* Rate Change Request Dialog */}
      <DrawerDialog open={requestingRateChange} onOpenChange={(open) => { if (!open) closeRateChangeDialog() }}>
        <DrawerDialogContent>
          <DialogHeader>
            <DialogTitle>Request Interest Rate Change</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Current rate: {(parseFloat(loan.interestRate) * 100).toFixed(1)}% per month.
              {ROLE_LEVELS[userRole] >= ROLE_LEVELS.supervisor
                ? " As a supervisor or above, rates between 8-10% will be applied immediately."
                : " Your request will be sent for supervisor or admin approval."}
            </p>
            <div className="space-y-1">
              <Label htmlFor="newRate">New Rate (% per month)</Label>
              <Input
                id="newRate"
                type="number"
                min="0.1"
                max="99.9"
                step="0.1"
                value={newRate}
                onChange={(e) => setNewRate(e.target.value)}
                disabled={isRateChangePending}
                placeholder="e.g. 8.0"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {newRate && parseFloat(newRate) >= 8 && parseFloat(newRate) < 10
                  ? "Requires supervisor approval (or higher)."
                  : newRate && parseFloat(newRate) > 0 && parseFloat(newRate) < 8
                    ? "Requires admin approval (or higher)."
                    : newRate && parseFloat(newRate) >= 10
                      ? "Requires admin approval (or higher)."
                      : "Enter the new monthly interest rate."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeRateChangeDialog}
              disabled={isRateChangePending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRateChangeSubmit}
              disabled={isRateChangePending || !newRate.trim() || parseFloat(newRate) <= 0}
            >
              {isRateChangePending ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  Submitting...
                </>
              ) : (
                "Submit Request"
              )}
            </Button>
          </DialogFooter>
        </DrawerDialogContent>
      </DrawerDialog>
```

- [ ] **5.3 Pass userRole from the server page to LoanDetailClient**

In `src/app/(app)/loans/[loanId]/page.tsx`, update the `LoanDetailClient` usage to pass `userRole`:

```tsx
  return (
    <LoanDetailClient
      loan={loan}
      initialPayments={payments}
      customerName={customerName}
      canModify={canModify}
      openEditOnMount={openEdit}
      userNameMap={userNameMap}
      userRole={role}
    />
  )
```

- [ ] **5.4 Verify build**

```bash
npx next build 2>&1 | tail -20
```

- [ ] **5.5 Commit**

```bash
git add src/app/\(app\)/loans/\[loanId\]/loan-detail-client.tsx src/app/\(app\)/loans/\[loanId\]/page.tsx src/hooks/query-keys.ts
git commit -m "feat: add rate change request dialog to loan detail page"
```

---

## Task 6: Approvals page and sidebar nav

**Files:**
- `src/app/(app)/approvals/page.tsx` (new)
- `src/components/layout/sidebar.tsx`

- [ ] **6.1 Create the approvals page**

Create `src/app/(app)/approvals/page.tsx`:

```tsx
// src/app/(app)/approvals/page.tsx
"use client"

import { useState, useTransition } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useSession } from "@/lib/auth-client"
import { Check, X, Loader2, ClipboardCheck } from "lucide-react"
import { listPendingRequestsAction, reviewRateChangeRequestAction } from "@/actions/rate-change-request.actions"
import { queryKeys } from "@/hooks/query-keys"
import { ROLE_LEVELS, type UserRole } from "@/types"
import type { RateChangeRequestWithLoan } from "@/services/rate-change-request.service"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import {
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDate, formatCurrency } from "@/lib/utils"
import Link from "next/link"

function statusBadgeVariant(status: string): "default" | "outline" | "secondary" | "destructive" {
  if (status === "pending") return "default"
  if (status === "approved") return "secondary"
  if (status === "rejected") return "destructive"
  return "outline"
}

export default function ApprovalsPage() {
  const { data: session } = useSession()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()

  const actorRole = (session?.user?.role ?? "unassigned") as UserRole
  const actorLevel = ROLE_LEVELS[actorRole] ?? 0
  const isSupervisorOrAbove = actorLevel >= ROLE_LEVELS.supervisor

  const { data: requests = [], isLoading } = useQuery({
    queryKey: queryKeys.rateChangeRequests.pending(),
    queryFn: async () => {
      const result = await listPendingRequestsAction()
      if ("error" in result) return []
      return result.data
    },
    enabled: !!session && isSupervisorOrAbove,
  })

  const [reviewingRequest, setReviewingRequest] = useState<RateChangeRequestWithLoan | null>(null)
  const [reviewAction, setReviewAction] = useState<"approved" | "rejected">("approved")
  const [reviewNote, setReviewNote] = useState("")

  function openReviewDialog(request: RateChangeRequestWithLoan, action: "approved" | "rejected") {
    setReviewingRequest(request)
    setReviewAction(action)
    setReviewNote("")
  }

  function closeReviewDialog() {
    setReviewingRequest(null)
    setReviewNote("")
  }

  function handleReviewSubmit() {
    if (!reviewingRequest) return
    startTransition(async () => {
      const result = await reviewRateChangeRequestAction({
        requestId: reviewingRequest.id,
        action: reviewAction,
        reviewNote: reviewNote.trim() || undefined,
      })

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      toast.success(reviewAction === "approved" ? "Rate change approved and applied" : "Rate change request rejected")
      closeReviewDialog()

      queryClient.invalidateQueries({ queryKey: queryKeys.rateChangeRequests.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.rateChangeRequests.pendingCount() })
      queryClient.invalidateQueries({ queryKey: queryKeys.loans.all })
    })
  }

  if (!session || (isLoading && !requests.length)) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (!isSupervisorOrAbove) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-destructive font-medium">Access denied.</p>
        <p className="text-muted-foreground text-sm mt-1">
          You need Supervisor or higher permissions to view approvals.
        </p>
      </div>
    )
  }

  const pendingRequests = requests.filter((r: RateChangeRequestWithLoan) => r.status === "pending")
  const reviewedRequests = requests.filter((r: RateChangeRequestWithLoan) => r.status !== "pending")

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader title="Approvals" subtitle="Rate change requests pending your review" />

      {/* Pending Requests */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold">Pending Requests</h2>
        {pendingRequests.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/30 flex flex-col items-center justify-center py-12 gap-3 text-center">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <ClipboardCheck className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No pending requests</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              All rate change requests have been reviewed.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Loan</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Customer</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Principal</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Current Rate</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Requested Rate</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Required Role</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Requested</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingRequests.map((request: RateChangeRequestWithLoan) => {
                    const canReview = ROLE_LEVELS[actorRole] >= ROLE_LEVELS[request.requiredApproverRole as UserRole]
                    return (
                      <TableRow key={request.id} data-testid="pending-request-row">
                        <TableCell className="font-mono text-sm">
                          <Link href={`/loans/${request.loanId}`} className="text-primary hover:underline">
                            {request.loanRef}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm font-medium">{request.customerName}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-sm">
                          {formatCurrency(request.principalAmount)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-sm">
                          {(parseFloat(request.currentRate) * 100).toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-sm font-medium">
                          {(parseFloat(request.requestedRate) * 100).toFixed(1)}%
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs capitalize">
                            {request.requiredApproverRole === "supervisor" ? "Supervisor" : "Admin"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground font-mono tabular-nums">
                          {formatDate(request.createdAt)}
                        </TableCell>
                        <TableCell>
                          {canReview ? (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                                onClick={() => openReviewDialog(request, "approved")}
                                aria-label="Approve"
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => openReviewDialog(request, "rejected")}
                                aria-label="Reject"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Insufficient role</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      {/* Recently Reviewed */}
      {reviewedRequests.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold">Recently Reviewed</h2>
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Loan</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Customer</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Rate Change</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Status</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Note</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Reviewed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviewedRequests.map((request: RateChangeRequestWithLoan) => (
                    <TableRow key={request.id} data-testid="reviewed-request-row">
                      <TableCell className="font-mono text-sm">
                        <Link href={`/loans/${request.loanId}`} className="text-primary hover:underline">
                          {request.loanRef}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm font-medium">{request.customerName}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-sm">
                        {(parseFloat(request.currentRate) * 100).toFixed(1)}% &rarr; {(parseFloat(request.requestedRate) * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(request.status)} className="text-xs capitalize">
                          {request.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                        {request.reviewNote || "-"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono tabular-nums">
                        {request.reviewedAt ? formatDate(request.reviewedAt) : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}

      {/* Review Dialog */}
      <DrawerDialog open={reviewingRequest !== null} onOpenChange={(open) => { if (!open) closeReviewDialog() }}>
        <DrawerDialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewAction === "approved" ? "Approve" : "Reject"} Rate Change
            </DialogTitle>
          </DialogHeader>
          {reviewingRequest && (
            <div className="space-y-4">
              <div className="text-sm space-y-2">
                <p>
                  <span className="text-muted-foreground">Loan:</span>{" "}
                  <span className="font-mono">{reviewingRequest.loanRef}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Customer:</span>{" "}
                  <span className="font-medium">{reviewingRequest.customerName}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Rate change:</span>{" "}
                  <span className="font-mono">
                    {(parseFloat(reviewingRequest.currentRate) * 100).toFixed(1)}% &rarr; {(parseFloat(reviewingRequest.requestedRate) * 100).toFixed(1)}%
                  </span>
                </p>
              </div>
              {reviewAction === "approved" && (
                <p className="text-sm text-muted-foreground bg-green-50 dark:bg-green-950/20 rounded-md p-3">
                  Approving this request will immediately update the loan&apos;s interest rate to{" "}
                  {(parseFloat(reviewingRequest.requestedRate) * 100).toFixed(1)}%.
                </p>
              )}
              {reviewAction === "rejected" && (
                <p className="text-sm text-muted-foreground bg-destructive/10 rounded-md p-3">
                  Rejecting this request will keep the current rate at{" "}
                  {(parseFloat(reviewingRequest.currentRate) * 100).toFixed(1)}%. The requester will see the rejection.
                </p>
              )}
              <div className="space-y-1">
                <Label htmlFor="reviewNote">Note (optional)</Label>
                <Textarea
                  id="reviewNote"
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder={reviewAction === "approved" ? "Any additional notes..." : "Reason for rejection..."}
                  disabled={isPending}
                  maxLength={500}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeReviewDialog}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant={reviewAction === "approved" ? "default" : "destructive"}
              onClick={handleReviewSubmit}
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  {reviewAction === "approved" ? "Approving..." : "Rejecting..."}
                </>
              ) : (
                reviewAction === "approved" ? "Approve & Apply" : "Reject"
              )}
            </Button>
          </DialogFooter>
        </DrawerDialogContent>
      </DrawerDialog>
    </div>
  )
}
```

- [ ] **6.2 Add Approvals to sidebar nav**

In `src/components/layout/sidebar.tsx`, add the `ClipboardCheck` import and the Approvals nav item.

First, add `ClipboardCheck` to the lucide-react import:

```ts
import {
  LayoutDashboard,
  Users,
  Banknote,
  CreditCard,
  Landmark,
  Receipt,
  BarChart3,
  Shield,
  ChevronLeft,
  ChevronRight,
  LogOut,
  ClipboardCheck,
} from "lucide-react"
```

Then, in the `navGroups` array, add the Approvals item to the Operations group (after "Loans"):

```ts
  {
    label: "Operations",
    items: [
      { label: "Customers", href: "/customers", icon: Users },
      { label: "Payments", href: "/payments", icon: CreditCard },
      { label: "Loans", href: "/loans", icon: Banknote },
      { label: "Approvals", href: "/approvals", icon: ClipboardCheck },
    ],
  },
```

- [ ] **6.3 Verify build**

```bash
npx next build 2>&1 | tail -20
```

- [ ] **6.4 Commit**

```bash
git add src/app/\(app\)/approvals/page.tsx src/components/layout/sidebar.tsx
git commit -m "feat: add approvals page and sidebar nav entry for rate change requests"
```

---

## Task 7: Cypress E2E tests

**Files:**
- `cypress/e2e/rate-change-approval.cy.ts` (new)

- [ ] **7.1 Create the E2E test file**

Create `cypress/e2e/rate-change-approval.cy.ts`:

```ts
// cypress/e2e/rate-change-approval.cy.ts
describe("Rate Change Approval Flow", () => {
  const password = "TestPass123!"
  let superAdminEmail: string
  let loanOfficerEmail: string
  let customerId: string
  let loanId: string

  beforeEach(() => {
    cy.task("db:reset")

    // Register first user (superAdmin)
    cy.registerAndLogin({ name: "Super Admin", password }).then((email) => {
      superAdminEmail = email
    })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Create a customer
    cy.visit("/customers")
    cy.contains("Add Customer").click()
    cy.get("#fullName").type("Rate Test Customer")
    cy.get("#nin").type("CM1234567890123")
    cy.get("#contact").type("0700111222")
    cy.get("#address").type("Test Address")
    cy.get("button[type=submit]").click()
    cy.contains("Customer created", { timeout: 10000 })

    // Navigate to customer and create a loan
    cy.contains("Rate Test Customer").click()
    cy.url().then((url) => {
      customerId = url.split("/customers/")[1]
    })

    // Create a loan via the loans page
    cy.visit("/loans/new")
    cy.get("[data-testid=customer-search]").type("Rate Test")
    cy.contains("Rate Test Customer").click()
    cy.get("#principalAmount").clear().type("1000000")
    cy.get("#interestRate").clear().type("10")
    cy.get("#startDate").type("2026-01-01")
    cy.get("#collateralNature").type("Land Title")
    cy.get("button[type=submit]").click()
    cy.contains("Loan created", { timeout: 10000 })

    // Get the loan ID from the URL
    cy.url({ timeout: 10000 }).should("include", "/loans/").then((url) => {
      const parts = url.split("/loans/")
      if (parts[1]) {
        loanId = parts[1].split("?")[0]
      }
    })
  })

  describe("Approvals page access", () => {
    it("renders approvals page for supervisor+ users", () => {
      cy.visit("/approvals")
      cy.contains("Approvals")
      cy.contains("Rate change requests pending your review")
      cy.contains("No pending requests")
    })

    it("shows access denied for loan officers", () => {
      // Register a loan officer
      cy.clearCookies()
      loanOfficerEmail = `lo-rate-${Date.now()}@fidexa.org`
      cy.visit("/register")
      cy.get("#name").type("Loan Officer")
      cy.get("#email").type(loanOfficerEmail)
      cy.get("#password").type(password)
      cy.get("#confirmPassword").type(password)
      cy.get("button[type=submit]").click()
      cy.url({ timeout: 15000 }).should("include", "/pending-approval")

      cy.task("db:promoteUser", { email: loanOfficerEmail, role: "loanOfficer" })
      cy.clearCookies()
      cy.login(loanOfficerEmail, password)
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      cy.visit("/approvals")
      cy.contains("Access denied")
    })
  })

  describe("Rate change request from loan detail", () => {
    it("superAdmin can change rate immediately (role meets threshold)", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Request Rate Change").click()

      // Change rate to 9% (supervisor threshold, but superAdmin meets it)
      cy.get("#newRate").clear().type("9.0")
      cy.contains("Submit Request").click()

      cy.contains("Interest rate updated immediately", { timeout: 10000 })

      // Verify the rate card shows the new rate
      cy.contains("9.0%")
    })
  })

  describe("Full approval flow", () => {
    it("loan officer request -> supervisor approves -> rate updated", () => {
      // Register a loan officer
      cy.clearCookies()
      loanOfficerEmail = `lo-flow-${Date.now()}@fidexa.org`
      cy.visit("/register")
      cy.get("#name").type("LO Flow User")
      cy.get("#email").type(loanOfficerEmail)
      cy.get("#password").type(password)
      cy.get("#confirmPassword").type(password)
      cy.get("button[type=submit]").click()
      cy.url({ timeout: 15000 }).should("include", "/pending-approval")

      // Promote to loanOfficer
      cy.task("db:promoteUser", { email: loanOfficerEmail, role: "loanOfficer" })
      cy.clearCookies()
      cy.login(loanOfficerEmail, password)
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      // Request rate change to 9% (requires supervisor)
      cy.visit(`/loans/${loanId}`)
      cy.contains("Request Rate Change").click()
      cy.get("#newRate").clear().type("9.0")
      cy.contains("Submit Request").click()
      cy.contains("submitted for supervisor approval", { timeout: 10000 })

      // Verify pending badge shows on loan detail
      cy.contains("Pending: 9.0%")

      // Now login as superAdmin and approve
      cy.clearCookies()
      cy.login(superAdminEmail, password)
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      cy.visit("/approvals")
      cy.get("[data-testid=pending-request-row]").should("have.length.gte", 1)
      cy.get("[data-testid=pending-request-row]").first().within(() => {
        cy.contains("9.0%")
        cy.get("[aria-label=Approve]").click()
      })

      cy.contains("Approve & Apply").click()
      cy.contains("Rate change approved and applied", { timeout: 10000 })

      // Verify the loan rate was updated
      cy.visit(`/loans/${loanId}`)
      cy.contains("9.0%")
    })
  })

  describe("Rejection flow", () => {
    it("loan officer request -> admin rejects -> rate unchanged", () => {
      // Register a loan officer
      cy.clearCookies()
      loanOfficerEmail = `lo-reject-${Date.now()}@fidexa.org`
      cy.visit("/register")
      cy.get("#name").type("LO Reject User")
      cy.get("#email").type(loanOfficerEmail)
      cy.get("#password").type(password)
      cy.get("#confirmPassword").type(password)
      cy.get("button[type=submit]").click()
      cy.url({ timeout: 15000 }).should("include", "/pending-approval")

      cy.task("db:promoteUser", { email: loanOfficerEmail, role: "loanOfficer" })
      cy.clearCookies()
      cy.login(loanOfficerEmail, password)
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      // Request rate change to 5% (requires admin)
      cy.visit(`/loans/${loanId}`)
      cy.contains("Request Rate Change").click()
      cy.get("#newRate").clear().type("5.0")
      cy.contains("Submit Request").click()
      cy.contains("submitted for admin approval", { timeout: 10000 })

      // Login as superAdmin and reject
      cy.clearCookies()
      cy.login(superAdminEmail, password)
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      cy.visit("/approvals")
      cy.get("[data-testid=pending-request-row]").first().within(() => {
        cy.get("[aria-label=Reject]").click()
      })

      cy.get("#reviewNote").type("Rate too low for this customer's risk profile")
      cy.contains("button", "Reject").click()
      cy.contains("Rate change request rejected", { timeout: 10000 })

      // Verify in recently reviewed section
      cy.contains("Recently Reviewed")
      cy.get("[data-testid=reviewed-request-row]").should("have.length.gte", 1)
      cy.get("[data-testid=reviewed-request-row]").first().within(() => {
        cy.contains("rejected")
      })

      // Verify loan rate is unchanged
      cy.visit(`/loans/${loanId}`)
      cy.contains("10.0%")
    })
  })

  describe("Sidebar navigation", () => {
    it("shows Approvals link in Operations group", () => {
      cy.visit("/dashboard")
      cy.get("[data-testid=sidebar-nav]").within(() => {
        cy.contains("Approvals")
      })
    })

    it("navigates to /approvals from sidebar", () => {
      cy.visit("/dashboard")
      cy.get("[data-testid=sidebar-nav]").within(() => {
        cy.contains("Approvals").click()
      })
      cy.url().should("include", "/approvals")
    })
  })
})
```

- [ ] **7.2 Run Cypress tests**

```bash
npx cypress run --spec cypress/e2e/rate-change-approval.cy.ts
```

- [ ] **7.3 Fix any failures and re-run until green**

- [ ] **7.4 Commit**

```bash
git add cypress/e2e/rate-change-approval.cy.ts
git commit -m "test: add Cypress E2E tests for rate change approval flow"
```
