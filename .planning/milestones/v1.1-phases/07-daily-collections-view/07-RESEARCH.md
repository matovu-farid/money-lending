# Phase 7: Daily Collections View - Research

**Researched:** 2026-03-23
**Domain:** Date-navigable daily collections tab — data aggregation, timezone-aware queries, "due today" list, tab UI extension
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Tab inside `/payments` — add a "Daily" tab alongside the existing "All Payments" list
- URL: `/payments?tab=daily` (default tab remains `list`)
- No separate sidebar entry — daily view is accessed from the payments page tabs
- Single scrollable view within the Daily tab: summary cards at top, then collected-today breakdown table, then due-today list below (not side-by-side columns)
- Left/right arrow buttons for prev/next day navigation
- Calendar popup (date picker) for jumping to any date
- Default to today on initial load
- When selected date has zero collections: show "No collections on this date" text message
- Summary cards display UGX 0 and 0 payments when no data
- Due-today list still renders below empty state (it's date-independent — always shows current overdue loans)

### Claude's Discretion
- Summary card design (number of cards, what stats to show — total collected, payment count, average payment)
- Collections breakdown table columns and sort order
- Due-today list columns (customer name, days since last payment, outstanding balance, loan amount)
- Visual urgency indicators for due-today items (badges, color coding)
- Loading skeleton design
- Tab component implementation (shadcn Tabs or custom)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| COLL-01 | User can view today's total collections amount and count | `getDailyCollections(date)` service — SUM/COUNT with DATE(payment_date AT TIME ZONE 'Africa/Kampala') filter; summary cards in DailyCollectionsTab |
| COLL-02 | User can view per-loan collection breakdown for a given day | `getDailyCollections(date)` returns array of per-loan rows joined to customers; breakdown table in DailyCollectionsTab |
| COLL-03 | User can pick a date to view that day's collections | Date picker (shadcn Calendar + Popover) with prev/next arrow buttons; date stored as URL param `?tab=daily&date=YYYY-MM-DD` |
| COLL-04 | User can see which active loans are due for payment today (30-day cycle indicator) | `getLoansDueToday()` service — reuses watchlist logic (active loans, last payment date lookup, 30+ days since last payment or loan start) |
</phase_requirements>

---

## Summary

Phase 7 adds a "Daily" tab inside the existing `/payments` page. The tab provides a date-navigable view showing (1) summary cards with total collected and payment count for the selected day, (2) a per-loan payment breakdown table, and (3) a "due today" list of active loans with no payment in 30+ days.

The data layer requires two new service functions. `getDailyCollections(date: string)` must aggregate payments using timezone-aware date comparison (`DATE(payment_date AT TIME ZONE 'Africa/Kampala')`). `getLoansDueToday()` reuses the watchlist logic — iterating active loans, computing days since last payment, and returning those at or beyond 30 days. Both wrap into Server Actions and are consumed by a TanStack Query hook in the new `DailyCollectionsTab` client component.

The critical technical concern is the timezone-aware GROUP BY / WHERE in PGlite's test environment. PGlite runs in UTC and may not support the `AT TIME ZONE` cast reliably. Integration tests must use UTC-pinned date assertions or skip the timezone clause in test fixtures. Unit tests using the mock-chain pattern can test the service logic directly.

**Primary recommendation:** Follow the watchlist + listPayments hybrid pattern. Service layer uses Effect.tryPromise wrapping async db calls; actions auth-gate and call `Effect.runPromise`; DailyCollectionsTab uses `useQuery` with a date-keyed query key. Add tab state to PaymentsClient via `?tab=` URL param, rendering either the existing list content or the new `DailyCollectionsTab`.

---

## Standard Stack

### Core (existing — no new npm packages)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | installed | ORM + raw `sql` helper for timezone cast | Project-wide ORM |
| effect | installed | Wraps async db calls in Effect.tryPromise | All service functions use this pattern |
| @tanstack/react-query | installed | Client-side data fetching with date-keyed query keys | Used in PaymentsClient, expenses, income pages |
| date-fns | installed | Date arithmetic for prev/next day navigation | Declared no-new-packages decision |
| shadcn/ui: Tabs | installed | Tab switcher (already in `/components/ui/tabs.tsx`) | Confirmed present in codebase |
| shadcn/ui: Calendar + Popover | installed | Date picker popup (already in `/components/ui/calendar.tsx`) | Confirmed present in codebase |
| shadcn/ui: Card | installed | Summary stat cards | Used across dashboard page |
| shadcn/ui: Badge | installed | Urgency indicators for due-today rows | Used in watchlist (OverdueBadge) |
| BigNumber.js | installed | Monetary sum accumulation | All monetary aggregation in this project |

**Installation:** No new packages needed. All dependencies are already installed.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── services/
│   └── daily-collections.service.ts    # getDailyCollections, getLoansDueToday
├── actions/
│   └── daily-collections.actions.ts    # getDailyCollectionsAction, getLoansDueTodayAction
├── hooks/
│   └── use-daily-collections.ts        # useQuery wrapper with date key
├── types/index.ts                       # Add DailyCollectionsSummary, DailyCollectionRow, LoanDueToday
└── app/(app)/payments/
    ├── page.tsx                         # Add tab param to server component
    ├── PaymentsClient.tsx               # Add tab switching (list | daily)
    └── DailyCollectionsTab.tsx          # New: date picker + summary cards + breakdown + due-today list
```

### Pattern 1: Timezone-Aware Date Query (getDailyCollections)

**What:** Filter payments by a specific Kampala calendar date using `DATE(payment_date AT TIME ZONE 'Africa/Kampala')`.

**When to use:** Any query that groups or filters payments by date — must never use bare `DATE(payment_date)` per STATE.md locked decision.

**Example:**
```typescript
// Service: src/services/daily-collections.service.ts
import { Effect } from "effect"
import { db } from "@/lib/db"
import { payments } from "@/lib/db/schema/payments"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { sql, eq, and, isNull, sum, count } from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import BigNumber from "bignumber.js"
import type { DailyCollectionsSummary, DailyCollectionRow } from "@/types"

export const getDailyCollections = (
  date: string  // YYYY-MM-DD in Africa/Kampala timezone
): Effect.Effect<DailyCollectionsSummary, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      // Timezone-aware date filter — mandatory per STATE.md
      const dateCondition = sql`DATE(${payments.paymentDate} AT TIME ZONE 'Africa/Kampala') = ${date}::date`

      const rows = await db
        .select({
          paymentId: payments.id,
          loanId: payments.loanId,
          customerName: customers.fullName,
          amount: payments.amount,
          interestPortion: payments.interestPortion,
          principalPortion: payments.principalPortion,
          paymentDate: payments.paymentDate,
        })
        .from(payments)
        .innerJoin(loans, eq(payments.loanId, loans.id))
        .innerJoin(customers, eq(loans.customerId, customers.id))
        .where(and(isNull(payments.deletedAt), dateCondition))
        .orderBy(payments.paymentDate)

      const totalCollected = rows.reduce(
        (s, r) => s.plus(new BigNumber(r.amount)), new BigNumber(0)
      )

      return {
        date,
        totalCollected: totalCollected.toFixed(2),
        paymentCount: rows.length,
        rows,
      }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

### Pattern 2: Due-Today Aggregation (getLoansDueToday)

**What:** Active loans where the number of days since last payment (or loan start if no payments) is >= 30.

**When to use:** COLL-04 "due today" list — reuses watchlist calculation logic.

**Example:**
```typescript
// Adapted from watchlist.service.ts pattern
// getLoansDueToday() iterates active loans, computes daysSinceLastPayment,
// returns those >= 30 with customer name, loan amount, outstanding balance

export const getLoansDueToday = (): Effect.Effect<LoanDueToday[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const activeLoans = await db
        .select()
        .from(loans)
        .where(and(eq(loans.status, "active"), isNull(loans.deletedAt)))

      const now = new Date()
      const results: LoanDueToday[] = []

      for (const loan of activeLoans) {
        const loanPayments = await db
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, loan.id), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate))

        const lastPayment = loanPayments.at(-1)
        const lastDate = lastPayment
          ? new Date(lastPayment.paymentDate)
          : new Date(loan.startDate)
        const daysSinceLast = Math.floor(
          (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
        )

        if (daysSinceLast >= 30) {
          const [customer] = await db
            .select()
            .from(customers)
            .where(eq(customers.id, loan.customerId))

          const outstandingBalance = lastPayment
            ? lastPayment.principalBalanceAfter
            : loan.principalAmount

          results.push({
            loanId: loan.id,
            customerId: loan.customerId,
            customerName: customer?.fullName ?? "Unknown",
            loanAmount: loan.principalAmount,
            outstandingBalance,
            daysSinceLastPayment: daysSinceLast,
            lastPaymentDate: lastPayment?.paymentDate ?? null,
          })
        }
      }

      results.sort((a, b) => b.daysSinceLastPayment - a.daysSinceLastPayment)
      return results
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

### Pattern 3: Tab State via URL Search Param

**What:** Store active tab in URL so it survives navigation and can be bookmarked/linked.

**When to use:** Extending PaymentsClient to support `?tab=daily`.

**Example:**
```typescript
// In PaymentsClient.tsx — add alongside existing searchParams usage
const tab = (searchParams.get("tab") ?? "list") as "list" | "daily"

function handleTabChange(newTab: "list" | "daily") {
  const params = new URLSearchParams(searchParams.toString())
  params.set("tab", newTab)
  // Preserve date param when switching to daily
  router.push(`/payments?${params.toString()}`)
}
```

### Pattern 4: Date Navigation in DailyCollectionsTab

**What:** Prev/next buttons + calendar popup, date stored as `?date=YYYY-MM-DD`.

**Example:**
```typescript
// Uses date-fns addDays/subDays; default = today in Africa/Kampala
import { addDays, subDays, format } from "date-fns"

const todayStr = format(new Date(), "yyyy-MM-dd")  // client's local date
const [selectedDate, setSelectedDate] = useState(
  searchParams.get("date") ?? todayStr
)

function navigateDate(delta: -1 | 1) {
  const current = new Date(selectedDate + "T12:00:00")
  const next = delta === 1 ? addDays(current, 1) : subDays(current, 1)
  setSelectedDate(format(next, "yyyy-MM-dd"))
}
```

### Pattern 5: TanStack Query with Date Key

**What:** `useQuery` keyed on `["daily-collections", selectedDate]` so changing the date auto-refetches.

**Example:**
```typescript
// src/hooks/use-daily-collections.ts
export function useDailyCollections(date: string) {
  return useQuery({
    queryKey: ["daily-collections", date],
    queryFn: async () => {
      const result = await getDailyCollectionsAction(date)
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
  })
}

export function useLoansDueToday() {
  return useQuery({
    queryKey: ["loans-due-today"],
    queryFn: async () => {
      const result = await getLoansDueTodayAction()
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
    // Due-today list is date-independent — stale time can be longer
    staleTime: 5 * 60 * 1000,
  })
}
```

### Anti-Patterns to Avoid

- **Bare `DATE(payment_date)`:** Always use `DATE(payment_date AT TIME ZONE 'Africa/Kampala')` — locked decision in STATE.md. A payment recorded at 23:30 Kampala time is UTC+3, so at 20:30 UTC — bare DATE() would assign it to the previous day.
- **Float arithmetic for monetary sums:** Always use BigNumber.js for summing amounts, never `parseFloat().reduce()`.
- **Hard-coding today's date server-side:** The server runs in UTC; "today" must come from the client or be passed explicitly as a date string.
- **Fetching due-today inside getDailyCollections:** Keep the two queries separate. The due-today list is date-independent; bundling it couples two separate concerns.
- **Missing `isNull(deletedAt)` guard:** All payment queries must apply `isNull(payments.deletedAt)` as the first condition — enforced contract from listPayments.
- **Tab state in useState only:** Tab and date must live in the URL (search params) so navigating back restores state.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Date arithmetic (prev/next day) | Custom +86400s math | `date-fns` `addDays`/`subDays`/`format` | DST edge cases; already installed |
| Monetary sum | `parseFloat().reduce()` | `BigNumber.js` accumulation | Floating-point precision loss on UGX amounts |
| Calendar popup | Custom dropdown | shadcn Calendar + Popover | Already installed; consistent with project UI |
| Tab navigation | Custom button group | shadcn Tabs (`/components/ui/tabs.tsx`) | Already installed; accessible, keyboard-navigable |
| Overdue badge | Inline span with color | `OverdueBadge` from `@/components/watchlist/overdue-badge` | Already exists; reuse for due-today list |

**Key insight:** Every UI primitive and utility needed for Phase 7 already exists in the codebase. The new code is exclusively business logic (service functions) and composition (DailyCollectionsTab).

---

## Common Pitfalls

### Pitfall 1: Timezone Date Mismatch in PGlite Tests
**What goes wrong:** Integration tests using `AT TIME ZONE 'Africa/Kampala'` may fail or return wrong results in the PGlite test environment (which runs in UTC). A payment inserted at `2026-03-23T08:00:00Z` (11am Kampala) maps to `2026-03-23` in both timezones, but `2026-03-22T22:30:00Z` (1:30am Kampala on 23rd) maps to `2026-03-22` in UTC and `2026-03-23` in Kampala.

**Why it happens:** PGlite may or may not support the `AT TIME ZONE` cast depending on version. STATE.md flags this as an open concern.

**How to avoid:** In integration tests, insert payment_date values in UTC noon (`T09:00:00Z` = noon Kampala) to avoid timezone boundary ambiguity. Document assertions as "UTC-safe." If `AT TIME ZONE` fails in PGlite, add a fallback: the service can also accept a UTC date range boundary as an alternative filter path for test environments.

**Warning signs:** Integration tests passing individually but failing when run together, or date-boundary assertions returning wrong counts.

### Pitfall 2: "Today" is Ambiguous on the Server
**What goes wrong:** Using `new Date()` server-side to determine "today" returns the UTC date, which may differ from the Kampala date during hours 21:00–23:59 UTC (midnight–2:59am Kampala the next day).

**How to avoid:** The `DailyCollectionsTab` client component determines the default date using `format(new Date(), 'yyyy-MM-dd')` in the browser (client's local clock). This is passed to the server action as a string. The server never decides what "today" is — it receives a date string from the client.

### Pitfall 3: Drizzle sql`` Template with Date Cast
**What goes wrong:** Writing `sql\`DATE(${payments.paymentDate} AT TIME ZONE 'Africa/Kampala') = ${date}\`` passes a string to a raw SQL template — Drizzle will parameterize the `${date}` value, but the `::date` cast ensures PostgreSQL interprets it correctly. Missing the `::date` cast may cause a type mismatch error.

**How to avoid:**
```typescript
// Correct — cast the param to date explicitly
const dateCondition = sql`DATE(${payments.paymentDate} AT TIME ZONE 'Africa/Kampala') = ${date}::date`
```

### Pitfall 4: Due-Today List Counts Fully-Paid Loans
**What goes wrong:** Including `fully_paid` loans in the active loans query.

**How to avoid:** Filter `eq(loans.status, "active")` AND `isNull(loans.deletedAt)` — exact same guard as `getWatchlistData`.

### Pitfall 5: Date Picker Calendar Navigates Past "Future" Dates
**What goes wrong:** Allowing selection of future dates, which will always show empty collections and may confuse users.

**How to avoid:** Pass `disabled={(date) => date > new Date()}` to the shadcn Calendar component to block future dates.

---

## Code Examples

### New Type Definitions (src/types/index.ts)
```typescript
// Source: inferred from existing PaymentWithCustomer, WatchlistEntry patterns

export interface DailyCollectionRow {
  paymentId: string
  loanId: string
  customerName: string
  amount: string
  interestPortion: string
  principalPortion: string
  paymentDate: Date
}

export interface DailyCollectionsSummary {
  date: string             // YYYY-MM-DD
  totalCollected: string   // BigNumber string
  paymentCount: number
  rows: DailyCollectionRow[]
}

export interface LoanDueToday {
  loanId: string
  customerId: string
  customerName: string
  loanAmount: string
  outstandingBalance: string
  daysSinceLastPayment: number
  lastPaymentDate: Date | null
}
```

### Server Action Pattern (src/actions/daily-collections.actions.ts)
```typescript
"use server"
// Source: mirrors watchlist.actions.ts and payment.actions.ts patterns

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { getDailyCollections, getLoansDueToday } from "@/services/daily-collections.service"

export async function getDailyCollectionsAction(date: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }
  try {
    const data = await Effect.runPromise(getDailyCollections(date))
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function getLoansDueTodayAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }
  try {
    const data = await Effect.runPromise(getLoansDueToday())
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}
```

### PaymentsClient Tab Integration
```typescript
// Add to existing PaymentsClient.tsx
// Source: matches existing searchParams pattern in PaymentsClient

const activeTab = (searchParams.get("tab") ?? "list") as "list" | "daily"

function handleTabChange(tab: string) {
  const params = new URLSearchParams(searchParams.toString())
  params.set("tab", tab)
  // Drop page/filter params when switching to daily
  if (tab === "daily") {
    params.delete("page")
    params.delete("customerName")
    params.delete("dateFrom")
    params.delete("dateTo")
    params.delete("amountMin")
    params.delete("amountMax")
  }
  router.push(`/payments?${params.toString()}`)
}

// In JSX — wrap existing content in Tabs:
<Tabs value={activeTab} onValueChange={handleTabChange}>
  <TabsList>
    <TabsTrigger value="list">All Payments</TabsTrigger>
    <TabsTrigger value="daily">Daily</TabsTrigger>
  </TabsList>
  <TabsContent value="list">
    {/* existing filter bar + table content */}
  </TabsContent>
  <TabsContent value="daily">
    <DailyCollectionsTab />
  </TabsContent>
</Tabs>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual date iteration in JS | Timezone-aware SQL filter (`AT TIME ZONE`) | Phase 7 design | Correct date boundary semantics for East Africa |
| Separate page for collections view | Tab inside existing /payments | Phase 7 context decision | No sidebar entry needed; avoids nav clutter |
| Watchlist logic duplicated | Reuse watchlist iteration pattern for getLoansDueToday | Phase 7 | Less code; proven logic; consistent 30-day threshold |

**Deprecated/outdated:**
- Manual watchlist page re-implementation: don't re-implement the days-since-last-payment logic from scratch — extract the core from `watchlist.service.ts`.

---

## Open Questions

1. **AT TIME ZONE behavior in PGlite**
   - What we know: PGlite runs in UTC; STATE.md flags this as a concern
   - What's unclear: Whether PGlite supports `AT TIME ZONE 'Africa/Kampala'` in WHERE clauses
   - Recommendation: In integration tests, insert payments at `T09:00:00Z` (noon Kampala) to avoid timezone boundaries. If the cast causes an error in PGlite, use a UTC date range as the fallback filter. Document the discrepancy in the test.

2. **getLoansDueToday performance with many active loans**
   - What we know: `getWatchlistData` already uses the same N+1 loop pattern and it's accepted in the codebase
   - What's unclear: Whether a high loan count (100+) causes noticeable delay on this page
   - Recommendation: Follow the existing watchlist pattern for Phase 7. A single-query SQL approach with MAX(paymentDate) GROUP BY is noted in STATE.md as "has no existing Drizzle analogue — prototype syntax against PGlite during planning." For Phase 7 with the existing loan volume, the loop approach is acceptable. Note in the plan that SQL optimization is a future concern.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (unit) + Vitest integration config + Cypress (E2E) |
| Config file | `vitest.config.ts` (unit), `vitest.integration.config.ts` (integration), `cypress.config.ts` (E2E) |
| Quick run command | `pnpm test` (unit) |
| Full suite command | `pnpm test:integration` (integration) |
| E2E command | `npx cypress run --spec cypress/e2e/daily-collections.cy.ts` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COLL-01 | getDailyCollections returns totalCollected + paymentCount for a given date | unit | `pnpm test src/services/__tests__/daily-collections.service.test.ts` | ❌ Wave 0 |
| COLL-01 | getDailyCollections returns 0/empty for date with no payments | unit | `pnpm test src/services/__tests__/daily-collections.service.test.ts` | ❌ Wave 0 |
| COLL-01 | Summary cards show UGX total and count in Daily tab | E2E | `npx cypress run --spec cypress/e2e/daily-collections.cy.ts` | ❌ Wave 0 |
| COLL-02 | getDailyCollections returns per-loan rows with customerName, amount, date | unit | `pnpm test src/services/__tests__/daily-collections.service.test.ts` | ❌ Wave 0 |
| COLL-02 | Breakdown table renders rows for selected date | E2E | `npx cypress run --spec cypress/e2e/daily-collections.cy.ts` | ❌ Wave 0 |
| COLL-03 | Date picker updates summary and breakdown table | E2E | `npx cypress run --spec cypress/e2e/daily-collections.cy.ts` | ❌ Wave 0 |
| COLL-03 | Prev/next arrow buttons navigate one day at a time | E2E | `npx cypress run --spec cypress/e2e/daily-collections.cy.ts` | ❌ Wave 0 |
| COLL-04 | getLoansDueToday returns active loans with daysSinceLastPayment >= 30 | unit | `pnpm test src/services/__tests__/daily-collections.service.test.ts` | ❌ Wave 0 |
| COLL-04 | getLoansDueToday excludes loans with payment in last 30 days | unit | `pnpm test src/services/__tests__/daily-collections.service.test.ts` | ❌ Wave 0 |
| COLL-04 | Due-today list renders on Daily tab regardless of selected date | E2E | `npx cypress run --spec cypress/e2e/daily-collections.cy.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test src/services/__tests__/daily-collections.service.test.ts`
- **Per wave merge:** `pnpm test && pnpm test:integration`
- **Phase gate:** Full suite (unit + integration + E2E) green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/services/__tests__/daily-collections.service.test.ts` — covers COLL-01 through COLL-04 (unit mocks)
- [ ] `src/services/__integration__/daily-collections.service.test.ts` — covers COLL-01, COLL-02, COLL-04 against PGlite (timezone note: use UTC-noon payments)
- [ ] `cypress/e2e/daily-collections.cy.ts` — covers all COLL-01 through COLL-04 E2E scenarios

---

## Sources

### Primary (HIGH confidence)
- Codebase: `src/services/watchlist.service.ts` — days-since-last-payment loop pattern, confirmed reusable
- Codebase: `src/services/payment.service.ts` — `listPayments` with `isNull(deletedAt)` + JOIN pattern
- Codebase: `src/services/dashboard.service.ts` — aggregate SUM/COUNT query pattern
- Codebase: `src/app/(app)/payments/PaymentsClient.tsx` — TanStack Query + searchParams integration point
- Codebase: `src/components/ui/tabs.tsx` — confirmed installed
- Codebase: `src/components/ui/calendar.tsx` — confirmed installed
- `.planning/STATE.md` — locked decision: `DATE(payment_date AT TIME ZONE 'Africa/Kampala')`, AT TIME ZONE PGlite concern
- `.planning/phases/07-daily-collections-view/07-CONTEXT.md` — all design decisions

### Secondary (MEDIUM confidence)
- Drizzle ORM `sql` template literal — confirmed working in codebase (`src/lib/db/schema/payments.ts`, `src/services/report.service.ts`)
- date-fns `addDays`/`subDays`/`format` — confirmed installed via package.json

### Tertiary (LOW confidence)
- PGlite AT TIME ZONE support — unverified; flagged in STATE.md as a known concern requiring test validation

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed installed in the codebase
- Architecture: HIGH — patterns directly inferred from existing service, action, hook, and component files
- Pitfalls: HIGH (timezone) / MEDIUM (due-today performance) — timezone concern is documented in STATE.md; performance concern is extrapolated from current loop pattern

**Research date:** 2026-03-23
**Valid until:** 2026-04-23 (stable stack)
