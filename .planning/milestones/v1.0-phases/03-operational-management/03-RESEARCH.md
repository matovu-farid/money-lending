# Phase 3: Operational Management - Research

**Researched:** 2026-03-21
**Domain:** Dashboard aggregates, customer search/filter/status, watchlist, repayment simulator, in-app notifications
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Executive Dashboard (RPTS-01)**
- Layout: Two rows of 3 KPI summary cards at the top, recent activity feed below
- KPI cards (6 total): Loans Outstanding (UGX), Repayments Collected (UGX), Interest Earned (UGX), Active Borrowers (count), Overdue Count (count), Capital in System (UGX)
- Capital card: Shown from day one with UGX 0 — creditor data comes in Phase 4 but the card slot is pre-allocated for layout consistency
- Activity feed: Last 10 recent events (payments received, loans issued, overdue flags) in chronological order
- Data source: All KPIs are SQL-aggregated from the underlying transaction records — no cached/materialized values

**Customer Search & Filtering (CUST-05)**
- Placement: Enhance the existing customers data table — add search bar + filter dropdowns above the table
- Search: By customer name (text search)
- Filters: Customer status (Active/Blacklisted/Inactive), loan status, days remaining
- Pagination: Server-side pagination on the enhanced table

**Customer Status Management (CUST-06)**
- UX pattern: Inline dropdown on customer profile page — status badge becomes a dropdown, click to change, confirm with a reason
- Same pattern as: Role assignment dropdown in admin panel (Phase 1)
- Blacklist safeguard: Blacklisted customers are blocked from new loan issuance. Existing active loans continue normally. Attempt to issue a loan to a Blacklisted customer returns a validation error.
- Audit: Status changes logged with reason, acting user, and timestamp

**Customer Loan History (CUST-07)**
- Display: Loan cards on the customer profile page — each card shows loan amount, date, status, outstanding balance
- Expandable payments: Click a loan card to expand and see individual payments with interest/principal split
- Reuses: Existing loan detail patterns from Phase 2

**Borrower Watchlist (RISK-01, RISK-02)**
- Location: Dedicated /watchlist page with its own sidebar nav item
- Scope: Shows ONLY flagged borrowers (days_overdue >= 30) — not all active loans
- Calculation: Real-time on page load — calculates days overdue for all active loans using the Interest Engine, then filters to flagged. Does NOT depend on the cron job for data freshness.
- Days overdue display: Color-coded badge — green (0-14 days), yellow (15-29 days), red (30+ days). Badge appears on watchlist rows, loan cards, and customer profile.
- Table columns: Customer name, loan amount, outstanding balance, days overdue (badge), daily rate, last payment date

**Repayment Simulator (RISK-03, RISK-04)**
- Location: Inline on the existing loan detail page — "Simulate Payment" section
- Input: Single field: "Simulate payment of UGX ___"
- Display: Side-by-side comparison — current state on left, simulated state on right (before/after view showing days remaining, interest portion, principal portion, new balance)
- Engine: Uses the same `calculateInterest`, `calculateDailyRate`, and allocation logic as the real payment system (RISK-04 compliance — single implementation)
- Balance-to-days converter: Derived from the simulator — entering an amount shows how many days the borrower would have remaining

**In-App Due-Date Alerts (ALRT-01)**
- Trigger: Cron job generates alerts 5 days before a loan's due date (30-day cycle boundary)
- Storage: Notifications table — stores alert per user (Admin and Loan Officer roles)
- Display: Bell icon in the top bar with unread count badge. Click opens a dropdown listing alerts: "Loan #123 for [Customer] — due in X days"
- Dismissibility: Alerts are dismissible (mark-as-read) per user. Dismissed alerts stop showing in the dropdown. Other users retain their own copy.
- Target roles: Admin and Loan Officer only

### Claude's Discretion
- KPI card styling, spacing, and icon choices
- Activity feed item formatting and event type icons
- Search debounce timing and empty-state messaging
- Watchlist table sort order and column widths
- Simulator input validation and edge-case messaging (e.g., amount exceeds balance)
- Notification dropdown styling and "mark all as read" behavior
- Color-coded badge exact color values within the green/yellow/red scheme

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CUST-05 | Search and filter customers by name, status, loan status, days remaining — with pagination | Drizzle `ilike`, `inArray`, `and` operators support server-side filtering; server-side pagination via `limit`/`offset` |
| CUST-06 | Set customer status: Active, Blacklisted, Inactive | `customerStatusEnum` already defined; inline dropdown pattern mirrors admin panel role assignment; `writeAuditLog` captures reason |
| CUST-07 | View customer's full loan history — all past and current loans with payment breakdown | Existing `listLoansAction` + loan detail patterns from Phase 2; expandable card pattern |
| RISK-01 | Display "days overdue" per loan using formula: unpaid_interest / current_daily_rate | `calculateDaysOverdue()` already implemented in `engine.ts`; real-time calculation on page load |
| RISK-02 | Auto-flag borrowers with days_overdue >= 30 on a watchlist | Filter in service function after calculating all active loans; no cron dependency |
| RISK-03 | Simulate repayments: "If borrower pays X, how many days will they have left?" | Pure `allocatePayment()` call client-side (no DB); result fed back into `calculateDaysOverdue()` |
| RISK-04 | Repayment simulator uses same calculation engine as the cron | `allocatePayment` + `calculateDaysOverdue` already in `engine.ts`; simulator imports the same functions — no duplication |
| ALRT-01 | In-app alert to Admin and Loan Officer 5 days before loan's 30-day cycle due date | New `notifications` schema table; extend existing cron at `/api/cron/overdue`; bell icon in `top-bar.tsx` |
| RPTS-01 | Executive dashboard: total loans outstanding, repayments collected, interest earned, capital in system, active borrowers, overdue count | SQL aggregates via Drizzle; `sum()`, `count()` on loans/payments tables; capital card returns 0 (Phase 4 deferred) |
</phase_requirements>

---

## Summary

Phase 3 builds on a strong foundation: the Interest Engine (`engine.ts`) is complete and battle-tested, the customer/loan/payment schemas are final, and the server action + Effect.js service pattern is well established. This phase is almost entirely additive — no schema breaking changes are needed except adding a `notifications` table for ALRT-01.

The biggest architectural risk is the notifications bell: it requires a new schema table, extending the cron endpoint, and adding a real-time unread-count indicator to the top bar. The top bar currently has no data-fetching capability (it's a pure presentational server component). It will need a client island for the bell to poll or reactively update the unread count.

The watchlist and repayment simulator are straightforward: they reuse existing Interest Engine functions and follow the established server component + client island pattern. The executive dashboard KPIs are pure SQL aggregates — no cache layer needed at this scale.

**Primary recommendation:** Build in this order: (1) Schema migration for `notifications` table, (2) Dashboard KPIs, (3) Customer search/filter/pagination, (4) Customer status change + loan history, (5) Watchlist page, (6) Repayment simulator, (7) Notification bell + cron extension.

---

## Standard Stack

### Core (already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | 0.45.1 | DB queries, aggregates, filtering | Already the project ORM; `sum()`, `count()`, `ilike`, `and` cover all Phase 3 needs |
| effect | 3.21.0 | Typed service layer | Project standard; all services return `Effect<S, E, never>` |
| bignumber.js | 10.0.2 | Monetary arithmetic | Project rule — no native floats on money values ever |
| next | 16.2.0 | Server Actions, route handlers, cron endpoint | App framework |
| lucide-react | 0.577.0 | Icons (Bell, BellDot, Search, Filter, etc.) | Already in use throughout app |
| sonner | 2.0.7 | Toast notifications | Already installed and used |

### No New Dependencies Required

All Phase 3 functionality is achievable with the installed stack. The notifications bell (ALRT-01) is a custom component — no third-party notification library needed.

**Verification:** Checked `package.json` — all required libraries are present.

---

## Architecture Patterns

### Recommended Project Structure (Phase 3 additions)

```
src/
├── app/(app)/
│   ├── dashboard/
│   │   └── page.tsx              # Replace placeholder — server component, SQL aggregates
│   ├── customers/
│   │   ├── page.tsx              # Enhance with search/filter/pagination (CUST-05)
│   │   └── [id]/
│   │       └── page.tsx          # Add status change dropdown + full loan history (CUST-06, CUST-07)
│   └── watchlist/
│       └── page.tsx              # New route — server component + client island (RISK-01, RISK-02)
├── app/(app)/loans/[loanId]/
│   └── loan-detail-client.tsx    # Add simulator section (RISK-03, RISK-04)
├── app/api/
│   └── cron/
│       └── overdue/
│           └── route.ts          # Extend to write notifications (ALRT-01)
├── components/
│   └── layout/
│       └── top-bar.tsx           # Add bell icon client island (ALRT-01)
├── lib/db/schema/
│   └── notifications.ts          # New schema table (ALRT-01)
├── services/
│   ├── customer.service.ts       # Add searchCustomers, changeCustomerStatus
│   ├── dashboard.service.ts      # New — SQL aggregate queries (RPTS-01)
│   ├── watchlist.service.ts      # New — real-time overdue calculation (RISK-01, RISK-02)
│   └── notification.service.ts   # New — CRUD for notifications (ALRT-01)
├── actions/
│   ├── customer.actions.ts       # Add search/filter/status actions
│   ├── dashboard.actions.ts      # New — KPI aggregates
│   ├── watchlist.actions.ts      # New — watchlist data
│   └── notification.actions.ts   # New — mark-as-read, list, unread count
└── types/index.ts                # Add Notification type, CustomerSearchParams
```

### Pattern 1: Server Component + Client Island (established project pattern)

**What:** `page.tsx` is an async Server Component that fetches via `Effect.runPromise`. It passes data as props to a `*-client.tsx` Client Component for interactivity.

**When to use:** All pages. Server components handle data fetching; client components handle state, user input, and reactivity.

**Example (established pattern from loan detail page):**
```typescript
// page.tsx — Server Component
export default async function WatchlistPage() {
  const data = await Effect.runPromise(getWatchlistData())
  return <WatchlistClient initialData={data} />
}

// watchlist-client.tsx — Client Component
"use client"
export function WatchlistClient({ initialData }: Props) {
  const [data] = useState(initialData)
  // render table
}
```

### Pattern 2: Drizzle SQL Aggregates for Dashboard KPIs

**What:** Use Drizzle's `sql` template, `sum()`, `count()` helpers for aggregate queries directly in service functions.

**When to use:** Dashboard totals — no need for a separate analytics layer at this scale.

**Example:**
```typescript
// Source: Drizzle ORM docs — aggregate functions
import { sql, sum, count, eq } from "drizzle-orm"

const [stats] = await db
  .select({
    loansOutstanding: sum(loans.principalAmount),
    activeBorrowers: count(loans.id),
  })
  .from(loans)
  .where(eq(loans.status, "active"))
```

**CRITICAL:** `sum()` returns `string | null` in Drizzle (mapped from PostgreSQL NUMERIC). Always coerce with `new BigNumber(stats.loansOutstanding ?? "0")` before displaying.

### Pattern 3: Server-Side Search + Filter + Pagination

**What:** `listCustomers` is enhanced to accept a `CustomerSearchParams` object. Drizzle `ilike` handles name search; `inArray` handles status filter; `limit`/`offset` handle pagination.

**When to use:** CUST-05 customer table.

**Example:**
```typescript
import { ilike, inArray, and, sql, count } from "drizzle-orm"

export const searchCustomers = (params: CustomerSearchParams) =>
  Effect.tryPromise({
    try: async () => {
      const conditions = []
      if (params.name) conditions.push(ilike(customers.fullName, `%${params.name}%`))
      if (params.status?.length) conditions.push(inArray(customers.status, params.status))

      const [{ total }] = await db
        .select({ total: count() })
        .from(customers)
        .where(conditions.length ? and(...conditions) : undefined)

      const rows = await db
        .select()
        .from(customers)
        .where(conditions.length ? and(...conditions) : undefined)
        .limit(params.pageSize ?? 20)
        .offset((params.page ?? 0) * (params.pageSize ?? 20))

      return { rows, total }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

**Note:** `ilike` is case-insensitive on PostgreSQL — correct for name search. Avoid `like` (case-sensitive).

### Pattern 4: Simulator as Pure Client-Side Calculation

**What:** The repayment simulator runs entirely client-side — no Server Action, no network call. It imports `allocatePayment` and `calculateDaysOverdue` directly from `@/lib/interest/engine`.

**When to use:** RISK-03, RISK-04. The functions are pure (no DB calls) and can safely run in the browser.

**Example:**
```typescript
"use client"
import { allocatePayment, calculateDaysOverdue, calculateDailyRate } from "@/lib/interest/engine"

function simulate(hypotheticalAmount: string, loan: Loan, currentPrincipal: string) {
  const allocation = allocatePayment({
    paymentAmount: hypotheticalAmount,
    principalBalanceBefore: currentPrincipal,
    monthlyRateDecimal: loan.interestRateOverride ?? loan.interestRate,
    daysElapsed: 0,  // simulate from "now"
    minInterestDays: loan.minPeriodOverride ?? loan.minInterestDays,
  })

  const dailyRate = calculateDailyRate(loan.interestRateOverride ?? loan.interestRate)
  const daysRemaining = calculateDaysOverdue(/* ... */)

  return { allocation, daysRemaining }
}
```

**CRITICAL:** Import directly from `@/lib/interest/engine` (not a server-only module). The engine has no server-only imports and is already used in client-side context (loan wizard Review step).

### Pattern 5: Notification Bell as Client Island in Top Bar

**What:** The top bar is currently a pure Server Component (`top-bar.tsx`). The bell icon requires client-side interactivity (dropdown, mark-as-read). Implement as a `NotificationBell` client component embedded in the top bar.

**When to use:** ALRT-01.

**Implementation:**
```typescript
// top-bar.tsx — keep as Server Component, embed client island
import { NotificationBell } from "@/components/notifications/notification-bell"

export function TopBar({ onMenuClick }: TopBarProps) {
  return (
    <header ...>
      <div className="flex items-center gap-3 flex-1">
        {/* existing content */}
      </div>
      <NotificationBell />  {/* Client island */}
    </header>
  )
}

// notification-bell.tsx — Client Component
"use client"
export function NotificationBell() {
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  // fetch unread count on mount via Server Action
  // dropdown lists alerts, allows mark-as-read
}
```

### Pattern 6: Watchlist Real-Time Calculation

**What:** The watchlist service fetches all active loans + their payments, runs `calculateDaysOverdue` in-process for each loan, then filters to `daysOverdue >= 30`.

**When to use:** RISK-01, RISK-02. Mirrors the logic in the existing cron endpoint but returns the full enriched dataset to the UI.

**Implementation approach:**
```typescript
// watchlist.service.ts
export const getWatchlistData = () =>
  Effect.tryPromise({
    try: async () => {
      const activeLoans = await db.select().from(loans)
        .where(eq(loans.status, "active"))

      const results = await Promise.all(activeLoans.map(async (loan) => {
        const loanPayments = await db.select().from(payments)
          .where(and(eq(payments.loanId, loan.id), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate))

        // same calculation as cron
        const daysOverdue = /* calculateDaysOverdue(...) */

        // fetch customer for display
        const [customer] = await db.select().from(customers)
          .where(eq(customers.id, loan.customerId))

        return { loan, customer, daysOverdue, loanPayments }
      }))

      return results.filter(r => r.daysOverdue.isGreaterThanOrEqualTo(30))
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

**Performance note:** For the loan volumes this business handles (likely dozens to low hundreds of loans), in-process calculation per loan is fast enough. No caching needed in Phase 3.

### Anti-Patterns to Avoid

- **Storing days_overdue in DB:** Never persist calculated values — they go stale. Always compute on-demand from the payment table.
- **Separate interest formula in simulator:** The simulator MUST use `allocatePayment` from `engine.ts` — no inline math. RISK-04 is explicitly about single implementation.
- **Float arithmetic for totals:** Drizzle `sum()` returns a string from PostgreSQL NUMERIC. Pass directly to `new BigNumber(val ?? "0")` — never `parseFloat()`.
- **Zod in Server Actions:** Project rule. TypeScript types + runtime guards only (no Zod).
- **Effect.runPromise inside Drizzle transactions:** Established pitfall from Phase 1 — use plain `async`/`await` inside `db.transaction()` callbacks. Never call `Effect.runPromise` from inside a transaction.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Case-insensitive search | Custom LOWER() wrapper | `ilike()` from drizzle-orm | Built-in, index-compatible on PostgreSQL |
| Pagination total count | Two separate query functions | Drizzle `count()` in same service | Single round-trip possible with separate count query, avoids divergent logic |
| Interest calculation in simulator | Inline math in component | `allocatePayment()` from engine.ts | RISK-04 compliance — single implementation; engine already handles min-period, reducing-balance |
| Overdue calculation | New formula in watchlist service | `calculateDaysOverdue()` from engine.ts | Same reason — prevents formula drift |
| Notification persistence | In-memory store or localStorage | `notifications` Drizzle table | Per-user dismissal requires server-side persistence |
| Unread badge count | Full notification list fetch | Dedicated `getUnreadCount()` query | Avoids fetching all notification rows just to count |

**Key insight:** Phase 3 has almost no novel algorithms — it's wiring existing Interest Engine functions to new UI surfaces. The primary risk is accidentally writing a second formula somewhere.

---

## Common Pitfalls

### Pitfall 1: Drizzle `sum()` Returns `string | null`, Not Number

**What goes wrong:** Passing `stats.loansOutstanding` directly to `Intl.NumberFormat` or arithmetic — it's a string or null.
**Why it happens:** PostgreSQL NUMERIC maps to string in Drizzle to preserve precision. `null` when the aggregate finds no rows.
**How to avoid:** Always wrap: `new BigNumber(value ?? "0").toFixed(2)`
**Warning signs:** TypeScript will complain about `string | null` — don't silence with `as number`.

### Pitfall 2: `ilike` vs `like` — Case Sensitivity

**What goes wrong:** Using `like` for name search — it's case-sensitive on PostgreSQL, so "john" won't match "John".
**Why it happens:** Drizzle exposes both `like` and `ilike` — easy to pick wrong one.
**How to avoid:** Always use `ilike` for user-facing text search.

### Pitfall 3: Simulator Days Remaining — What Are We Measuring?

**What goes wrong:** "Days remaining" in the simulator is ambiguous. The formula is `days_overdue = unpaid_interest / current_daily_rate`. After a simulated payment, `unpaid_interest` decreases. If `unpaid_interest <= 0` after the payment, `daysOverdue = 0` — the borrower is current.
**Why it happens:** The term "days remaining" isn't a forward-looking forecast; it's backward-looking debt coverage.
**How to avoid:** Display as "Days overdue after payment: X" or "Days coverage: X". If the simulated result produces `daysOverdue <= 0`, show "Current (no overdue days)".

### Pitfall 4: Notification Fan-Out Per User

**What goes wrong:** Generating one notification row then sharing it across users — dismissal by one user removes it for all.
**Why it happens:** One-to-many pattern not thought through.
**How to avoid:** Insert one notification row **per target user** in the cron job. The `notifications` table should have a `userId` column. Each user has their own dismissible copy.
**Schema implication:** If 5 Admin/Loan Officer users exist, one loan approaching its due date generates 5 rows.

### Pitfall 5: Overdue Count on Dashboard — Stale vs Real-Time

**What goes wrong:** Storing overdue count in a cached column and showing that on the dashboard instead of recalculating.
**Why it happens:** Feels like a performance optimization.
**How to avoid:** The dashboard overdue count must be calculated the same way as the watchlist — via the Interest Engine over active loans. Use the same service function (or same query) that powers the watchlist. Do NOT read from a stored flag.

### Pitfall 6: Customer Status Change Without Loan Safeguard

**What goes wrong:** Changing a customer to Blacklisted doesn't immediately prevent new loans — loan issuance code doesn't check status.
**Why it happens:** Status change and loan issuance are separate flows.
**How to avoid:** Add a `customer.status === "blacklisted"` check at the start of `createLoan()` in `loan.service.ts`. Return a `ValidationError` with a clear message. This is a one-line guard but it's easy to miss.

### Pitfall 7: "Days Remaining" Filter in CUST-05 Requires Loan Join + Interest Calculation

**What goes wrong:** Treating "days remaining" as a simple DB column filter — it's not stored anywhere.
**Why it happens:** The filter label "days remaining" sounds like a DB field.
**How to avoid:** The days-remaining filter requires fetching active loans + their payments, computing `daysOverdue` via the Interest Engine, then filtering. This means the customer search service needs to optionally join loan data. Consider implementing this filter as an in-process post-filter on the server rather than a WHERE clause.

### Pitfall 8: The Cron "Due Date" Is Not a Column — It's Calculated

**What goes wrong:** Trying to query `WHERE loans.due_date BETWEEN now AND now+5` — there is no `due_date` column. Loans are perpetual.
**Why it happens:** The alert says "5 days before due date" but the schema has no due date.
**How to avoid:** The "due date" for ALRT-01 is the next 30-day cycle boundary. Calculate it as: `next_due_date = last_payment_date + 30 days` (or `loan.start_date + 30 days` if no payments yet). In the cron, find loans where this computed date falls within the next 5 days.

---

## Code Examples

### Dashboard KPI Aggregate Query

```typescript
// Source: Drizzle ORM docs + verified against drizzle-orm 0.45.1 API
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { sum, count, eq, isNull } from "drizzle-orm"

// Total outstanding principal (active loans only)
const [loanStats] = await db
  .select({
    totalOutstanding: sum(loans.principalAmount),
    activeBorrowers: count(loans.id),
  })
  .from(loans)
  .where(eq(loans.status, "active"))

// Total repayments collected (non-deleted payments)
const [paymentStats] = await db
  .select({
    totalCollected: sum(payments.amount),
    totalInterestEarned: sum(payments.interestPortion),
  })
  .from(payments)
  .where(isNull(payments.deletedAt))

// Capital in system — returns "0.00" in Phase 3 (creditors Phase 4)
const capitalInSystem = "0.00"
```

### Notifications Schema (new table)

```typescript
// src/lib/db/schema/notifications.ts
import { pgTable, uuid, text, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core"
import { loans } from "./loans"

export const notificationTypeEnum = pgEnum("notification_type", [
  "loan_due_soon",
])

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),         // Better Auth user id
  loanId: uuid("loan_id").notNull().references(() => loans.id),
  type: notificationTypeEnum("type").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  dueDate: timestamp("due_date", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})
```

### Cron: Compute Next Due Date

```typescript
// Loans are perpetual — due date = last payment date + 30 days, or start + 30 if no payments
const lastPayment = loanPayments.at(-1)  // sorted by paymentDate ASC
const referenceDate = lastPayment
  ? new Date(lastPayment.paymentDate)
  : new Date(loan.startDate)

const nextDueDate = new Date(referenceDate)
nextDueDate.setDate(nextDueDate.getDate() + 30)

const daysUntilDue = Math.floor(
  (nextDueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
)

if (daysUntilDue >= 0 && daysUntilDue <= 5) {
  // generate notifications for admin + loan officer users
}
```

### Customer Status Change with Audit

```typescript
// In customer.service.ts — follows existing updateCustomer pattern
export const changeCustomerStatus = (
  id: string,
  newStatus: CustomerStatus,
  reason: string,
  actorId: string
): Effect.Effect<Customer, CustomerNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [current] = await tx.select().from(customers).where(eq(customers.id, id))
        if (!current) throw { _tag: "CustomerNotFound", id }

        const [updated] = await tx
          .update(customers)
          .set({ status: newStatus, updatedAt: new Date() })
          .where(eq(customers.id, id))
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "status_change",
          entityType: "customer",
          entityId: id,
          beforeValue: { status: current.status },
          afterValue: { status: newStatus, reason },
        })

        return updated
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

---

## New Schema: Notifications Table

This is the only schema migration required in Phase 3.

```typescript
// File: src/lib/db/schema/notifications.ts
// Export from: src/lib/db/schema/index.ts

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  loanId: uuid("loan_id").references(() => loans.id),
  type: notificationTypeEnum("type").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  dueDate: timestamp("due_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})
```

Migration workflow: `pnpm db:generate` then `pnpm db:migrate`.

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| Route Handlers for data mutations | Server Actions (direct function calls) | Project decision from memory — use Server Actions |
| Zod validation in Server Actions | TypeScript types + runtime string guards | Project decision — no Zod in Server Actions |
| Storing calculated interest | On-demand from payment history | Core architectural decision — never store calculated interest |
| Cron writes financial values | Cron detection-only, no financial math | Established in Phase 2 (INFR-04) |

---

## Validation Architecture

`nyquist_validation` is enabled in `.planning/config.json`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 + Cypress 15.12.0 |
| Config file | `vitest.config.ts` (check root) or inherited from vite |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test && pnpm test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CUST-05 | Search by name returns filtered results; pagination works | e2e (Cypress) | `pnpm cypress:run --spec "cypress/e2e/customer-search.cy.ts"` | ❌ Wave 0 |
| CUST-06 | Status change persists; blacklisted customer blocked from new loan | e2e (Cypress) | `pnpm cypress:run --spec "cypress/e2e/customer-status.cy.ts"` | ❌ Wave 0 |
| CUST-07 | Customer profile shows all loans with expandable payments | e2e (Cypress) | `pnpm cypress:run --spec "cypress/e2e/customer-history.cy.ts"` | ❌ Wave 0 |
| RISK-01 | `calculateDaysOverdue()` returns correct value for known inputs | unit (Vitest) | `pnpm test -- --grep "calculateDaysOverdue"` | ❌ Wave 0 (engine.ts exists, tests don't) |
| RISK-02 | Watchlist filters to only days_overdue >= 30 | unit (Vitest) | `pnpm test -- --grep "watchlist"` | ❌ Wave 0 |
| RISK-03 | Simulator shows before/after for known payment amount | e2e (Cypress) | `pnpm cypress:run --spec "cypress/e2e/repayment-simulator.cy.ts"` | ❌ Wave 0 |
| RISK-04 | Simulator allocation matches allocatePayment() output | unit (Vitest) | `pnpm test -- --grep "simulator allocation"` | ❌ Wave 0 |
| ALRT-01 | Bell icon shows unread count; clicking marks as read | e2e (Cypress) | `pnpm cypress:run --spec "cypress/e2e/notifications.cy.ts"` | ❌ Wave 0 |
| RPTS-01 | Dashboard KPI values match sum of underlying records | e2e (Cypress) | `pnpm cypress:run --spec "cypress/e2e/dashboard.cy.ts"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test` (Vitest unit tests only, fast)
- **Per wave merge:** `pnpm test && pnpm test:e2e`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `cypress/e2e/customer-search.cy.ts` — covers CUST-05
- [ ] `cypress/e2e/customer-status.cy.ts` — covers CUST-06 (status change + blacklist safeguard)
- [ ] `cypress/e2e/customer-history.cy.ts` — covers CUST-07
- [ ] `src/__tests__/interest-engine.test.ts` — unit tests for `calculateDaysOverdue`, `allocatePayment` (covers RISK-01, RISK-04)
- [ ] `cypress/e2e/repayment-simulator.cy.ts` — covers RISK-03
- [ ] `cypress/e2e/notifications.cy.ts` — covers ALRT-01
- [ ] `cypress/e2e/dashboard.cy.ts` — covers RPTS-01

---

## Open Questions

1. **Cron deduplication for ALRT-01**
   - What we know: The cron runs once (triggered externally). If it runs multiple times in the same day, it will generate duplicate notifications.
   - What's unclear: Is the cron guaranteed to run once per day, or could it run multiple times?
   - Recommendation: Add a `UNIQUE(userId, loanId, DATE(createdAt))` constraint on the notifications table, or check for existing notifications before inserting. The `ON CONFLICT DO NOTHING` pattern in the cron insert is safest.

2. **Days remaining filter in CUST-05 — performance approach**
   - What we know: "Days remaining" is not a DB column — it requires computing `daysOverdue` for all active loans per customer.
   - What's unclear: How many customers will there be? If thousands, in-process post-filtering is slow.
   - Recommendation: For Phase 3, implement as in-process filter (fetch customers + their active loans, compute, filter). Add a note that this is a known scaling consideration for Phase 4+.

3. **Bell notification polling frequency**
   - What we know: The cron triggers alerts; the bell needs to show the current unread count.
   - What's unclear: Should the bell auto-refresh (polling) or only refresh on page load/navigation?
   - Recommendation: Fetch unread count on mount only — no polling. Unread count updates when user navigates or refreshes. This is acceptable for a staff tool; the cron runs daily so real-time accuracy within a session is not critical.

---

## Sources

### Primary (HIGH confidence)
- `src/lib/interest/engine.ts` — confirmed `calculateDaysOverdue`, `allocatePayment`, `calculateDailyRate` signatures
- `src/lib/db/schema/*.ts` — confirmed all existing table columns
- `src/services/*.ts` — confirmed Effect.js service pattern, `writeAuditLog` usage
- `src/actions/customer.actions.ts` — confirmed Server Action + auth session pattern
- `src/app/(app)/customers/page.tsx` — confirmed current customer list implementation to enhance
- `src/app/(app)/customers/[id]/page.tsx` — confirmed customer profile structure to extend
- `src/app/(app)/loans/[loanId]/loan-detail-client.tsx` — confirmed loan detail client to embed simulator into
- `src/components/layout/top-bar.tsx` — confirmed current top bar structure for bell integration
- `src/components/layout/sidebar.tsx` — confirmed nav group structure for watchlist link
- `src/app/api/cron/overdue/route.ts` — confirmed detection-only pattern to extend for ALRT-01
- `package.json` — confirmed installed dependencies (no new packages needed)
- `.planning/config.json` — confirmed `nyquist_validation: true`

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` accumulated context — confirmed all established patterns and pitfalls
- `.planning/phases/01-foundation/01-CONTEXT.md` — Loan Ledger Model and days overdue formula
- `.planning/phases/02-loan-operations/02-CONTEXT.md` — cron detection-only pattern confirmed

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified against installed package.json; no new dependencies needed
- Architecture patterns: HIGH — verified against existing codebase; all patterns established in Phase 1/2
- Schema additions: HIGH — notifications table design is straightforward; one migration
- Pitfalls: HIGH — derived from existing code reading and established project decisions
- Validation architecture: MEDIUM — test file commands use reasonable patterns but exact vitest config location not verified

**Research date:** 2026-03-21
**Valid until:** 2026-04-21 (stable stack; no fast-moving dependencies)
