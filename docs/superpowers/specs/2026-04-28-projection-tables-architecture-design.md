# Projection-Tables Architecture (starting with `loan_balances`) — Design Spec

**Status:** Design — not an executable plan. Decisions and open questions below need a pass before writing tasks.

**Goal:** Replace the current "queryFn + Electric notification + invalidate" pattern with **server-maintained projection tables**, synced to clients via Electric direct. Every derived/aggregate read becomes a Postgres table that the database keeps current via triggers; clients consume those tables as ordinary Electric collections.

The first projection is `loan_balances`. The same pattern then absorbs `dashboard_kpis`, `daily_collections_summary`, `location_balances`, `loan_status_counts`, and the per-creditor dashboards in subsequent migrations.

---

## 1. Background

### Today's pattern (the one we're retiring)

Two flavors of "derived data" collections exist in `src/collections/`:

1. **`queryCollectionOptions` + `subscribeToTableChanges`** — `loans`, `dashboard`, `daily-collections`, `loan-status-counts`, `loan-balance`, `loan-extras` (location-balances), `reports`, `creditor-extras`. The collection fetches via a server action that runs Drizzle aggregations (`getLoanBalancesFromLedger`, etc.). On each Electric live-change for the source table, the query is invalidated and the server action re-runs.
2. **`electricCollectionOptions` for raw entities** — `customers`, `payments`, `bank-accounts`, `creditors`, `expenses`, `income`, `fund-transfers`, `delegations`, `invitations`, `rate-change-requests`, `expense-categories`, `income-categories`. These are already canonical.

The first flavor has three problems:
- Every invalidation re-runs an aggregation query against Postgres (no incremental work).
- Every `subscribeToTableChanges` opens a duplicate Electric ShapeStream that downloads and discards a snapshot for change-notification only.
- Computed fields (`outstandingBalance`, `unpaidInterest`, `daysOverdue`, etc.) are stuck on the server, blocking `loanCollection` from going Electric direct.

### Why projection tables solve this

A projection table is a regular Postgres table whose contents are computed from base tables and maintained by triggers. Because it's a real table, Postgres logical replication streams its writes through Electric, so clients can subscribe to it as a normal `electricCollectionOptions` collection. The aggregation runs once on write (in the same DB transaction as the source-table write), then is replicated to all clients.

This is the canonical "events + projections" pattern, scoped to relational primitives.

---

## 2. Architecture

### The split

- **Source-of-truth tables**: `loans`, `payments`, `transactions`, `customers`, `creditors`, etc. Edited by application code. **Never written to by triggers.**
- **Projection tables**: `loan_balances`, `dashboard_kpis`, `daily_collections_summary`, `loan_status_counts`, `location_balances`, etc. **Only ever written to by triggers.** Application code is the consumer; never the writer.

### Naming convention

- Suffix `_balances` for per-entity ledger projections (`loan_balances`, `creditor_balances`).
- Suffix `_summary` or `_counts` for aggregates (`daily_collections_summary`, `loan_status_counts`).
- Suffix `_kpis` for top-level dashboard rollups.
- The Electric collection name mirrors: `loanBalanceCollection`, `dashboardKpisCollection`, etc.

### Where triggers live

- Drizzle does not natively model triggers. We add a sibling directory `drizzle/projections/` containing one `.sql` file per projection (e.g. `drizzle/projections/loan_balances.sql`). The file declares the table, the recompute function, and the triggers — idempotently (`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS … CREATE TRIGGER …`).
- Drizzle's `out: "./drizzle"` migration directory remains for entity tables. Projection SQL is applied via `pnpm db:projections` (a new script that `psql -f`s every file in `drizzle/projections/`). Order matters: projection tables first, then their triggers.
- Per the project's existing convention (memory: `drizzle-kit push must be run against BOTH dev and production Neon databases`), `pnpm db:projections` runs against both DATABASE_URLs.

### Trigger discipline

- One recompute function per projection. The function takes the affected entity ID(s) and rebuilds those rows from scratch. **Idempotent. Side-effect-free except for the projection table.**
- Triggers are `AFTER INSERT OR UPDATE OR DELETE … FOR EACH ROW`. They call the recompute function with the affected ID. Statement-level triggers are tempting for batched writes but harder to get right when payloads contain multiple loans — defer until profiled.
- Recompute function recomputes the entire row (full SUM over the ledger), not deltas. Simpler, more obviously correct, hard-to-screw-up. Performance is fine for this app's volumes — the aggregation queries already run on every server-action call today; we're moving them from "per read" to "per source-write," which is strictly less work in steady state.

### Authorization

Per-loan authorization stays the same as today — the existing Electric proxy at `src/app/api/electric/[...table]/route.ts` adds the projection table name to `ALLOWED_TABLES`. If branch-level filtering is needed later, the proxy injects a WHERE clause based on `user.branch_id`. Not required for v1 of `loan_balances` because `loans` already trusts the proxy's all-or-nothing auth.

---

## 3. Concrete design for `loan_balances`

### Schema

`drizzle/projections/loan_balances.sql`:

```sql
-- 1. Projection table.
CREATE TABLE IF NOT EXISTS loan_balances (
  loan_id              UUID PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE,
  outstanding_balance  NUMERIC(15,2) NOT NULL DEFAULT '0',
  unpaid_interest      NUMERIC(15,2) NOT NULL DEFAULT '0',
  last_payment_date    TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Recompute one loan's projection row from base data.
CREATE OR REPLACE FUNCTION refresh_loan_balance(p_loan_id UUID) RETURNS void AS $$
BEGIN
  IF p_loan_id IS NULL THEN RETURN; END IF;

  INSERT INTO loan_balances (loan_id, outstanding_balance, unpaid_interest, last_payment_date, updated_at)
  VALUES (
    p_loan_id,
    (SELECT COALESCE(SUM(CASE WHEN t.type = 'debit'  THEN  t.amount
                              WHEN t.type = 'credit' THEN -t.amount END), 0)
     FROM transactions t
     JOIN transaction_categories tc ON t.category_id = tc.id
     WHERE t.loan_id = p_loan_id AND tc.name = 'Loans Receivable'),
    (SELECT COALESCE(SUM(CASE WHEN t.type = 'credit' THEN  t.amount
                              WHEN t.type = 'debit'  THEN -t.amount END), 0)
     FROM transactions t
     JOIN transaction_categories tc ON t.category_id = tc.id
     WHERE t.loan_id = p_loan_id AND tc.name = 'Interest Earned'),
    (SELECT MAX(payment_date) FROM payments WHERE loan_id = p_loan_id),
    NOW()
  )
  ON CONFLICT (loan_id) DO UPDATE SET
    outstanding_balance = EXCLUDED.outstanding_balance,
    unpaid_interest    = EXCLUDED.unpaid_interest,
    last_payment_date  = EXCLUDED.last_payment_date,
    updated_at         = NOW();
END $$ LANGUAGE plpgsql;

-- 3. Trigger on transactions (affects outstanding_balance, unpaid_interest).
CREATE OR REPLACE FUNCTION on_transactions_change_for_loan_balance() RETURNS TRIGGER AS $$
BEGIN
  PERFORM refresh_loan_balance(COALESCE(NEW.loan_id, OLD.loan_id));
  IF TG_OP = 'UPDATE' AND NEW.loan_id IS DISTINCT FROM OLD.loan_id THEN
    PERFORM refresh_loan_balance(OLD.loan_id);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transactions_loan_balance ON transactions;
CREATE TRIGGER trg_transactions_loan_balance
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION on_transactions_change_for_loan_balance();

-- 4. Trigger on payments (affects last_payment_date).
CREATE OR REPLACE FUNCTION on_payments_change_for_loan_balance() RETURNS TRIGGER AS $$
BEGIN
  PERFORM refresh_loan_balance(COALESCE(NEW.loan_id, OLD.loan_id));
  IF TG_OP = 'UPDATE' AND NEW.loan_id IS DISTINCT FROM OLD.loan_id THEN
    PERFORM refresh_loan_balance(OLD.loan_id);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_loan_balance ON payments;
CREATE TRIGGER trg_payments_loan_balance
AFTER INSERT OR UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION on_payments_change_for_loan_balance();

-- 5. Initial backfill — populate one row per existing loan.
INSERT INTO loan_balances (loan_id)
SELECT id FROM loans
ON CONFLICT (loan_id) DO NOTHING;

DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM loans LOOP
    PERFORM refresh_loan_balance(r.id);
  END LOOP;
END $$;
```

A Drizzle TypeScript schema mirror lives in `src/lib/db/schema/loan-balances.ts` so other application code can refer to typed columns:

```ts
import { pgTable, uuid, numeric, timestamp } from "drizzle-orm/pg-core"
import { loans } from "./loans"

export const loanBalances = pgTable("loan_balances", {
  loanId:             uuid("loan_id").primaryKey().references(() => loans.id, { onDelete: "cascade" }),
  outstandingBalance: numeric("outstanding_balance", { precision: 15, scale: 2 }).notNull().default("0"),
  unpaidInterest:     numeric("unpaid_interest",    { precision: 15, scale: 2 }).notNull().default("0"),
  lastPaymentDate:    timestamp("last_payment_date", { withTimezone: true }),
  updatedAt:          timestamp("updated_at",        { withTimezone: true }).notNull().defaultNow(),
})
```

### Electric proxy

Add `"loan_balances"` to `ALLOWED_TABLES` in `src/app/api/electric/[...table]/route.ts:53-68`.

### Client-side collection

Replaces the existing `getLoanBalanceCollection` in `src/collections/loan-balance.ts` with an Electric direct collection in a new file `src/collections/loan-balances.ts`:

```ts
"use client"
import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import { shapeUrl, shapeOnError } from "@/lib/electric"
import { loanBalanceSchema, type LoanBalanceRow } from "@/lib/schemas/collections"

export type { LoanBalanceRow }

export const loanBalanceCollection = createCollection(
  electricCollectionOptions({
    id: "loan_balances",
    schema: loanBalanceSchema,
    getKey: (row) => row.loanId,
    shapeOptions: {
      url: shapeUrl("loan_balances"),
      columnMapper: snakeCamelMapper(),
      onError: shapeOnError("loan_balances"),
    },
    // No onInsert/onUpdate/onDelete — projection tables are read-only from the client.
  })
)
```

The schema in `src/lib/schemas/collections.ts`:

```ts
import { loanBalances } from "@/lib/db/schema/loan-balances"
export const loanBalanceSchema = createSelectSchema(loanBalances)
export type LoanBalanceRow = typeof loanBalanceSchema._zod.output
```

### `loanCollection` becomes Electric direct

`src/collections/loans.ts` is rewritten:

```ts
import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import { loanRowSchema, type LoanBaseRow } from "@/lib/schemas/collections"
import { shapeUrl, shapeOnError } from "@/lib/electric"
// onInsert/onUpdate handlers stay essentially the same — they still dispatch
// to createLoanAction / settleWithCollateralAction / etc. via metadata routing.

export type { LoanBaseRow as LoanRow }

export const loanCollection = createCollection(
  electricCollectionOptions({
    id: "loans",
    schema: loanRowSchema,
    getKey: (loan) => loan.id,
    shapeOptions: {
      url: shapeUrl("loans"),
      columnMapper: snakeCamelMapper(),
      onError: shapeOnError("loans"),
    },
    onInsert: /* existing createLoanAction routing, unchanged shape */,
    onUpdate: /* existing settle/waive/adjust-penalty routing, unchanged shape */,
  })
)
```

Note: `LoanListEntry` (the rich type with `customerName`, `daysOverdue`, etc.) is no longer the row type of `loanCollection`. It becomes the **return type of a hook** (next section).

### Consumer hooks

New file `src/collections/loan-views.ts`:

```ts
"use client"
import { useLiveQuery } from "@tanstack/react-db"
import { eq, useMemo } from "@tanstack/react-db" // imports as appropriate
import { loanCollection } from "./loans"
import { loanBalanceCollection } from "./loan-balances"
import { customerCollection } from "./customers"
import { computeDaysOverdue, computeDailyRate } from "@/lib/interest/overdue-client"
import type { LoanListEntry } from "@/types/loan"

/** Single loan + balance + customer fields, joined client-side. */
export function useLoanWithBalance(loanId: string) {
  return useLiveQuery(
    (q) => q
      .from({ loan: loanCollection })
      .join({ bal: loanBalanceCollection }, ({ loan, bal }) => eq(loan.id, bal.loanId), "left")
      .join({ cust: customerCollection },   ({ loan, cust }) => eq(loan.customerId, cust.id), "left")
      .where(({ loan }) => eq(loan.id, loanId))
      .select(({ loan, bal, cust }) => projectLoanListEntry(loan, bal, cust)),
    [loanId],
  )
}

/** All loans, joined; same row shape as legacy LoanListEntry. */
export function useLoansWithBalances() {
  return useLiveQuery((q) => q
    .from({ loan: loanCollection })
    .join({ bal: loanBalanceCollection }, ({ loan, bal }) => eq(loan.id, bal.loanId), "left")
    .join({ cust: customerCollection },   ({ loan, cust }) => eq(loan.customerId, cust.id), "left")
    .select(({ loan, bal, cust }) => projectLoanListEntry(loan, bal, cust)),
  )
}

function projectLoanListEntry(loan, bal, cust): LoanListEntry {
  return {
    ...loan,
    customerName:       cust?.fullName ?? "—",
    customerContact:    cust?.contact ?? null,
    outstandingBalance: bal?.outstandingBalance ?? "0",
    unpaidInterest:     bal?.unpaidInterest    ?? "0",
    lastPaymentDate:    bal?.lastPaymentDate   ?? null,
    daysOverdue:        computeDaysOverdue(loan, bal?.lastPaymentDate ?? null, new Date()),
    dailyRate:          computeDailyRate(loan),
  }
}
```

`computeDaysOverdue` and `computeDailyRate` are pure functions extracted from `src/lib/interest/overdue.ts` and `src/lib/interest/effective-rate.ts` to a new client-safe module (`src/lib/interest/overdue-client.ts` and `effective-rate-client.ts`). They take primitives in and return primitives — no DB access. Today's server-side `computeLoanOverdueInfo` at `src/services/report.service.ts:501` already calls `computeLoanOverdueInfo` from `src/lib/interest/overdue.ts`, so it's already isolated; we just need to make sure that module is server-runtime-free.

`LoanListEntry`'s shape (`src/types/loan.ts:9-15`) doesn't change. Consumers see the same fields they see today.

---

## 4. Migration strategy

Split into self-contained, releasable phases. Each phase ends with a green `pnpm validate` (typecheck + vitest + cypress).

### Phase 1 — Establish the projection plumbing
- Create `drizzle/projections/loan_balances.sql` with the schema, function, triggers, and backfill.
- Add Drizzle TS schema (`src/lib/db/schema/loan-balances.ts`) and Zod schema export.
- Add `pnpm db:projections` script.
- Add `loan_balances` to `ALLOWED_TABLES` in the Electric proxy.
- Apply against dev and production Neon DBs.
- **Ship-able:** new tables exist and stay in sync; no client code uses them yet.

### Phase 2 — Add the Electric direct `loanBalanceCollection`
- Write `src/collections/loan-balances.ts` (Electric direct).
- Add to `src/collections/index.ts` exports.
- Add to `IdlePrefetcher` collection list (`src/lib/idle-prefetch.ts`).
- **Ship-able:** the collection is available; nothing consumes it yet.

### Phase 3 — Migrate `loanCollection` to Electric direct
- Rewrite `src/collections/loans.ts` from `queryCollectionOptions` to `electricCollectionOptions`.
- Remove the `subscribeToTableChanges("loans", ...)` call from this file (it's still elsewhere — fine; that's Phase 6).
- Remove the `listLoansWithOverdueAction` import (the action stays for now; we delete it in Phase 7).
- `loanCollection`'s row shape is now `LoanBaseRow` (raw loan columns), not `LoanListEntry`. **Existing consumers will break here** — that's expected; they get fixed in Phase 4.
- Add a temporary type alias `export type LoanRow = LoanBaseRow` to ease the consumer migration.

### Phase 4 — Build consumer hooks and migrate the 27 consumer files
- Write `src/collections/loan-views.ts` with `useLoanWithBalance` and `useLoansWithBalances`.
- Extract pure client helpers `src/lib/interest/overdue-client.ts` and `effective-rate-client.ts` from the existing modules. Keep server modules as thin re-exporters so existing server callers don't break.
- Migrate consumers in waves (each wave is a commit, runnable independently):
  - **Wave 4a — readers that join with customers:** `src/app/(app)/loans/page.tsx`, `src/app/(app)/loans/[loanId]/page.tsx`, `src/app/(app)/customers/[id]/page.tsx`, `src/app/(app)/payments/PaymentsClient.tsx`, `src/app/(app)/payments/QuickRecordDialog.tsx`, `src/app/(app)/payments/LoanSearchCombobox.tsx`. Replace `useLiveQuery((q) => q.from({l: loanCollection}))` with `useLoansWithBalances()`.
  - **Wave 4b — single-loan readers:** `src/app/(app)/loans/[loanId]/loan-detail-client.tsx`, `src/app/(app)/loans/[loanId]/payments/new/page.tsx`. Replace with `useLoanWithBalance(loanId)`.
  - **Wave 4c — write-path call sites:** `src/components/loans/settle-collateral-dialog.tsx`, `src/app/(app)/loans/[loanId]/loan-detail-client.tsx` (the `loanCollection.update(...)` calls). Stay on `loanCollection` directly — writes still go through the raw collection's mutation handlers.
  - **Wave 4d — score/approval pages:** `src/app/(app)/approvals/page.tsx`, `src/app/(app)/customers/page.tsx`, `src/components/credit-score/credit-score-badge.tsx`. Use the appropriate hook.
- Each wave's PR includes a Cypress regression test for that surface.

### Phase 5 — Retire the legacy `loan-balance.ts`
- Delete `src/collections/loan-balance.ts` (the per-loan `queryCollectionOptions` collection).
- Search for `getLoanBalanceCollection` references; replace with reads from `loanBalanceCollection`.
- Delete the `loanBalance` query keys from `src/lib/query-keys.ts`.

### Phase 6 — Remove `subscribeToTableChanges("loans", ...)` and `("payments", ...)` for loan-balance invalidation
- The handful of remaining `subscribeToTableChanges` calls that exist solely to invalidate `["loans"]` or `["loans", id, "balance"]` keys are now redundant — `loanCollection` and `loanBalanceCollection` get live updates directly from Electric. Delete those calls.
- Other `subscribeToTableChanges` calls (for `dashboard`, `daily-collections`, `reports`, `creditor-extras`, `location-balances`) stay until those collections also become projections in later milestones.

### Phase 7 — Retire the server-side aggregation entry points
- Delete `listLoansWithOverdueAction` in `src/actions/loan.actions.ts:122`.
- Decide whether `getLoanBalancesFromLedger`/`getInterestEarnedFromLedger` are still needed for non-client uses (reports, exports). If not, delete; if yes, keep them as the canonical computation that the trigger function mirrors.

### Phase 8 — Plan A optional cleanup
- Plan A (eliminate duplicate ShapeStreams via `live=true`) becomes much smaller after Phase 6: only the cross-table-invalidation use cases remain (e.g., `subscribeToTableChanges("transactions", ...)` invalidating `["dashboard", "kpis"]`). Decide whether to ship Plan A standalone or wait until those projections also migrate.

---

## 5. Future projections (not in this spec, but the pattern extends)

Each becomes its own `drizzle/projections/<name>.sql` + corresponding Electric collection:

| Projection | Source tables | Replaces |
|---|---|---|
| `dashboard_kpis` | `loans`, `transactions`, `payments` | `dashboardCollection` server action |
| `daily_collections_summary` | `payments`, `loans` | `dailyCollectionsCollection` |
| `loan_status_counts` | `loans` | `loanStatusCountsCollection` |
| `location_balances` | `transactions`, `payments`, `loans`, `fund_transfers` | `locationBalancesCollection` |
| `creditor_dashboards` (per-creditor) | `creditor_investments`, `creditor_repayments`, `transactions` | `creditor-extras` collections |
| `reports_*` | `loans`, `transactions`, `payments` | `reports` collection (KPIs only — full P&L history likely stays as on-demand queryFn) |

Each migration follows the same playbook: SQL → Drizzle TS schema → Electric collection → consumer hook → migrate consumers → retire server action.

---

## 6. Open questions (decide before writing tasks)

1. **Trigger granularity**: row-level triggers everywhere, or statement-level for hot tables (`transactions`)? Default is row-level for simplicity. Profile after Phase 1 lands; switch to statement-level only if measured contention.
2. **Recompute strategy under load**: full recompute per affected loan is `O(ledger entries for that loan)`. For loans with thousands of entries, this could be slow. Defer optimization — measure first. Optimization paths if needed: keep a denormalized running balance updated by a smarter trigger that adds/subtracts the delta, falling back to full recompute on `ANALYZE drift detected`.
3. **Backfill safety on production**: the Phase 1 SQL includes a backfill loop. For a large existing dataset this could be slow at apply time. Two options: (a) run the backfill in a background job after deploy, with the trigger active so new writes stay current; (b) stop-the-world during the migration window. Decide based on production loan count.
4. **Should `daysOverdue` and `dailyRate` be projection columns or pure client-side derivations?** Recommendation: client-side. They depend on `today`, which is moving, so storing them server-side requires scheduled refresh. Client computation is `O(1)` per render. **Confirm this preference before starting Phase 4.**
5. **Trigger resiliency**: if the recompute function ever throws, the source-table write fails (because triggers are in-transaction). That's correct — better to fail loudly than silently desync. Verify monitoring catches projection-trigger errors as separate from application errors.
6. **Test infra**: Vitest integration tests against a real Postgres (the project already uses Neon dev DB) need to run the projection SQL as part of `db:reset`. Add to `cypress/support/commands.ts` `db:reset` task and to `tests/setup.ts`.
7. **Drizzle representation of triggers**: Drizzle 0.45 doesn't model triggers in TS. Long-term, watch for first-class trigger support; for now the raw SQL files are the source of truth and the Drizzle TS schema only captures the table shape.
8. **Failure mode for Electric → projection lag**: Electric replicates the projection write a few milliseconds after the entity write. Consumers using `useLoansWithBalances` may briefly see a freshly-inserted loan row with `bal: null`. The `LEFT JOIN` plus `bal?.outstandingBalance ?? "0"` fallback handles this gracefully. Confirm the UX is acceptable (likely fine — the balance just shows "0" for ~50ms).

---

## 7. Risks

- **Trigger correctness regression**: a bug in `refresh_loan_balance` produces wrong numbers across the entire app simultaneously. **Mitigation**: keep `getLoanBalancesFromLedger` (the existing server function) and add a periodic reconciliation job that compares server-computed values against `loan_balances` and alerts on drift. Run it during the first month post-rollout.
- **Replication lag affecting UX**: covered by question 8 above. Likely fine.
- **27-file refactor scope**: Wave-by-wave migration in Phase 4 keeps each PR small. Each wave is a green-tests gate.
- **Cypress test churn**: existing tests pass (or fail) based on visible UI behavior. As long as the rendered values stay equivalent, tests stay green. Add new Cypress tests specifically for "live balance update" — issue a payment, verify the balance on the loan detail page updates within 2s without a navigation.
- **`updated_at` semantics on `loan_balances`**: it ticks on every recompute. That's fine — `loans.updated_at` stays clean (entity edits only), and `loan_balances.updated_at` is honestly useful for "when was this balance last computed."
- **Future projection trigger composition**: when several projections all read `transactions`, each new projection adds a trigger to `transactions`. Triggers fire serially in a transaction. At some point this becomes a write-amplification concern. Likely fine for years; flag if profiling shows write latency issues.

---

## 8. Success criteria

1. `loanCollection` is `electricCollectionOptions`. Its row is the raw loan table row.
2. `loanBalanceCollection` is `electricCollectionOptions` over `loan_balances`. Updated within ~50ms of any write to `transactions` or `payments`.
3. `useLoanWithBalance(id)` and `useLoansWithBalances()` return the existing `LoanListEntry` shape. Consumer code reads the same field names as today.
4. `listLoansWithOverdueAction` and `loanBalanceCollection` (the old `queryCollectionOptions` one in `src/collections/loan-balance.ts`) are deleted.
5. `subscribeToTableChanges` calls that existed only to invalidate loan/balance keys are deleted.
6. `pnpm validate` is green.
7. Cypress E2E suite is green, including a new "live balance update" spec.
8. Reconciliation job for the first 30 days post-rollout reports zero drift between trigger-computed and server-recomputed balances.

---

## 9. Out of scope

- Migrating `dashboard`, `daily-collections`, `reports`, `creditor-extras`, `location-balances`, `loan-status-counts` to projection tables. Same pattern, separate specs in subsequent milestones.
- Adding `branch_id` filtering to the Electric proxy. Out unless a real authorization requirement materializes.
- Touching `loan-extras` per-id collections (`getPaymentPortionsCollection`, `getActiveLoanCheckCollection`, `getLoanCollateralCollection`). Their queryFn is stable and small; defer.
- Replacing `subscribeToTableChanges` entirely. Becomes possible once all derived collections are projections, but not required for v1.
- IndexedDB persister upgrade. Independent question. Current localStorage persister is fine for the projection sizes envisioned.

---

## 10. Decision log

- **2026-04-28** — Approach B (separate `loan_balances` table) over A (columns on `loans`). Reasoning: greenfield project, high entropy acceptable, projection-table pattern extends to ~6 other surfaces beyond loans, clean entity-vs-derived separation.
- **2026-04-28** — Trigger-maintained tables over Postgres materialized views. Reasoning: Postgres logical replication does not stream materialized view refreshes; only base tables replicate. Verified against Electric docs.
- **2026-04-28** — Row-level, full recompute per affected loan in the trigger. Reasoning: simplest, obviously correct. Optimization deferred until profiling demands it.
- **2026-04-28** — `daysOverdue` and `dailyRate` are client-side pure functions (in `useLoansWithBalances` hook), not projection columns. Reasoning: they depend on `today`; storing them server-side requires scheduled refresh that adds staleness with no benefit.
- **2026-04-28** — No backfill mechanism. There is no production data; the migration runs against an empty (or wipe-able) database. The `DO $$ ... LOOP` block is removed from the SQL; the `loan_balances` table starts empty and triggers populate it as writes happen.
- **2026-04-28** — Separate `pnpm db:projections` script (runs `psql -f` over `drizzle/projections/*.sql`) rather than a `postpush` hook or numbered Drizzle migrations. Reasoning: clean separation between entity migrations and projection plumbing; idempotent SQL is safe to re-run.
- **2026-04-28** — Plan A (eliminate duplicate ShapeStreams) is skipped. Most `subscribeToTableChanges` calls dissolve naturally as Plan B′ retires the queryFn-based collections in Phase 6. Plan A's standalone savings become near-zero in the projection-table architecture.
- **2026-04-28** — Phase 4's 27-consumer-file refactor ships as a single bundled PR rather than four waves. Reasoning: greenfield, no production users, mechanical change, one Cypress run gates the whole thing.
- **2026-04-28** — Reconciliation tool ships as a one-off CLI script (`pnpm tsx scripts/reconcile-loan-balances.ts`), not a scheduled job. Run manually when needed. Upgrade to scheduled when there are real users.
