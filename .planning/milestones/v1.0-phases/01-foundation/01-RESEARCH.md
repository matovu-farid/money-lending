# Phase 1: Foundation - Research

**Researched:** 2026-03-19
**Domain:** Next.js 16 App Router, Better Auth RBAC, Drizzle ORM + PostgreSQL, Effect.js service layer, BigNumber.js financial arithmetic, shadcn/ui + Tailwind v4
**Confidence:** HIGH (all primary claims verified against official docs or installed packages)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**App Shell & Navigation**
- Layout: Top bar (branding + user avatar/logout) + collapsible left sidebar. Sidebar collapses to icon-only rail; expands on toggle.
- Sidebar groups and items (full nav from day one): (ungrouped) Dashboard; Operations: Customers, Loans, Payments; Capital: Creditors, Expenses & Income; Insights: Reports; System: Admin
- Unbuilt sections (Payments, Creditors, Expenses & Income, Reports in Phase 1) are visible but grayed out — not hidden.
- User avatar and logout live at the bottom of the sidebar.

**Auth UX**
- Auth pages: Custom-built login, register, and forgot-password pages using our own components + Tailwind. Better Auth handles the logic; we own the UI. No pre-built Better Auth UI components.
- Login method: Email + password only. No username-based login.
- Unassigned user landing: Dedicated "pending approval" page — no sidebar, no nav, just a clear message and contact info. Shown to any user with the Unassigned role after login.
- Role promotion: Admin panel shows a user management table. Each row has an inline role dropdown — change and save without leaving the table.

**Customer Registration**
- Form placement: Dedicated page (`/customers/new`) — full-page inline form, not a modal or drawer.
- Fields: Full Name, Contact (phone/email), Physical Address.
- Detailed UI/UX design: Deferred to `/frontend-design` skill.

**Loan Issuance**
- Structure: Multi-step wizard with 3 steps: (1) Loan details: Amount, Start Date, Interest Rate (default 10%/month); (2) Collateral: Nature (land title, vehicle log book, etc.) — one item per loan; (3) Review & Confirm: Calculated summary + final confirmation
- Collateral: Captured on the loan form (Step 2), not pre-registered on the customer. One collateral item per loan.
- Detailed UI/UX design: Deferred to `/frontend-design` skill.

**Interest Calculation Preview (Review Step)**
- The Review step (Step 3) shows: daily interest amount (UGX), total interest at 30 days, total owed at 30 days (principal + interest), minimum interest period reminder.
- Calculated client-side using the Interest Engine (same function as server). Not real-time on keystroke — shown when user reaches the Review step.

**Component Library**
- Foundation: shadcn/ui — copy-paste components built on Radix UI primitives + Tailwind. Components live in the codebase (no runtime dependency).
- All Phase 1 UI components built using shadcn/ui primitives.

**Customer Profile Page (Phase 1 scope)**
- Sections: Basic info (editable), Customer status badge (display only), Active loan summary card (summary only), "Issue New Loan" CTA button
- Customer list: Data table with Name, Contact, Status columns. Row click navigates to customer profile.

### Claude's Discretion
- Data table column sorting, row hover states, empty state illustrations
- Sidebar collapse animation and icon selection
- Form field ordering within each step
- Error message copy and toast notification design
- Color scheme and typography (beyond Tailwind defaults) — handled by `/frontend-design`

### Deferred Ideas (OUT OF SCOPE)
- Detailed visual design (spacing, color palette, typography, component aesthetics) — handled by `/frontend-design` skill before or during Phase 1 implementation
- Data table column sorting and filtering on customer list — Phase 3 (CUST-05)
- Customer status change (Active/Blacklisted/Inactive) — Phase 3 (CUST-06)
- Full customer loan history view — Phase 3 (CUST-07)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUTH-01 | User can register, log in, reset password, and maintain sessions via Better Auth | Better Auth email+password setup, toNextJsHandler route, createAuthClient |
| AUTH-02 | New user accounts default to Unassigned on signup — zero permissions until role granted | Better Auth admin plugin `defaultRole` option; custom role definition |
| AUTH-03 | System enforces 3-tier role hierarchy via Better Auth roles plugin | createAccessControl, ac.newRole, adminPlugin({ ac, roles }) |
| AUTH-04 | System records login activity per user | Better Auth session table + audit log row on auth events |
| AUTH-05 | A user can only assign roles at or below their own level | Server-side permission check before setRole call; auth.api.userHasPermission |
| CUST-01 | Register customer with Full Name, Contact, Physical Address | Zod schema + Drizzle insert + Effect service |
| CUST-02 | View and edit customer profile | Drizzle update + Effect service + route handler |
| CUST-03 | Capture security/collateral details per loan | Collateral table schema, one row per loan |
| CUST-04 | Block loan issuance if required customer or collateral details are incomplete | Zod validation at API boundary; server-side guard before insert |
| LOAN-01 | Create loan: Amount, Date, Interest Rate (default 10%/month), linked Security | Loan table schema; wizard API route; Zod validation |
| LOAN-02 | 30-day default term, payment due at end of term | `term_days` column default 30; stored on loan record |
| LOAN-03 | Reducing-balance interest: `balance × daily_rate × days_elapsed`, computed on-demand | Interest Engine in `src/lib/interest/`; pure function; BigNumber arithmetic |
| LOAN-04 | All interest calculations use BigNumber (no native float) | BigNumber.js; NEVER use `*`, `/`, `+`, `-` on monetary JS numbers |
| LOAN-05 | Loan status lifecycle: Pending → Active → Partially Paid → Fully Paid → Defaulted | `status` enum column on loan table |
| LOAN-10 | 30-day minimum interest period | Interest Engine enforces minimum; parameter on calculation function |
| LOAN-11 | Admin can override minimum interest period and default rate per loan or globally | `interest_rate_override`, `min_period_override` nullable columns; admin settings table |
| INFR-01 | PostgreSQL with NUMERIC(15,2) monetary columns, audit log table, schema migrations | Drizzle `numeric({ precision: 15, scale: 2 })`, `db.transaction(tx => ...)` |
| INFR-02 | RESTful API (Next.js Route Handlers) with Zod validation and consistent error handling | `src/app/api/*/route.ts`; Zod parse; Effect error channel |
| INFR-03 | Responsive frontend for desktop and tablet; all monetary values in UGX | Tailwind responsive classes; BigNumber.toFixed(2) for display |
| INFR-05 | All monetary arithmetic uses BigNumber — no native float | BigNumber.js enforced throughout service layer and Interest Engine |
| INFR-06 | Effect.js throughout service layer — all service functions return Effect<S, E, R> | `Data.TaggedError`, `Effect.gen`, `Layer.effect`, `Context.Tag` |
</phase_requirements>

---

## Summary

Phase 1 builds the immutable foundation: database schema, authentication/RBAC, customer management, loan issuance, and the Interest Engine. The technology choices are all pre-decided in PROJECT.md — the research question is how to implement them correctly given the current stack.

The most significant discovery from this research is a **Next.js 16 breaking change**: `middleware.ts` has been deprecated and renamed to `proxy.ts`. The exported function must be named `proxy` (not `middleware`). This affects where Better Auth's session guard runs. Implementing the auth gate in the old `middleware.ts` filename will silently fail or produce unexpected behavior in this project's version of Next.js.

The second critical discovery: Better Auth's admin plugin does not ship a built-in "role hierarchy prevents upward promotion" rule out of the box. The `AUTH-05` requirement (users can only assign roles at or below their own level) must be enforced with an explicit server-side permission check — a custom guard that reads the acting user's role and rejects the request if the target role is above it. This cannot be expressed purely through the access control statement definitions.

Better Auth integrates natively with Drizzle via `drizzleAdapter`. Running `npx auth@latest generate` produces the SQL schema for Better Auth tables; those tables are then co-located in the same Drizzle schema file as the application tables. The workflow is: generate Better Auth schema → define application tables alongside → run `drizzle-kit migrate`.

**Primary recommendation:** Set up Better Auth + Drizzle together from Wave 0. The auth schema and application schema share the same migration pipeline and database instance. Don't implement them in separate waves.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-auth | 1.5.5 | Auth, sessions, RBAC | Project constraint; self-hosted; admin plugin handles role management |
| drizzle-orm | 0.45.1 | PostgreSQL ORM | Project decision; type-safe schema; native numeric support; transaction API |
| drizzle-kit | 0.31.10 | Schema migrations | Companion to drizzle-orm; `generate` + `migrate` workflow |
| effect | 3.20.0 | Service layer / typed errors | Project constraint (INFR-06) |
| bignumber.js | 10.0.2 | Financial arithmetic | Project constraint (INFR-05); exact decimal math |
| zod | 4.3.6 | API input validation | Standard with Next.js Route Handlers; composable schemas |
| postgres | 3.4.8 | PostgreSQL driver | Drizzle-recommended driver for Node.js |
| shadcn/ui | 4.0.8 (CLI) | Component library | Project decision; components copied into codebase, no runtime dep |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.1.0 | Unit testing | Required for Interest Engine and service layer tests |
| @testing-library/react | 16.3.2 | React component testing | UI unit tests for wizard steps |
| @testing-library/user-event | 14.6.1 | User interaction simulation | Form interaction tests |
| @vitejs/plugin-react | 6.0.1 | React support for Vitest | Required when testing React components with Vitest |
| lucide-react | (via shadcn) | Icons | Sidebar nav icons; recommended by shadcn |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| bignumber.js | decimal.js | Both are valid; bignumber.js has cleaner API for multiply/divide chains |
| postgres driver | pg (node-postgres) | Both work with Drizzle; `postgres` is more modern and Promise-native |
| vitest | jest | Vitest is faster and native ESM; no transform config needed with Next.js |

**Installation (new dependencies only — project has Next.js/React/Tailwind/TS already):**

```bash
pnpm add better-auth drizzle-orm postgres effect bignumber.js zod
pnpm add -D drizzle-kit vitest @vitejs/plugin-react @testing-library/react @testing-library/user-event @types/bignumber.js
pnpm dlx shadcn@latest init -t next
```

**Version verification — confirmed 2026-03-19 against npm registry:**
- better-auth@1.5.5, drizzle-orm@0.45.1, drizzle-kit@0.31.10, effect@3.20.0, bignumber.js@10.0.2, zod@4.3.6, postgres@3.4.8

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── app/
│   ├── (auth)/                   # Auth route group — no app shell
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   └── forgot-password/page.tsx
│   ├── (app)/                    # Protected route group — app shell layout
│   │   ├── layout.tsx            # Sidebar + top bar layout
│   │   ├── dashboard/page.tsx
│   │   ├── customers/
│   │   │   ├── page.tsx          # Customer list
│   │   │   ├── new/page.tsx      # Customer registration form
│   │   │   └── [id]/page.tsx     # Customer profile
│   │   ├── loans/
│   │   │   ├── page.tsx          # Loan list
│   │   │   └── new/page.tsx      # Loan issuance wizard
│   │   └── admin/page.tsx        # User management table
│   ├── api/
│   │   ├── auth/[...all]/route.ts   # Better Auth handler
│   │   ├── customers/route.ts
│   │   ├── customers/[id]/route.ts
│   │   ├── loans/route.ts
│   │   └── users/[id]/role/route.ts
│   ├── pending-approval/page.tsx    # Unassigned user landing
│   └── globals.css
├── lib/
│   ├── auth.ts                   # Better Auth server instance
│   ├── auth-client.ts            # Better Auth browser client
│   ├── db/
│   │   ├── index.ts              # Drizzle db instance
│   │   └── schema/
│   │       ├── auth.ts           # Better Auth generated schema
│   │       ├── customers.ts
│   │       ├── loans.ts
│   │       └── audit.ts
│   └── interest/
│       └── engine.ts             # Interest Engine (pure BigNumber functions)
├── services/
│   ├── customer.service.ts       # Effect-based customer operations
│   ├── loan.service.ts           # Effect-based loan operations
│   └── audit.service.ts          # Audit log writes (called inside transactions)
├── components/
│   └── ui/                       # shadcn/ui copied components
└── proxy.ts                      # Auth gate (NOT middleware.ts — see critical note)
```

### Pattern 1: Better Auth with Drizzle Adapter

**What:** Configure Better Auth to use the same Drizzle `db` instance as the application. Generate Better Auth tables via CLI, then run Drizzle migrations.

**When to use:** All auth operations — signup, login, session checks, role assignment.

```typescript
// src/lib/auth.ts
// Source: https://www.better-auth.com/docs/adapters/drizzle
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { admin } from "better-auth/plugins"
import { db } from "./db"
import { ac, superAdminRole, adminRole, loanOfficerRole, unassignedRole } from "./permissions"

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  plugins: [
    admin({
      ac,
      roles: { superAdmin: superAdminRole, admin: adminRole, loanOfficer: loanOfficerRole, unassigned: unassignedRole },
      defaultRole: "unassigned",
    })
  ]
})
```

```typescript
// src/app/api/auth/[...all]/route.ts
// Source: https://www.better-auth.com/docs/installation
import { auth } from "@/lib/auth"
import { toNextJsHandler } from "better-auth/next-js"

export const { POST, GET } = toNextJsHandler(auth)
```

### Pattern 2: Proxy (NOT middleware.ts) for Auth Gate

**CRITICAL BREAKING CHANGE IN NEXT.JS 16:** The `middleware.ts` file convention is deprecated and has been renamed to `proxy.ts`. The exported function must be named `proxy`, not `middleware`. Running a codemod is available: `npx @next/codemod@canary middleware-to-proxy .`

**What:** Gate all `(app)` routes — redirect unauthenticated users to `/login`, redirect unassigned users to `/pending-approval`.

**When to use:** Optimistic route protection. The proxy reads the session cookie for fast redirects. The real security check happens in each Route Handler via the Data Access Layer.

```typescript
// src/proxy.ts  (NOT src/middleware.ts)
// Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"

export async function proxy(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: request.headers
  })

  const isAuthPage = request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/register") ||
    request.nextUrl.pathname.startsWith("/forgot-password")

  if (!session?.user) {
    if (isAuthPage) return NextResponse.next()
    return NextResponse.redirect(new URL("/login", request.url))
  }

  if (session.user.role === "unassigned") {
    if (request.nextUrl.pathname === "/pending-approval") return NextResponse.next()
    return NextResponse.redirect(new URL("/pending-approval", request.url))
  }

  if (isAuthPage) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
```

### Pattern 3: Drizzle Schema with NUMERIC(15,2) Monetary Columns

**What:** All monetary values stored as PostgreSQL NUMERIC(15,2). Drizzle returns these as strings by default — convert to BigNumber on read, convert back to string on write.

**When to use:** Every table with monetary amounts (loan principal, interest amounts, etc.).

```typescript
// src/lib/db/schema/loans.ts
// Source: https://orm.drizzle.team/docs/column-types/pg#numeric
import { pgTable, uuid, numeric, integer, timestamp, text, pgEnum } from "drizzle-orm/pg-core"

export const loanStatusEnum = pgEnum("loan_status", [
  "pending", "active", "partially_paid", "fully_paid", "defaulted"
])

export const loans = pgTable("loans", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  principalAmount: numeric("principal_amount", { precision: 15, scale: 2 }).notNull(),
  interestRate: numeric("interest_rate", { precision: 5, scale: 4 }).notNull(), // e.g. 0.1000 = 10%/month
  termDays: integer("term_days").notNull().default(30),
  minInterestDays: integer("min_interest_days").notNull().default(30),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  status: loanStatusEnum("status").notNull().default("pending"),
  issuedBy: text("issued_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})
```

### Pattern 4: Audit Log Written in Same Transaction

**What:** Every financial mutation (loan insert) includes an audit log insert in the same `db.transaction()` call. If either fails, both roll back.

**When to use:** Any route handler that creates, updates, or deletes a loan or financial record.

```typescript
// Source: https://orm.drizzle.team/docs/transactions
await db.transaction(async (tx) => {
  const [loan] = await tx.insert(loans).values(loanData).returning()

  await tx.insert(auditLog).values({
    id: crypto.randomUUID(),
    actorId: session.user.id,
    action: "loan.create",
    entityType: "loan",
    entityId: loan.id,
    beforeValue: null,
    afterValue: JSON.stringify(loan),
    occurredAt: new Date(),
  })
})
```

### Pattern 5: Effect.js Service with Typed Errors

**What:** All service functions return `Effect<Success, AppError, never>`. Errors are tagged Data classes. Route handlers run the effect and convert to HTTP responses.

**When to use:** Every function in `src/services/`.

```typescript
// Source: https://effect.website/docs/guides/error-management/expected-errors
import { Effect, Data } from "effect"

class CustomerNotFound extends Data.TaggedError("CustomerNotFound")<{ id: string }> {}
class ValidationError extends Data.TaggedError("ValidationError")<{ message: string }> {}
class DatabaseError extends Data.TaggedError("DatabaseError")<{ cause: unknown }> {}

// Service function signature pattern
const getCustomer = (id: string): Effect.Effect<Customer, CustomerNotFound | DatabaseError, never> =>
  Effect.tryPromise({
    try: () => db.select().from(customers).where(eq(customers.id, id)).then(rows => rows[0]),
    catch: (e) => new DatabaseError({ cause: e })
  }).pipe(
    Effect.flatMap(customer =>
      customer ? Effect.succeed(customer) : Effect.fail(new CustomerNotFound({ id }))
    )
  )
```

### Pattern 6: Interest Engine (Pure BigNumber Functions)

**What:** The Interest Engine is a set of pure functions in `src/lib/interest/engine.ts`. No side effects, no database calls. Takes principal, rate, and elapsed days; returns BigNumber result. Shared between server (route handlers) and client (wizard Review step — imported as a module).

**When to use:** Loan issuance API, Review step of the wizard, any future calculation that needs interest.

```typescript
// src/lib/interest/engine.ts
import BigNumber from "bignumber.js"

BigNumber.config({ DECIMAL_PLACES: 10, ROUNDING_MODE: BigNumber.ROUND_HALF_UP })

/**
 * Calculates reducing-balance interest.
 * Formula: interest = outstanding_balance × daily_rate × days_elapsed
 * Daily rate = monthly_rate / 30
 *
 * @param outstandingBalance - Current balance as string (from NUMERIC column)
 * @param monthlyRateDecimal - Monthly rate as string, e.g. "0.10" for 10%
 * @param daysElapsed - Number of calendar days
 * @param minInterestDays - Minimum days to charge (default 30)
 * @returns Interest amount as BigNumber
 */
export function calculateInterest(
  outstandingBalance: string,
  monthlyRateDecimal: string,
  daysElapsed: number,
  minInterestDays: number = 30
): BigNumber {
  const balance = new BigNumber(outstandingBalance)
  const monthlyRate = new BigNumber(monthlyRateDecimal)
  const dailyRate = monthlyRate.dividedBy(30)
  const effectiveDays = Math.max(daysElapsed, minInterestDays)
  return balance.multipliedBy(dailyRate).multipliedBy(effectiveDays)
}

/**
 * Returns interest formatted for display/storage (2 decimal places, string).
 */
export function formatAmount(amount: BigNumber): string {
  return amount.toFixed(2)
}
```

### Pattern 7: Better Auth Custom Roles for 3-Tier RBAC

**What:** Define four roles using `createAccessControl`. The `defaultRole: "unassigned"` option ensures new signups get the unassigned role automatically. AUTH-05 (role hierarchy) is enforced by a custom server-side guard.

```typescript
// src/lib/permissions.ts
// Source: https://www.better-auth.com/docs/plugins/admin
import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements, adminAc } from "better-auth/plugins/admin/access"

const statement = {
  ...defaultStatements,
  loan: ["create", "read", "update"],
  customer: ["create", "read", "update"],
  payment: ["create", "read", "update", "delete"],
  role: ["assign-loan-officer", "assign-admin", "assign-super-admin"],
} as const

export const ac = createAccessControl(statement)

export const unassignedRole = ac.newRole({})

export const loanOfficerRole = ac.newRole({
  loan: ["create", "read", "update"],
  customer: ["create", "read", "update"],
  payment: ["create", "read", "update", "delete"],
})

export const adminRole = ac.newRole({
  ...loanOfficerRole.statements,
  role: ["assign-loan-officer"],
  ...adminAc.statements,
})

export const superAdminRole = ac.newRole({
  ...adminRole.statements,
  role: ["assign-loan-officer", "assign-admin", "assign-super-admin"],
})
```

**AUTH-05 server-side guard (role hierarchy):**

```typescript
// In the role assignment route handler
// src/app/api/users/[id]/role/route.ts
const ROLE_LEVELS: Record<string, number> = {
  unassigned: 0,
  loanOfficer: 1,
  admin: 2,
  superAdmin: 3,
}

async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { role: targetRole } = await request.json()
  const actorLevel = ROLE_LEVELS[session.user.role ?? "unassigned"] ?? 0
  const targetLevel = ROLE_LEVELS[targetRole] ?? 0

  if (targetLevel >= actorLevel) {
    return Response.json({ error: "Cannot assign role at or above your own level" }, { status: 403 })
  }

  const { id } = await params
  await authClient.admin.setRole({ userId: id, role: targetRole })
  return Response.json({ success: true })
}
```

### Anti-Patterns to Avoid

- **Using `middleware.ts`:** In Next.js 16, the file must be `proxy.ts`. Using the old name will not run the auth gate. This is a silent failure.
- **Native float math on money:** Never `let total = amount * rate`. Always `new BigNumber(amount).multipliedBy(rate)`.
- **Drizzle numeric as JavaScript number:** By default, Drizzle returns NUMERIC columns as strings. Never parse to `parseFloat()`. Always pass the string directly to `new BigNumber(value)`.
- **Setting `mode: 'number'` on monetary columns:** This coerces NUMERIC to a JS float, defeating the purpose of NUMERIC(15,2) for money.
- **Writing audit log outside the transaction:** If the audit log insert is a separate `await` after the main mutation, a crash between them leaves an unlogged financial change.
- **Implementing role hierarchy in the access control statement only:** The `ac.newRole` system defines what actions each role can perform, not which roles can be assigned by which other roles. AUTH-05 requires an explicit guard in the route handler.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session management, cookie rotation, secure password hashing | Custom auth middleware | better-auth | bcrypt timing attacks, cookie signing, session expiry are easy to get wrong |
| Database migrations | Manual SQL ALTER TABLE scripts | drizzle-kit generate + migrate | Schema drift, ordering conflicts, rollback without tooling is risky |
| Decimal arithmetic | Custom rounding functions | BigNumber.js | IEEE 754 float edge cases; 0.1 + 0.2 !== 0.3 |
| UI primitives (dialogs, dropdowns, focus trapping) | Custom React components | shadcn/ui (Radix UI) | Accessibility (ARIA, keyboard navigation) is non-trivial to implement correctly |
| Typed error handling | try/catch + console.error | Effect.js error channel | Untyped throws make error paths invisible to the type system |
| Form validation | Manual if/else checks | Zod | Complex conditional validation, coercion, error messages |

**Key insight:** In financial applications, correctness requirements in auth, arithmetic, and validation far exceed what hand-rolled solutions handle reliably.

---

## Common Pitfalls

### Pitfall 1: Using `middleware.ts` Instead of `proxy.ts`

**What goes wrong:** Auth gate silently does not run. All routes are unprotected. No error is thrown.
**Why it happens:** Next.js 16 renamed `middleware.ts` to `proxy.ts` (v16.0.0). Training data knows `middleware.ts`.
**How to avoid:** Create `src/proxy.ts` (or root `proxy.ts`). Export function named `proxy`, not `middleware`.
**Warning signs:** Protected routes accessible without login; no redirect to `/login`.

### Pitfall 2: Drizzle NUMERIC Returns String, Not Number

**What goes wrong:** Code does `loan.principalAmount * 1.1` — result is NaN or string concatenation.
**Why it happens:** PostgreSQL NUMERIC columns map to JavaScript strings in Drizzle by default to preserve precision.
**How to avoid:** Always wrap in `new BigNumber(loan.principalAmount)` before arithmetic. Never use `parseFloat` on monetary fields.
**Warning signs:** TypeScript type for numeric column shows `string`, not `number`.

### Pitfall 3: Better Auth Admin Plugin Does Not Enforce Role Hierarchy

**What goes wrong:** A Loan Officer calls `setRole` to assign `admin` to another user. The plugin allows it.
**Why it happens:** The admin plugin's access control system controls what actions users can perform, not which roles they can assign to others. Role hierarchy is not a built-in concept.
**How to avoid:** Add server-side guard in the role assignment route handler comparing actor role level to target role level (see Pattern 7 above).
**Warning signs:** AUTH-05 passing visual testing but failing when a Loan Officer account tries role escalation.

### Pitfall 4: Audit Log Written Outside Transaction

**What goes wrong:** Loan is created but audit log row is missing if the second `await` fails.
**Why it happens:** Developer writes two separate `await db.insert(...)` calls without wrapping in `db.transaction()`.
**How to avoid:** Wrap both inserts in `db.transaction(async (tx) => { ... })`. Use `tx.insert()` not `db.insert()` inside.
**Warning signs:** Audit log table has fewer rows than the loan table.

### Pitfall 5: BigNumber.config Not Set Globally

**What goes wrong:** Division results have 20+ decimal places. Display shows `1.3333333333333333...` UGX.
**Why it happens:** BigNumber defaults to 20 decimal places for division.
**How to avoid:** Call `BigNumber.config({ DECIMAL_PLACES: 10, ROUNDING_MODE: BigNumber.ROUND_HALF_UP })` at the top of `engine.ts`. Use `.toFixed(2)` for all display/storage conversions.
**Warning signs:** Interest calculations return strings with many decimal places.

### Pitfall 6: shadcn/ui Init Fails or Uses Wrong Style with Tailwind v4

**What goes wrong:** Default style `"default"` is deprecated in shadcn/ui with Tailwind v4. Components may not render correctly.
**Why it happens:** shadcn v4+ automatically uses `"new-york"` style for Tailwind v4 projects.
**How to avoid:** Run `pnpm dlx shadcn@latest init -t next`. The CLI detects Tailwind v4 and configures correctly. Do not manually select `"default"` style.
**Warning signs:** Component variants not applying, CSS variable errors in console.

### Pitfall 7: Effect.js Run Outside of Main Entry Point

**What goes wrong:** `Effect.runPromise(...)` inside a React component or server component causes runtime errors.
**Why it happens:** Effects should be run at the edge of the system (route handlers), not deep in UI components.
**How to avoid:** Run effects only in Route Handlers or Server Actions: `const result = await Effect.runPromise(serviceFunction(args))`. Services return Effects; route handlers run them.
**Warning signs:** "Effect cannot be run in this context" errors.

---

## Code Examples

### Effect Service Function Pattern (verified)

```typescript
// Source: https://effect.website/docs/guides/error-management/expected-errors
import { Effect, Data } from "effect"
import { db } from "@/lib/db"
import { customers } from "@/lib/db/schema/customers"
import { eq } from "drizzle-orm"

class CustomerNotFound extends Data.TaggedError("CustomerNotFound")<{ id: string }> {}
class DbError extends Data.TaggedError("DbError")<{ cause: unknown }> {}

export const getCustomer = (id: string) =>
  Effect.tryPromise({
    try: () => db.select().from(customers).where(eq(customers.id, id)),
    catch: (e) => new DbError({ cause: e }),
  }).pipe(
    Effect.flatMap((rows) =>
      rows[0]
        ? Effect.succeed(rows[0])
        : Effect.fail(new CustomerNotFound({ id }))
    )
  )

// Route handler usage:
// const customer = await Effect.runPromise(getCustomer(id))
```

### Drizzle Transaction with Audit Log

```typescript
// Source: https://orm.drizzle.team/docs/transactions
import { db } from "@/lib/db"
import { loans, auditLog } from "@/lib/db/schema"

export async function createLoanWithAudit(loanData: NewLoan, actorId: string) {
  return db.transaction(async (tx) => {
    const [loan] = await tx.insert(loans).values(loanData).returning()

    await tx.insert(auditLog).values({
      id: crypto.randomUUID(),
      actorId,
      action: "loan.create",
      entityType: "loan",
      entityId: loan.id,
      beforeValue: null,
      afterValue: JSON.stringify(loan),
      occurredAt: new Date(),
    })

    return loan
  })
}
```

### BigNumber Interest Calculation

```typescript
// Source: https://mikemcl.github.io/bignumber.js/
import BigNumber from "bignumber.js"

BigNumber.config({ DECIMAL_PLACES: 10, ROUNDING_MODE: BigNumber.ROUND_HALF_UP })

// Loan: 500,000 UGX, 10%/month, 45 days elapsed, 30-day minimum
const balance = new BigNumber("500000")         // from DB string
const monthlyRate = new BigNumber("0.10")       // 10%/month
const dailyRate = monthlyRate.dividedBy(30)     // 0.003333...
const effectiveDays = Math.max(45, 30)          // 45 (above minimum)
const interest = balance.multipliedBy(dailyRate).multipliedBy(effectiveDays)
const displayAmount = interest.toFixed(2)       // "75000.00"

// For storage back to DB (returns string, compatible with NUMERIC column):
const storageValue = interest.toFixed(2)        // "75000.00"
```

### Drizzle NUMERIC Column Definition

```typescript
// Source: https://orm.drizzle.team/docs/column-types/pg#numeric
import { numeric, pgTable, uuid, timestamp } from "drizzle-orm/pg-core"

// DO NOT use mode: 'number' for monetary columns — it coerces to JS float
export const loans = pgTable("loans", {
  id: uuid("id").primaryKey().defaultRandom(),
  principalAmount: numeric("principal_amount", { precision: 15, scale: 2 }).notNull(),
  interestRate: numeric("interest_rate", { precision: 5, scale: 4 }).notNull(),
})
// principalAmount type in TypeScript: string
// Use: new BigNumber(loan.principalAmount) for arithmetic
```

### Next.js Route Handler with Zod Validation

```typescript
// Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
import { z } from "zod"
import type { NextRequest } from "next/server"
import { auth } from "@/lib/auth"

const CreateCustomerSchema = z.object({
  fullName: z.string().min(1).max(255),
  contact: z.string().min(1),
  address: z.string().min(1),
})

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const parsed = CreateCustomerSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // ... service call
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `middleware.ts` / `export function middleware()` | `proxy.ts` / `export function proxy()` | Next.js v16.0.0 | Must use new filename and function name for auth gate |
| `getServerSideProps` for auth | DAL `verifySession()` + `cache()` in Server Components | Next.js 13+ (stable in 15+) | No need for per-page auth wrappers |
| `context.params` as plain object | `context.params` is a Promise — must `await params` | Next.js v15.0.0-RC | All dynamic route handlers must `await params` |
| GET handlers cached by default | GET handlers are dynamic by default | Next.js v15.0.0-RC | No stale data for auth-gated routes |
| `shadcn/ui` "default" style | "new-york" style (default is deprecated with Tailwind v4) | shadcn v4+ | Use `shadcn@latest init` — CLI auto-selects correct style |
| `tailwindcss-animate` | `tw-animate-css` | shadcn v4+ | Replace animation dependency |
| `forwardRef` wrappers on shadcn components | Removed; direct ref forwarding | shadcn v4 / React 19 | Cleaner component APIs |

**Deprecated/outdated:**
- `middleware.ts`: Replaced by `proxy.ts` in Next.js 16. Codemod available.
- shadcn "default" style: Deprecated in favor of "new-york" for Tailwind v4 projects.
- `tailwindcss-animate`: Replaced by `tw-animate-css` in shadcn v4.

---

## Open Questions

1. **Better Auth session cookie in `proxy.ts`**
   - What we know: `auth.api.getSession({ headers: request.headers })` is the documented server-side session check. The proxy docs say to read from cookies for optimistic checks.
   - What's unclear: Whether Better Auth's `getSession` performs a database lookup in the proxy context, which could be slow on every request. If so, a lightweight cookie-only check may be preferred for the proxy, with the full DB session check deferred to the DAL.
   - Recommendation: Implement the cookie-only check in `proxy.ts` (read `better-auth.session_token` cookie) and call `auth.api.getSession` only in Route Handlers. Verify Better Auth docs for `getSession` performance characteristics before implementation.

2. **Better Auth `generate` schema output location**
   - What we know: `npx auth@latest generate` produces schema files, but the output path may need to be configured to co-locate with Drizzle schema files.
   - What's unclear: Exact CLI flags for output path.
   - Recommendation: Run `npx auth@latest generate` in a test environment first and inspect the output. Configure `--output` flag to place generated schema in `src/lib/db/schema/auth.ts`.

3. **Effect.js Layer wiring for the database dependency**
   - What we know: The `Layer.effect` pattern provides a `Database` service. Route handlers run effects with `Effect.runPromise`.
   - What's unclear: Whether passing the raw Drizzle `db` directly is cleaner than wrapping it in a Layer for Phase 1, given the small team size and lack of existing Effect infrastructure.
   - Recommendation: For Phase 1, use `Effect.tryPromise` directly in service functions (no Layer wiring needed) to avoid over-engineering. Introduce Layers in Phase 2 when the service graph becomes complex.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | `vitest.config.ts` — does not exist yet (Wave 0 gap) |
| Quick run command | `pnpm vitest run src/lib/interest/` |
| Full suite command | `pnpm vitest run` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LOAN-03 | `calculateInterest(balance, rate, days)` returns correct BigNumber | unit | `pnpm vitest run src/lib/interest/engine.test.ts` | Wave 0 gap |
| LOAN-04 | No native float arithmetic in calculation path | unit | `pnpm vitest run src/lib/interest/engine.test.ts` | Wave 0 gap |
| LOAN-10 | Minimum 30-day interest period enforced | unit | `pnpm vitest run src/lib/interest/engine.test.ts` | Wave 0 gap |
| INFR-05 | BigNumber used throughout; no `parseFloat` on money values | unit | `pnpm vitest run src/services/` | Wave 0 gap |
| AUTH-02 | New signup gets "unassigned" role | manual | N/A (requires DB + auth instance) | manual-only |
| AUTH-05 | Loan Officer cannot assign Admin role | manual | N/A (requires full auth stack) | manual-only |
| CUST-04 | Loan blocked if customer fields incomplete | unit | `pnpm vitest run src/services/loan.service.test.ts` | Wave 0 gap |
| INFR-01 | Audit log written in same transaction | unit | `pnpm vitest run src/services/` | Wave 0 gap |

### Sampling Rate

- **Per task commit:** `pnpm vitest run src/lib/interest/`
- **Per wave merge:** `pnpm vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `vitest.config.ts` — Vitest configuration with React plugin
- [ ] `src/lib/interest/engine.test.ts` — covers LOAN-03, LOAN-04, LOAN-10, INFR-05
- [ ] `src/services/customer.service.test.ts` — covers CUST-04
- [ ] `src/services/loan.service.test.ts` — covers INFR-01 (audit in transaction)

**Framework install (not yet in package.json):**
```bash
pnpm add -D vitest @vitejs/plugin-react @testing-library/react @testing-library/user-event
```

---

## Sources

### Primary (HIGH confidence)
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` — proxy.ts convention, breaking change from middleware.ts, version history confirming v16.0.0 change
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` — Route Handler HTTP methods, params as Promise, version history
- `node_modules/next/dist/docs/01-app/02-guides/authentication.md` — DAL pattern, verifySession, optimistic Proxy checks
- https://www.better-auth.com/docs/plugins/admin — admin plugin setup, createAccessControl, role assignment API
- https://www.better-auth.com/docs/installation — betterAuth config, emailAndPassword, Next.js route handler setup
- https://www.better-auth.com/docs/adapters/drizzle — drizzleAdapter setup, schema generation CLI
- https://orm.drizzle.team/docs/column-types/pg#numeric — numeric() API, precision/scale parameters
- https://orm.drizzle.team/docs/transactions — db.transaction(), savepoints, PostgreSQL isolation levels
- https://effect.website/docs/guides/error-management/expected-errors — Data.TaggedError, Effect.fail, catchAll
- https://effect.website/docs/guides/context-management/layers — Context.Tag, Layer.succeed, Layer.effect
- https://mikemcl.github.io/bignumber.js/ — BigNumber constructor, arithmetic API, config(), toFixed()
- https://ui.shadcn.com/docs/tailwind-v4 — Tailwind v4 compatibility, new-york style, tw-animate-css
- npm registry — verified package versions for all dependencies (2026-03-19)

### Secondary (MEDIUM confidence)
- https://www.better-auth.com/docs/authentication/email-password — signUp.email required fields, default user object shape
- https://www.better-auth.com/docs/concepts/session-management — getSession server-side via headers()
- https://ui.shadcn.com/docs/installation/next — `pnpm dlx shadcn@latest init -t next` command

### Tertiary (LOW confidence — needs verification during implementation)
- Better Auth `getSession` performance in proxy context (database hit vs. cookie-only): unverified
- Better Auth `npx auth@latest generate` CLI flags for custom output path: not tested

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified against npm registry 2026-03-19
- Architecture: HIGH — patterns verified against official Next.js 16 docs (in node_modules), Better Auth docs, Drizzle docs, Effect docs
- Next.js 16 proxy.ts breaking change: HIGH — directly confirmed in installed node_modules docs with version history table
- Pitfalls: HIGH for documented library behaviors; MEDIUM for AUTH-05 hierarchy gap (inferred from admin plugin docs not mentioning this use case)
- Interest Engine pattern: HIGH — BigNumber API confirmed against official docs

**Research date:** 2026-03-19
**Valid until:** 2026-04-19 for stable stack items; re-verify Better Auth if version changes
