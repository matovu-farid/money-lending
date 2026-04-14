# Optimistic Updates with TanStack DB

**Date:** 2026-04-14
**Status:** Approved

## Problem

Mutations (loan disbursement, payment recording, etc.) feel slow despite TanStack Query caching. The bottleneck: detail pages use SSR, so even after optimistic list cache updates, navigating to a detail page hits the server again. Users on phones in the field need instant feedback.

## Decision: All App Pages Client-Side

All pages inside `src/app/(app)/` are `"use client"` components using TanStack Query / TanStack DB for data. No SSR data pages. Only login/registration may use SSR.

## Solution

Use **TanStack DB v0.6** (`QueryCollection`) as the foundation for all mutable entity data. Client-side UUID generation enables instant navigation to detail pages. TanStack DB's built-in rollback handles failures — no custom sync UI needed.

### Architecture

```
UI Components ("use client", useLiveQuery)
         ↓
TanStack DB Collections (optimistic state, transaction queue, persistence)
  ┌──────────┬──────────┬──────────┬───────────┐
  │ loans    │ payments │customers │ expenses  │ ...
  └──────────┴──────────┴──────────┴───────────┘
         ↓
TanStack Query (data loading for collections + read-only queries)
         ↓
Server Actions (unchanged: withAction, Effect-TS, permissions)
```

### Key Principles

- **TanStack DB collections** for all mutable entities (10 total)
- **Plain TanStack Query** for read-only data (dashboard, reports, activities, admin users)
- **ElectricSQL not used** — `QueryCollection` loads via TanStack Query, mutations via server actions. ElectricSQL is a clean future upgrade path if multi-user real-time sync is needed.

## Client-Side ID Generation

Every create mutation generates a UUID client-side via `crypto.randomUUID()`. This ID is sent to the server action and used as the database primary key.

**Collision fallback:** If the server returns a unique violation, retry without the client ID. Server generates its own ID. The detail page detects the ID change and calls `router.replace()` to the new URL.

**Server action contract change:** All create actions accept an optional `id` field. Response always includes the final `id` for reconciliation.

```typescript
// Client
const id = crypto.randomUUID()
loanCollection.insert({ id, ...formData })
router.push(`/loans/${id}`)

// Server (on collision)
catch (error) {
  if (isUniqueViolation(error) && input.id) {
    const serverId = crypto.randomUUID()
    return db.insert(loans).values({ ...input, id: serverId }).returning()
  }
}
```

## Collections (10 total)

| Collection | onInsert | onUpdate | onDelete |
|---|---|---|---|
| `customers` | `createCustomerAction` | `updateCustomerAction` | — |
| `loans` | `createLoanAction` | — | — |
| `payments` | `recordPaymentAction` | `editPaymentAction` | `deletePaymentAction` |
| `expenses` | `recordExpenseAction` | — | `deleteExpenseAction` |
| `income` | `recordIncomeAction` | — | `deleteIncomeAction` |
| `creditors` | `createCreditorAction` | `addInvestmentAction` | — |
| `fundTransfers` | `createFundTransferAction` | — | — |
| `rateChangeRequests` | `requestRateChangeAction` | — | — |
| `delegations` | `createDelegationAction` | — | `revokeDelegationAction` |
| `settlements` | `settleCollateralAction` | — | — |

### Filtering Strategy

| Collection | Strategy | Reason |
|---|---|---|
| `payments` | Server-side pagination | Can grow to tens of thousands |
| All others | Client-side filtering via `useLiveQuery` | Typically <1000 records |

## Error Handling

TanStack DB's built-in rollback handles all failure cases. When a mutation's `onInsert`/`onUpdate`/`onDelete` handler throws, TanStack DB automatically removes the optimistic state from the collection. No custom sync UI, status bar, or retry queue is needed.

**On the detail page after rollback:** If the user navigated to a detail page for an optimistic record that gets rolled back, the `useLiveQuery` returns `null`. The page detects this and redirects to the list page with an error toast.

## Navigation & Detail Page Pattern

### Create flow:

1. User submits form
2. `generateClientId()` → UUID
3. `collection.insert({ id, ...data })` — optimistic, instant
4. `router.push(/entity/id)` — navigate immediately
5. Detail page renders from collection cache via `useLiveQuery`
6. Server action runs in background
7. Success: collection syncs confirmed state silently
8. Collision: `router.replace()` to server-assigned ID
9. Failure: TanStack DB rolls back optimistic state, detail page redirects to list with error toast

### Detail page pattern:

```typescript
"use client"
const { data: loan } = useLiveQuery((query) =>
  query.from({ loanCollection }).where("id", "=", loanId).first()
)
// Derived data (balance, portions) via useQuery, enabled after sync confirms
```

### Rollback on detail page:

If the record disappears from the collection (rolled back), the detail page detects `loan === null` and redirects to the list page with an error toast.

### POS receipt:

Receipts render immediately from optimistic data. If the mutation later fails, the receipt was already printed — acceptable since the user is physically handing over money and needs the receipt at that moment.

## Data That Stays on Plain TanStack Query

| Data | Reason |
|---|---|
| Loan balance (from ledger) | Derived/computed, not a CRUD entity |
| Payment portions (from ledger) | Computed server-side |
| Dashboard KPIs | Aggregated read-only |
| Reports (P&L, balance sheet, portfolio) | Complex server computations |
| Activities | Read-only audit log |
| Admin users | Read-only listing |

## Page Conversion

All pages in `src/app/(app)/` become `"use client"` with `useLiveQuery` for mutable data.

**Major conversions (SSR → client):**
- `/loans/[loanId]` — SSR Effect fetch → `useLiveQuery` from `loanCollection`
- `/loans/new` — SSR customer fetch → `useLiveQuery` from `customerCollection`
- `/loans/[loanId]/payments/new` — SSR balance fetch → client query

**Hook replacements (swap to collection reads):**
- `use-loans.ts` → `loanCollection` + `useLiveQuery`
- `use-customers.ts` / `use-customer.ts` → `customerCollection`
- `use-payments.ts` → `paymentCollection`
- `use-create-loan.ts` → `loanCollection.insert()`
- `use-create-customer.ts` → `customerCollection.insert()`
- `use-search-active-loans.ts` → `useLiveQuery` with filter
**Hooks that stay:** `use-dashboard.ts`, `use-reports.ts`, `use-activities.ts`, `use-admin-users.ts`, `use-daily-collections.ts` (aggregated server query), `query-utils.ts`

## File Structure

### New files:

```
src/collections/          # 10 collection files + index.ts
src/lib/client-id.ts      # generateClientId()
```

### New dependencies:

```
@tanstack/react-db              # Collections + useLiveQuery
@tanstack/query-db-collection   # QueryCollection for TanStack Query integration
```

## Implementation Phases

| Phase | Scope |
|---|---|
| 1 | Install deps, create collections, client-id utility |
| 2 | Modify server actions to accept optional `id` + collision fallback in services |
| 3 | Convert loan pages (create, detail) + payment recording |
| 4 | Convert customer pages (list, detail, create) |
| 5 | Convert remaining entities (expenses, income, creditors, fund transfers, rate changes, delegations, settlements) |
| 6 | Delete old hooks, clean query-keys.ts, remove dead code |
| 7 | Cypress E2E tests for optimistic flows |

## Testing Strategy

All verification via Cypress E2E tests (per AGENTS.md).

### Test files:

- `cypress/e2e/optimistic-loan-create.cy.ts` — instant navigation, cache render, rollback on failure
- `cypress/e2e/optimistic-payment-create.cy.ts` — same pattern for payments
- `cypress/e2e/optimistic-customer-create.cy.ts` — same pattern for customers
- `cypress/e2e/id-collision.cy.ts` — collision fallback + redirect
- Per-page regression tests for each converted page

### Each optimistic create test covers:

1. Instant navigation (within 100ms of submit)
2. Optimistic data visible on detail page
3. Server failure → TanStack DB rollback → redirect to list with error toast
