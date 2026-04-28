# Loan Balances Projection Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing server-action-based loan balance computation (`getLoanBalancesFromLedger` + `loanBalanceCollection` + `subscribeToTableChanges("loans"|"payments")` + `listLoansWithOverdueAction`) with a Postgres trigger-maintained projection table `loan_balances`, synced to clients via `electricCollectionOptions`. Migrate `loanCollection` to Electric direct over the raw `loans` table. Build client-side hooks (`useLoansWithBalances`, `useLoanWithBalance`) that join `loanCollection × loanBalanceCollection × customerCollection` and reproduce the existing `LoanListEntry` shape, then migrate all consumer call sites.

**Architecture:** Source-of-truth tables (`loans`, `payments`, `transactions`) are edited only by application code. The new `loan_balances` projection table is written only by triggers — `AFTER INSERT/UPDATE/DELETE FOR EACH ROW` on `transactions` and `payments` — that call a recompute function which re-derives `outstanding_balance`, `unpaid_interest`, and `last_payment_date` for the affected loan from scratch. Clients subscribe to `loan_balances` as an ordinary Electric collection. `daysOverdue` and `dailyRate` remain client-side pure functions in the join hook because they depend on `today`. No backfill is needed (no production data). All 12 client consumer files migrate in a single bundled PR (the project is greenfield; high entropy is acceptable).

**Tech Stack:** Postgres 15+, Drizzle ORM 0.45 (schema only — triggers are raw SQL), `@electric-sql/client` 1.5, `@tanstack/electric-db-collection` 0.3, `@tanstack/react-db` 0.1, Vitest (unit + integration), Cypress (E2E).

---

## File Structure

### Created
- `drizzle/projections/loan_balances.sql` — table + recompute function + triggers (idempotent).
- `src/lib/db/schema/loan-balances.ts` — Drizzle TS schema for the projection table.
- `src/collections/loan-balances.ts` — `electricCollectionOptions` collection (read-only).
- `src/collections/loan-views.ts` — `useLoansWithBalances` and `useLoanWithBalance` hooks.
- `src/lib/interest/overdue-client.ts` — pure client-safe `computeDaysOverdue`.
- `src/lib/interest/effective-rate-client.ts` — pure client-safe `computeDailyRate`.
- `scripts/db-projections.ts` — applies every SQL file in `drizzle/projections/` via `psql`.
- `scripts/reconcile-loan-balances.ts` — one-off CLI that compares trigger output vs. `getLoanBalancesFromLedger`.
- `src/lib/db/__integration__/loan-balances-trigger.test.ts` — integration test exercising the trigger.
- `cypress/e2e/loan-balance-live.cy.ts` — E2E test that records a payment and asserts the loan list balance updates without page reload.

### Modified
- `src/lib/db/schema/index.ts` — re-export `loanBalances`.
- `src/lib/schemas/collections.ts` — add `loanBalanceSchema` / `LoanBalanceRow`.
- `src/app/api/electric/[...table]/route.ts` — add `"loan_balances"` to `ALLOWED_TABLES`.
- `src/collections/loans.ts` — replace `queryCollectionOptions` with `electricCollectionOptions`; remove `subscribeToTableChanges("loans", ...)`.
- `src/collections/index.ts` — export `loanBalanceCollection`.
- `src/lib/idle-prefetch.ts` — preload `loanBalanceCollection`.
- `package.json` — add `db:projections` script.
- 12 consumer files (listed in Task 4.5 below).

### Deleted
- `src/collections/loan-balance.ts` — replaced by `loan-balances.ts` + Electric collection.
- `src/actions/loan.actions.ts` — `listLoansWithOverdueAction` export removed (the rest of the file stays).
- Query keys `queryKeys.loans.balance` and any orphaned `queryKeys.loans.dueToday` references.

---

## Phase 1 — Projection plumbing

### Task 1.1: Drizzle TS schema for `loan_balances`

**Files:**
- Create: `src/lib/db/schema/loan-balances.ts`
- Modify: `src/lib/db/schema/index.ts`

- [ ] **Step 1: Create the schema file**

```ts
// src/lib/db/schema/loan-balances.ts
import { pgTable, uuid, numeric, timestamp } from "drizzle-orm/pg-core"
import { loans } from "./loans"

export const loanBalances = pgTable("loan_balances", {
  loanId: uuid("loan_id")
    .primaryKey()
    .references(() => loans.id, { onDelete: "cascade" }),
  outstandingBalance: numeric("outstanding_balance", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  unpaidInterest: numeric("unpaid_interest", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  lastPaymentDate: timestamp("last_payment_date", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})
```

- [ ] **Step 2: Re-export from schema index**

Add to `src/lib/db/schema/index.ts` (alongside the other re-exports):

```ts
export { loanBalances } from "./loan-balances"
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema/loan-balances.ts src/lib/db/schema/index.ts
git commit -m "feat(schema): add loan_balances projection table"
```

---

### Task 1.2: Zod schema export for `LoanBalanceRow`

**Files:**
- Modify: `src/lib/schemas/collections.ts`

- [ ] **Step 1: Add the schema export**

Append to `src/lib/schemas/collections.ts` (next to the other `createSelectSchema` exports around line 60):

```ts
import { loanBalances } from "@/lib/db/schema/loan-balances"

export const loanBalanceSchema = createSelectSchema(loanBalances)
export type LoanBalanceRow = typeof loanBalanceSchema._zod.output
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/schemas/collections.ts
git commit -m "feat(schemas): export loanBalanceSchema and LoanBalanceRow"
```

---

### Task 1.3: Projection SQL — table, recompute function, triggers

**Files:**
- Create: `drizzle/projections/loan_balances.sql`

- [ ] **Step 1: Create the SQL file**

```sql
-- drizzle/projections/loan_balances.sql
-- Idempotent. Apply via `pnpm db:projections`.

-- 1. Projection table.
CREATE TABLE IF NOT EXISTS loan_balances (
  loan_id              UUID PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE,
  outstanding_balance  NUMERIC(15,2) NOT NULL DEFAULT '0',
  unpaid_interest      NUMERIC(15,2) NOT NULL DEFAULT '0',
  last_payment_date    TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Recompute one loan's projection row from base data.
--    Asset account (Loans Receivable): debit adds, credit subtracts.
--    Revenue account (Interest Earned): credit adds, debit subtracts.
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
```

- [ ] **Step 2: Commit (no apply yet — that happens in Task 1.5)**

```bash
git add drizzle/projections/loan_balances.sql
git commit -m "feat(db): add loan_balances projection SQL with triggers"
```

---

### Task 1.4: `db:projections` script

**Files:**
- Create: `scripts/db-projections.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the script**

```ts
// scripts/db-projections.ts
// Applies every .sql file in drizzle/projections/ to the database in
// alphabetical filename order. Idempotent — safe to re-run.

import { spawnSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error("[db:projections] DATABASE_URL is required")
  process.exit(1)
}

const dir = join(process.cwd(), "drizzle", "projections")
let files: string[]
try {
  files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
} catch (err) {
  console.error(`[db:projections] cannot read ${dir}:`, err)
  process.exit(1)
}

if (files.length === 0) {
  console.log("[db:projections] no projection files found; nothing to do")
  process.exit(0)
}

for (const file of files) {
  const path = join(dir, file)
  const stats = statSync(path)
  console.log(`[db:projections] applying ${file} (${stats.size} bytes)`)
  const result = spawnSync("psql", [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-f", path], {
    stdio: "inherit",
  })
  if (result.status !== 0) {
    console.error(`[db:projections] psql exited ${result.status} for ${file}`)
    process.exit(result.status ?? 1)
  }
}

console.log(`[db:projections] applied ${files.length} file(s)`)
```

- [ ] **Step 2: Add the script to package.json**

In `package.json` `"scripts"`, add (alphabetical order, near the other `db:*` scripts):

```json
"db:projections": "tsx scripts/db-projections.ts",
```

- [ ] **Step 3: Verify psql is available locally**

Run: `which psql`

Expected: a path. If not installed, install it (`brew install libpq` on macOS, then symlink) — Postgres clients are required to apply the projection SQL.

- [ ] **Step 4: Commit**

```bash
git add scripts/db-projections.ts package.json
git commit -m "feat(scripts): add db:projections to apply projection SQL"
```

---

### Task 1.5: Apply the projection to dev DB and add `"loan_balances"` to the Electric proxy

**Files:**
- Modify: `src/app/api/electric/[...table]/route.ts`

- [ ] **Step 1: Apply to the dev database**

Run: `pnpm db:projections`

Expected output:
```
[db:projections] applying loan_balances.sql (... bytes)
... (psql output)
[db:projections] applied 1 file(s)
```

If the loans / payments / transactions tables don't exist yet (fresh DB), run `pnpm db:push` first to create the entity schema, then re-run `pnpm db:projections`.

- [ ] **Step 2: Verify the projection is wired up**

Run a quick psql sanity check:
```bash
psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc WHERE proname LIKE '%loan_balance%';"
```

Expected three rows: `refresh_loan_balance`, `on_transactions_change_for_loan_balance`, `on_payments_change_for_loan_balance`.

```bash
psql "$DATABASE_URL" -c "SELECT tgname FROM pg_trigger WHERE tgname LIKE '%loan_balance%';"
```

Expected two rows: `trg_transactions_loan_balance`, `trg_payments_loan_balance`.

- [ ] **Step 3: Add `"loan_balances"` to ALLOWED_TABLES in the Electric proxy**

Modify `src/app/api/electric/[...table]/route.ts` line 53-68:

```ts
const ALLOWED_TABLES = new Set([
  "customers",
  "loans",
  "loan_balances",          // ← add this line
  "payments",
  "transactions",
  "creditors",
  "creditor_investments",
  "creditor_repayments",
  "bank_accounts",
  "invitation",
  "delegation",
  "rate_change_requests",
  "fund_transfers",
  "collateral",
  "transaction_categories",
])
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/electric/\[...table\]/route.ts
git commit -m "feat(electric): allow loan_balances shape in proxy"
```

---

### Task 1.6: Integration test — trigger fires on `transactions` write

**Files:**
- Create: `src/lib/db/__integration__/loan-balances-trigger.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/db/__integration__/loan-balances-trigger.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { loanBalances } from "@/lib/db/schema/loan-balances"
import { eq, sql } from "drizzle-orm"

describe("loan_balances trigger", () => {
  beforeEach(async () => {
    // Clean slate. ON DELETE CASCADE on loan_balances.loan_id handles cleanup.
    await db.execute(sql`TRUNCATE TABLE transactions, payments, loans, customers, loan_balances RESTART IDENTITY CASCADE`)
  })

  it("upserts loan_balances when a transaction with a loanId is inserted", async () => {
    // Arrange: a customer, a loan, the Loans Receivable category.
    const [c] = await db.insert(customers).values({
      fullName: "Test", contact: "0700000000", address: "Kampala",
    }).returning()
    const [l] = await db.insert(loans).values({
      customerId: c.id,
      principalAmount: "100000",
      issuanceFee: "50000",
      interestRate: "0.10",
      minInterestDays: 30,
      startDate: new Date(),
      disbursementSource: "cash",
      status: "active",
      issuedBy: "test-user",
    }).returning()
    const [cat] = await db.insert(transactionCategories).values({
      name: "Loans Receivable", accountType: "asset",
    }).returning()

    // Act: insert a debit (loan disbursement).
    await db.insert(transactions).values({
      type: "debit",
      amount: "100000",
      categoryId: cat.id,
      loanId: l.id,
      transactionDate: new Date(),
      recordedBy: "test-user",
    })

    // Assert: loan_balances row appears with outstanding_balance = 100000.
    const [row] = await db.select().from(loanBalances).where(eq(loanBalances.loanId, l.id))
    expect(row).toBeDefined()
    expect(row.outstandingBalance).toBe("100000.00")
    expect(row.unpaidInterest).toBe("0.00")
  })

  it("subtracts a credit (payment) from outstanding_balance", async () => {
    const [c] = await db.insert(customers).values({
      fullName: "Test", contact: "0700000000", address: "Kampala",
    }).returning()
    const [l] = await db.insert(loans).values({
      customerId: c.id,
      principalAmount: "100000", issuanceFee: "50000", interestRate: "0.10",
      minInterestDays: 30, startDate: new Date(),
      disbursementSource: "cash", status: "active", issuedBy: "test-user",
    }).returning()
    const [cat] = await db.insert(transactionCategories).values({
      name: "Loans Receivable", accountType: "asset",
    }).returning()
    await db.insert(transactions).values({
      type: "debit", amount: "100000", categoryId: cat.id, loanId: l.id,
      transactionDate: new Date(), recordedBy: "test-user",
    })

    // Pay back 30000.
    await db.insert(transactions).values({
      type: "credit", amount: "30000", categoryId: cat.id, loanId: l.id,
      transactionDate: new Date(), recordedBy: "test-user",
    })

    const [row] = await db.select().from(loanBalances).where(eq(loanBalances.loanId, l.id))
    expect(row.outstandingBalance).toBe("70000.00")
  })
})
```

- [ ] **Step 2: Run the test — verify it passes**

Run: `pnpm test:integration src/lib/db/__integration__/loan-balances-trigger.test.ts`

Expected: both tests PASS. The triggers were already applied in Task 1.5, so the test exercises them directly.

If this fails with "function refresh_loan_balance does not exist": the projection wasn't applied to the test DB. Re-run `DATABASE_URL=$TEST_DATABASE_URL pnpm db:projections` (or whatever env the integration tests use).

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/__integration__/loan-balances-trigger.test.ts
git commit -m "test(db): integration test for loan_balances trigger"
```

---

## Phase 2 — Electric direct `loanBalanceCollection`

### Task 2.1: Create the new collection file

**Files:**
- Create: `src/collections/loan-balances.ts`

Note: this is a NEW file. The existing `src/collections/loan-balance.ts` (singular, queryFn-based) stays for now and gets deleted in Phase 5.

- [ ] **Step 1: Write the collection**

```ts
// src/collections/loan-balances.ts
"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import { shapeUrl, shapeOnError } from "@/lib/electric"
import { loanBalanceSchema, type LoanBalanceRow } from "@/lib/schemas/collections"

export type { LoanBalanceRow }

/**
 * Read-only Electric collection over the `loan_balances` projection table.
 * The table is maintained by triggers in `drizzle/projections/loan_balances.sql`;
 * application code never writes to it directly. No onInsert/onUpdate/onDelete.
 */
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
  }),
)
```

- [ ] **Step 2: Add to the collections barrel**

Modify `src/collections/index.ts` — add (alphabetical):

```ts
export { loanBalanceCollection } from "./loan-balances"
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/collections/loan-balances.ts src/collections/index.ts
git commit -m "feat(collections): add Electric direct loanBalanceCollection"
```

---

### Task 2.2: Preload `loanBalanceCollection` in IdlePrefetcher

**Files:**
- Modify: `src/lib/idle-prefetch.ts`

- [ ] **Step 1: Add to the preload list**

Modify `src/lib/idle-prefetch.ts:54-77` — add the new collection import and preload call:

```ts
async function runPrefetch(): Promise<void> {
  const [
    { loanCollection },
    { loanBalanceCollection },                  // ← add
    { customerCollection },
    { paymentCollection },
    { dashboardCollection },
    { bankAccountCollection },
  ] = await Promise.all([
    import("@/collections/loans"),
    import("@/collections/loan-balances"),      // ← add
    import("@/collections/customers"),
    import("@/collections/payments"),
    import("@/collections/dashboard"),
    import("@/collections/bank-accounts"),
  ])
  for (const c of [
    loanCollection,
    loanBalanceCollection,                      // ← add
    customerCollection,
    paymentCollection,
    dashboardCollection,
    bankAccountCollection,
  ]) {
    void c.preload()
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/idle-prefetch.ts
git commit -m "feat(prefetch): preload loanBalanceCollection during idle"
```

---

## Phase 3 — Migrate `loanCollection` to Electric direct

⚠️ **Phase 3 and Phase 4 must land together as one PR** (single bundled PR per the design decisions). Phase 3 changes `loanCollection`'s row shape from `LoanListEntry` to the raw `LoanBaseRow`, which breaks every consumer until Phase 4 fixes them. Do not push Phase 3 alone.

### Task 3.1: Rewrite `src/collections/loans.ts` to Electric direct

**Files:**
- Modify: `src/collections/loans.ts`

- [ ] **Step 1: Replace the collection definition**

Replace the entire contents of `src/collections/loans.ts` with:

```ts
"use client"

import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { snakeCamelMapper } from "@electric-sql/client"
import {
  createLoanAction,
  waivePenaltyAction,
  adjustPenaltyMultiplierAction,
} from "@/actions/loan.actions"
import { settleWithCollateralAction } from "@/actions/settlement.actions"
import type { CreateLoanInput } from "@/types/loan"
import { loanRowSchema, type LoanBaseRow } from "@/lib/schemas/collections"
import { shapeUrl, shapeOnError } from "@/lib/electric"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Row shape synced via Electric — mirrors the `loans` DB table after
 * snake_case → camelCase mapping AND `loanRowSchema` coercion (timestamp
 * columns arrive as ISO strings on the wire and are coerced to `Date` here).
 *
 * Server-only enrichments (customerName, customerContact, outstandingBalance,
 * unpaidInterest, lastPaymentDate, daysOverdue, dailyRate) are NOT on this row.
 * Consumers read them via the `useLoansWithBalances` / `useLoanWithBalance`
 * hooks in `src/collections/loan-views.ts`, which join with
 * `customerCollection` and `loanBalanceCollection` and compute the
 * date-dependent fields client-side.
 */
export type LoanRow = LoanBaseRow

type LoanInsertMetadata = {
  intent: "create"
  input: CreateLoanInput
}

type LoanUpdateMetadata =
  | { intent: "settle"; reason: string }
  | { intent: "waive-penalty" }
  | { intent: "adjust-penalty"; multiplier: string }

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
    onInsert: async ({ transaction }) => {
      const { metadata } = transaction.mutations[0]
      const meta = metadata as LoanInsertMetadata | undefined
      if (!meta?.input) {
        throw new Error("Loan inserts must include metadata.input (CreateLoanInput)")
      }
      const result = await createLoanAction(meta.input)
      if ("error" in result) throw new Error(result.error)
      // Cross-cutting invalidations for surfaces NOT yet projection-backed.
      const qc = getQueryClient()
      qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
      qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
      qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
      qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
      return { txid: result.txid }
    },
    onUpdate: async ({ transaction }) => {
      const { original, metadata } = transaction.mutations[0]
      const meta = metadata as LoanUpdateMetadata | undefined
      if (!meta) {
        throw new Error("Loan updates must include metadata.intent")
      }

      if (meta.intent === "settle") {
        const result = await settleWithCollateralAction({
          loanId: original.id,
          reason: meta.reason,
        })
        if ("error" in result) throw new Error(result.error)
        const qc = getQueryClient()
        qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
        qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
        qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
        return { txid: result.txid }
      }

      if (meta.intent === "waive-penalty") {
        const result = await waivePenaltyAction(original.id)
        if ("error" in result) throw new Error(result.error)
        return { txid: result.txid }
      }

      if (meta.intent === "adjust-penalty") {
        const result = await adjustPenaltyMultiplierAction(original.id, meta.multiplier)
        if ("error" in result) throw new Error(result.error)
        return { txid: result.txid }
      }

      throw new Error(`Unknown loan update intent: ${(meta as { intent: string }).intent}`)
    },
  }),
)

/**
 * Thin wrapper kept because the call site needs to pass an off-row
 * `CreateLoanInput` (collateral, rollover, etc.) via the metadata channel.
 */
export function insertLoanWithInput(
  _id: string,
  optimistic: LoanRow,
  input: CreateLoanInput,
) {
  loanCollection.insert(optimistic, {
    metadata: { intent: "create", input } satisfies LoanInsertMetadata,
  })
}
```

Notes:
- `subscribeToTableChanges("loans", getQueryClient(), [...])` is **gone** — Electric direct gives live row updates natively.
- Imports of `listLoansWithOverdueAction` and `queryCollectionOptions` are gone.
- `LoanListEntry` is no longer used here; it becomes the return type of the hooks in Phase 4.
- The cross-cutting invalidations in `onInsert` / `onUpdate` for `dashboard`/`reports`/`locationBalances` stay — those collections are NOT yet projection-backed.

- [ ] **Step 2: Typecheck WILL FAIL**

Run: `pnpm typecheck`

Expected: errors in the 12 consumer files referencing `loanCollection`'s old `LoanListEntry`-shaped row (e.g., `loan.customerName`, `loan.outstandingBalance`). **This is expected.** Phase 4 fixes them.

Do **not** commit yet — Phase 3 + Phase 4 ship as one bundled commit at the end of Task 4.6.

---

## Phase 4 — Consumer hooks + 12-file consumer migration (single bundled PR with Phase 3)

### Task 4.1: Extract pure client-safe `computeDaysOverdue`

**Files:**
- Create: `src/lib/interest/overdue-client.ts`

- [ ] **Step 1: Read the existing server function**

Read: `src/lib/interest/overdue.ts` — find `computeLoanOverdueInfo` and any helpers it uses. Note the exact set of inputs and the date arithmetic.

- [ ] **Step 2: Write the client-safe version**

```ts
// src/lib/interest/overdue-client.ts
// Pure client-safe overdue computation. No DB access, no server imports.
// Mirrors the date arithmetic in `src/lib/interest/overdue.ts` but takes
// already-fetched primitives so it can run in the browser inside a
// `useLiveQuery` select callback.

import type { LoanBaseRow } from "@/lib/schemas/collections"

/**
 * Compute days overdue for a loan given its raw row, the most recent payment
 * date (from `loan_balances.lastPaymentDate`), and the current date.
 *
 * Mirrors the server-side semantics in `src/lib/interest/overdue.ts`:
 * a loan is overdue when more than `minInterestDays` (typically 30) have
 * elapsed since the last payment date (or since `startDate` for loans with
 * no payments yet). Returns 0 when not overdue, when the loan is not active,
 * or when inputs are invalid.
 */
export function computeDaysOverdue(
  loan: Pick<LoanBaseRow, "status" | "startDate" | "minInterestDays">,
  lastPaymentDate: Date | null,
  today: Date,
): number {
  if (loan.status !== "active") return 0
  const reference = lastPaymentDate ?? loan.startDate
  if (!reference) return 0
  const ms = today.getTime() - reference.getTime()
  if (ms < 0) return 0
  const days = Math.floor(ms / (1000 * 60 * 60 * 24))
  const grace = loan.minInterestDays ?? 30
  return Math.max(0, days - grace)
}
```

If the server-side `computeLoanOverdueInfo` does anything more (handles `interestRateOverride`, `minPeriodOverride`, etc.) read it carefully and mirror it here. Verify by porting its return value through this function for at least one realistic loan and confirming equality.

- [ ] **Step 3: Add a unit test**

Create `src/lib/interest/__tests__/overdue-client.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { computeDaysOverdue } from "../overdue-client"

const baseLoan = {
  status: "active" as const,
  startDate: new Date("2026-01-01"),
  minInterestDays: 30,
}

describe("computeDaysOverdue", () => {
  it("returns 0 when no time has elapsed", () => {
    expect(
      computeDaysOverdue(baseLoan, null, new Date("2026-01-01")),
    ).toBe(0)
  })

  it("returns 0 within the grace period", () => {
    expect(
      computeDaysOverdue(baseLoan, null, new Date("2026-01-25")),
    ).toBe(0)
  })

  it("returns days past the grace period", () => {
    expect(
      computeDaysOverdue(baseLoan, null, new Date("2026-02-15")),
    ).toBe(15) // 45 elapsed - 30 grace
  })

  it("uses lastPaymentDate when present", () => {
    expect(
      computeDaysOverdue(baseLoan, new Date("2026-02-01"), new Date("2026-03-15")),
    ).toBe(12) // 42 elapsed - 30 grace
  })

  it("returns 0 for non-active loans", () => {
    expect(
      computeDaysOverdue({ ...baseLoan, status: "fully_paid" }, null, new Date("2026-12-31")),
    ).toBe(0)
  })
})
```

Run: `pnpm vitest run src/lib/interest/__tests__/overdue-client.test.ts`

Expected: PASS.

---

### Task 4.2: Extract pure client-safe `computeDailyRate`

**Files:**
- Create: `src/lib/interest/effective-rate-client.ts`

- [ ] **Step 1: Read the existing server function**

Read: `src/lib/interest/effective-rate.ts` — find the daily-rate computation and `getBaseRate`.

- [ ] **Step 2: Write the client-safe version**

```ts
// src/lib/interest/effective-rate-client.ts
// Pure client-safe daily-rate computation. Mirrors `getBaseRate` semantics.

import BigNumber from "bignumber.js"
import type { LoanBaseRow } from "@/lib/schemas/collections"

/**
 * Daily interest amount in UGX as a string. "0" for non-active loans.
 * monthlyRate × principal ÷ 30 (using minInterestDays).
 */
export function computeDailyRate(
  loan: Pick<LoanBaseRow, "status" | "principalAmount" | "interestRate" | "interestRateOverride" | "minInterestDays">,
): string {
  if (loan.status !== "active") return "0"
  const rate = new BigNumber(loan.interestRateOverride ?? loan.interestRate ?? "0")
  const principal = new BigNumber(loan.principalAmount ?? "0")
  const period = loan.minInterestDays ?? 30
  if (period <= 0) return "0"
  return rate.multipliedBy(principal).dividedBy(period).toFixed(0)
}
```

If `effective-rate.ts` includes penalty-multiplier handling, mirror it here. Verify against existing call sites.

- [ ] **Step 3: Add a unit test**

Create `src/lib/interest/__tests__/effective-rate-client.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { computeDailyRate } from "../effective-rate-client"

describe("computeDailyRate", () => {
  it("computes monthly rate × principal / period", () => {
    expect(
      computeDailyRate({
        status: "active",
        principalAmount: "300000",
        interestRate: "0.10",
        interestRateOverride: null,
        minInterestDays: 30,
      }),
    ).toBe("1000") // 0.10 * 300000 / 30
  })

  it("returns 0 for non-active", () => {
    expect(
      computeDailyRate({
        status: "fully_paid",
        principalAmount: "300000",
        interestRate: "0.10",
        interestRateOverride: null,
        minInterestDays: 30,
      }),
    ).toBe("0")
  })

  it("uses interestRateOverride when present", () => {
    expect(
      computeDailyRate({
        status: "active",
        principalAmount: "300000",
        interestRate: "0.10",
        interestRateOverride: "0.05",
        minInterestDays: 30,
      }),
    ).toBe("500")
  })
})
```

Run: `pnpm vitest run src/lib/interest/__tests__/effective-rate-client.test.ts`

Expected: PASS.

---

### Task 4.3: Build `useLoansWithBalances` and `useLoanWithBalance`

**Files:**
- Create: `src/collections/loan-views.ts`

- [ ] **Step 1: Write the hooks file**

```ts
// src/collections/loan-views.ts
"use client"

import { useLiveQuery, eq } from "@tanstack/react-db"
import { loanCollection } from "./loans"
import { loanBalanceCollection } from "./loan-balances"
import { customerCollection } from "./customers"
import { computeDaysOverdue } from "@/lib/interest/overdue-client"
import { computeDailyRate } from "@/lib/interest/effective-rate-client"
import type { LoanListEntry } from "@/types/loan"
import type { LoanBaseRow, LoanBalanceRow, CustomerRow } from "@/lib/schemas/collections"

/**
 * Project a (loan, balance, customer) join into the legacy `LoanListEntry`
 * shape that consumer code already expects. `daysOverdue` and `dailyRate`
 * are computed client-side from primitives + `today`; they are NOT projection
 * columns because they depend on the moving wall clock.
 */
function projectLoanListEntry(
  loan: LoanBaseRow,
  bal: LoanBalanceRow | undefined,
  cust: CustomerRow | undefined,
  today: Date,
): LoanListEntry {
  return {
    ...loan,
    customerName: cust?.fullName ?? "—",
    customerContact: cust?.contact ?? null,
    outstandingBalance: bal?.outstandingBalance ?? "0",
    unpaidInterest: bal?.unpaidInterest ?? "0",
    lastPaymentDate: bal?.lastPaymentDate ?? null,
    daysOverdue: computeDaysOverdue(loan, bal?.lastPaymentDate ?? null, today),
    dailyRate: computeDailyRate(loan),
  }
}

/**
 * Live query: every loan, joined with its balance projection and customer.
 * Returns rows shaped like the legacy `LoanListEntry`.
 */
export function useLoansWithBalances() {
  // Using a single `today` per render: any minute-level recompute would be
  // achieved by a re-render trigger (router change, focus event), which is
  // already how the existing UI behaves. Don't put `new Date()` inside .select
  // unless you want it to evaluate on every collection change.
  const today = new Date()
  return useLiveQuery((q) =>
    q
      .from({ loan: loanCollection })
      .join({ bal: loanBalanceCollection }, ({ loan, bal }) => eq(loan.id, bal.loanId), "left")
      .join({ cust: customerCollection }, ({ loan, cust }) => eq(loan.customerId, cust.id), "left")
      .select(({ loan, bal, cust }) => projectLoanListEntry(loan, bal, cust, today)),
  )
}

/**
 * Live query: a single loan by id, joined with balance + customer.
 */
export function useLoanWithBalance(loanId: string) {
  const today = new Date()
  return useLiveQuery(
    (q) =>
      q
        .from({ loan: loanCollection })
        .join({ bal: loanBalanceCollection }, ({ loan, bal }) => eq(loan.id, bal.loanId), "left")
        .join({ cust: customerCollection }, ({ loan, cust }) => eq(loan.customerId, cust.id), "left")
        .where(({ loan }) => eq(loan.id, loanId))
        .select(({ loan, bal, cust }) => projectLoanListEntry(loan, bal, cust, today)),
    [loanId],
  )
}

/**
 * Live query: all loans for one customer (powers the customer-detail page
 * and the credit-score badge). Same projected shape as useLoansWithBalances.
 */
export function useLoansForCustomer(customerId: string) {
  const today = new Date()
  return useLiveQuery(
    (q) =>
      q
        .from({ loan: loanCollection })
        .join({ bal: loanBalanceCollection }, ({ loan, bal }) => eq(loan.id, bal.loanId), "left")
        .join({ cust: customerCollection }, ({ loan, cust }) => eq(loan.customerId, cust.id), "left")
        .where(({ loan }) => eq(loan.customerId, customerId))
        .select(({ loan, bal, cust }) => projectLoanListEntry(loan, bal, cust, today)),
    [customerId],
  )
}
```

- [ ] **Step 2: Add to barrel**

Add to `src/collections/index.ts`:

```ts
export { useLoansWithBalances, useLoanWithBalance, useLoansForCustomer } from "./loan-views"
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

Expected: still failing on the 12 consumer files (same errors as Task 3.1 step 2). The hooks file itself should typecheck cleanly.

---

### Task 4.4: Update `LoanListEntry` to clarify field origin

**Files:**
- Modify: `src/types/loan.ts`

- [ ] **Step 1: Add a comment**

Add a comment block above the `LoanListEntry` type at `src/types/loan.ts:9` explaining that this is the **consumer-facing** shape produced by the `useLoansWithBalances` hook, not the wire shape of `loanCollection`:

```ts
/**
 * Consumer-facing loan row. Produced client-side by `useLoansWithBalances`
 * and friends in `src/collections/loan-views.ts` by joining the raw loan
 * row (`loanCollection`) with the projected balance (`loanBalanceCollection`,
 * trigger-maintained from `transactions` + `payments`) and the customer
 * (`customerCollection`), plus client-side computations of `daysOverdue`
 * and `dailyRate` that depend on the current date.
 *
 * Do NOT add server-derived fields here without first deciding whether
 * they belong as projection columns (server-maintained, fresh on read) or
 * as client-side computations (date-dependent, fresh per render).
 */
export type LoanListEntry = LoanWithCustomer & {
  daysOverdue: number
  outstandingBalance: string
  dailyRate: string
  lastPaymentDate: Date | null
  unpaidInterest: string
}
```

The shape itself doesn't change.

---

### Task 4.5: Migrate the 12 consumer files

**Files (each one a separate sub-step):**
- `src/app/(app)/loans/page.tsx`
- `src/app/(app)/loans/[loanId]/page.tsx`
- `src/app/(app)/loans/[loanId]/payments/new/page.tsx`
- `src/app/(app)/loans/[loanId]/loan-detail-client.tsx`
- `src/app/(app)/customers/page.tsx`
- `src/app/(app)/customers/[id]/page.tsx`
- `src/app/(app)/payments/PaymentsClient.tsx`
- `src/app/(app)/payments/QuickRecordDialog.tsx`
- `src/app/(app)/payments/LoanSearchCombobox.tsx`
- `src/app/(app)/approvals/page.tsx`
- `src/components/loans/settle-collateral-dialog.tsx`
- `src/components/credit-score/credit-score-badge.tsx`

**Migration rules** — apply consistently to every file:

1. **For READ queries** that today look like `useLiveQuery((q) => q.from({ l: loanCollection }))` or similar — replace with `useLoansWithBalances()` (or `useLoanWithBalance(id)` for single-loan, or `useLoansForCustomer(customerId)` for customer-scoped).
2. **For WRITE call sites** — `loanCollection.insert(...)`, `loanCollection.update(...)`, `insertLoanWithInput(...)` — leave them on `loanCollection` directly. The mutation handlers still exist there. **Note**: the optimistic row passed to `.insert()` must now match `LoanRow` (raw row), not the legacy `LoanListEntry`. Drop the optimistic enrichment fields (`customerName`, `outstandingBalance`, etc.) from the optimistic insert — they'll appear via the join hook once the row is committed.
3. **For type imports** — change `import { ... } from "@/types/loan"` for `LoanListEntry` to keep importing it. The hooks return that shape.
4. **For `LoanWithCustomer`** — same. Still the right type for hook returns.

- [ ] **Step 1: Migrate `src/app/(app)/loans/page.tsx`**

  Replace `q.from({ loan: loanCollection }).select(({ loan }) => loan)` (around line 42-44) with:
  ```ts
  const { data, isLoading } = useLoansWithBalances()
  ```
  Drop the `loanCollection` import. Add `import { useLoansWithBalances } from "@/collections/loan-views"`.

  Run: `pnpm typecheck && pnpm vitest run` — expected PASS for any tests that touch this file.

- [ ] **Step 2: Migrate `src/app/(app)/loans/[loanId]/page.tsx`**

  Replace the `useLiveQuery` around line 20-25 with `useLoanWithBalance(loanId)`. Adjust destructuring of `data` (it's now an array of one). Drop the `loanCollection` and `customerCollection` imports. Drop the separate customer fetch.

- [ ] **Step 3: Migrate `src/app/(app)/loans/[loanId]/payments/new/page.tsx`**

  Replace the loan-only useLiveQuery around line 16-18 with `useLoanWithBalance(loanId)`. Drop the `loanCollection` import.

- [ ] **Step 4: Migrate `src/app/(app)/loans/[loanId]/loan-detail-client.tsx`**

  Two cases:
  - The READ path (which feeds `loan` into the rendering) — switch to `useLoanWithBalance` returned from the page wrapper, OR use it directly here if the component fetches.
  - The WRITE path (`loanCollection.update(loan.id, ...)` around lines 315 and 332) — keep using `loanCollection.update`. The `original` row passed in handler context is now `LoanRow`, not `LoanListEntry`. If any code reads `original.customerName`/`original.outstandingBalance` inside the handler, get those from a separate live-query lookup or from props.

- [ ] **Step 5: Migrate `src/app/(app)/customers/page.tsx`**

  Replace `q.from({ l: loanCollection }).select(({ l }) => l)` around line 40 with `useLoansWithBalances()` (the page derives per-customer aggregates client-side from this list).

- [ ] **Step 6: Migrate `src/app/(app)/customers/[id]/page.tsx`**

  Replace the `useLiveQuery` around line 248-250 with `useLoansForCustomer(customerId)`.

- [ ] **Step 7: Migrate `src/app/(app)/payments/PaymentsClient.tsx`**

  Two READ sites:
  - The "all loans" lookup around line 145-147 — replace with `useLoansWithBalances()`.
  - The "join paymentCollection with loanCollection" display query around line 165-168 — keep this join on `loanCollection` directly (it only reads loan id + customer id; doesn't need balances). Adjust any field access to use raw row fields.

- [ ] **Step 8: Migrate `src/app/(app)/payments/QuickRecordDialog.tsx`**

  Replace the `loanCollection`-only query around line 74-76 with `useLoansWithBalances()`. Filter to active loans in the consumer.

- [ ] **Step 9: Migrate `src/app/(app)/payments/LoanSearchCombobox.tsx`**

  Replace the `loanCollection`-only query around line 30-32 with `useLoansWithBalances()`. Search by customer name now hits the projected `customerName` field.

- [ ] **Step 10: Migrate `src/app/(app)/approvals/page.tsx`**

  Replace the `loanCollection` query around line 103-105 with `useLoansWithBalances()`.

- [ ] **Step 11: Migrate `src/components/loans/settle-collateral-dialog.tsx`**

  This is a WRITE call site (`loanCollection.update(loanId, ...)` around line 48). Keep using `loanCollection.update` directly. Remove any code that reads `outstandingBalance`/`unpaidInterest` from the loan row passed into props — those should come from `useLoanWithBalance(loanId)` in the parent component or from props.

- [ ] **Step 12: Migrate `src/components/credit-score/credit-score-badge.tsx`**

  Replace the `loanCollection` query around line 18-20 with `useLoansForCustomer(customerId)`.

- [ ] **Step 13: Run full typecheck**

Run: `pnpm typecheck`

Expected: PASS. If any file still references `LoanListEntry` fields directly off `loanCollection`'s row shape, fix it.

- [ ] **Step 14: Run full unit + integration test suite**

Run: `pnpm test` then `pnpm test:integration`

Expected: all PASS.

---

### Task 4.6: Cypress E2E — live balance update after payment

**Files:**
- Create: `cypress/e2e/loan-balance-live.cy.ts`

- [ ] **Step 1: Write the spec**

```ts
// cypress/e2e/loan-balance-live.cy.ts
describe("Loan balance live update", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Balance Tester" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("updates the outstanding balance on the loan-detail page after a payment is recorded, without navigation", () => {
    // Arrange: customer + loan
    cy.visit("/customers/new")
    cy.get("#fullName").type("Live Balance Borrower")
    cy.get("#contact").type("0772000001")
    cy.get("#address").type("Kampala")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)

    let customerId: string
    cy.url().then((url) => {
      customerId = url.split("/customers/")[1]
      cy.visit(`/loans/new?customerId=${customerId}`)
      cy.get("#principalAmount").type("500000")
      cy.get("#issuanceFee").type("50000")
      cy.get("#description").type("Live balance test loan")
      cy.contains("button", "Next").click()
      cy.get("#collateralNature").click()
      cy.get("[role=option]").contains("Land Title").click()
      cy.get("[data-base-ui-inert]").should("not.exist")
      cy.contains("button", "Next").click()
      cy.contains("button", "Issue Loan").click()
      cy.dismissReceiptModal()
      cy.url({ timeout: 10000 }).should("include", `/customers/${customerId}`)
    })

    // Navigate to the loan detail page (from customer page → loan link)
    cy.contains("a", /LOAN-/).click()
    cy.url({ timeout: 10000 }).should("match", /\/loans\/.+/)

    // Assert: outstanding balance appears as 500,000 (the loan principal)
    cy.contains("Outstanding Balance", { timeout: 10000 })
      .closest("[data-slot=card], div")
      .should("contain", "UGX 500,000")

    // Act: open the new-payment form and record a 100,000 payment
    cy.contains("a, button", /Record Payment|Quick Record|New Payment/).first().click()
    cy.get("#amount, [name=amount]").first().type("100000")
    cy.contains("button", /Record|Submit/).click()

    // Wait for the form to dismiss / nav back
    cy.url({ timeout: 10000 }).should("match", /\/loans\/.+/)

    // Assert: the SAME loan-detail page now shows 400,000 outstanding —
    // without a manual reload. This proves the trigger fired in the same
    // DB transaction as the payment write, the loan_balances row was
    // replicated via Electric, and the useLoanWithBalance live query
    // reactively rendered the new value.
    cy.contains("Outstanding Balance", { timeout: 10000 })
      .closest("[data-slot=card], div")
      .should("contain", "UGX 400,000")
  })
})
```

- [ ] **Step 2: Run the new spec**

Run: `pnpm cypress run --spec cypress/e2e/loan-balance-live.cy.ts --headless`

Expected: PASS. If it fails:
- "outstanding balance still shows 500,000": the trigger isn't firing, or the proxy isn't allowing `loan_balances`, or the IdlePrefetcher isn't subscribed. Check Network tab in headed mode (`pnpm cypress open`).
- DOM selector mismatch: tweak `closest("[data-slot=card], div")` to match the real markup. Selectors above are best-guess; verify against the actual page.

- [ ] **Step 3: Run the full Cypress suite**

Run: `pnpm test:e2e`

Expected: all specs PASS, including pre-existing dashboard / activity-feed / collection-pages-regression specs.

- [ ] **Step 4: Commit Phases 3 + 4 together**

```bash
git add src/collections/loans.ts src/collections/loan-views.ts src/lib/interest/overdue-client.ts src/lib/interest/effective-rate-client.ts src/lib/interest/__tests__/ src/types/loan.ts src/app src/components cypress/e2e/loan-balance-live.cy.ts
git commit -m "feat(loans): migrate loanCollection to Electric direct + projection-backed balance

Replace queryFn/listLoansWithOverdueAction with electricCollectionOptions over
the raw loans table. Server-derived fields (customerName, outstandingBalance,
unpaidInterest, lastPaymentDate) come from joins with customerCollection and
the new loanBalanceCollection (trigger-maintained projection). Date-dependent
fields (daysOverdue, dailyRate) are pure client-side functions in the new
useLoansWithBalances/useLoanWithBalance/useLoansForCustomer hooks.

All 12 consumer files migrated in this commit. Existing LoanListEntry shape
preserved as the hook return type."
```

---

## Phase 5 — Retire legacy `loan-balance.ts` and related machinery

### Task 5.1: Delete `src/collections/loan-balance.ts`

**Files:**
- Delete: `src/collections/loan-balance.ts`
- Modify: `src/collections/index.ts` (remove the `getLoanBalanceCollection` export if any)

- [ ] **Step 1: Verify no consumers remain**

Run: `pnpm grep "getLoanBalanceCollection" -- "src/**/*.{ts,tsx}"`

(or use ripgrep equivalent.) Expected: zero matches in `src/`. If any remain, migrate them to `loanBalanceCollection` first.

- [ ] **Step 2: Delete the file**

```bash
rm src/collections/loan-balance.ts
```

- [ ] **Step 3: Remove the barrel export**

If `src/collections/index.ts` had `export { ... } from "./loan-balance"`, delete that line.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/collections/loan-balance.ts src/collections/index.ts
git commit -m "refactor(collections): delete legacy loan-balance.ts (queryFn-based)"
```

---

### Task 5.2: Remove orphaned query keys

**Files:**
- Modify: `src/lib/query-keys.ts`

- [ ] **Step 1: Audit usages of `queryKeys.loans.balance` and `queryKeys.loans.dueToday`**

Run: `pnpm grep "queryKeys.loans.balance\|queryKeys.loans.dueToday" -- "src/**/*.{ts,tsx}"`

If any active consumers exist, leave the keys. If they're orphaned (only referenced by their own definition), delete:

```ts
// src/lib/query-keys.ts — in `loans` namespace
balance: (loanId: string) => ["loans", loanId, "balance"] as const,   // ← delete if unused
dueToday: ["loans-due-today"] as const,                                // ← keep — still used by daily-collections
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "refactor(query-keys): remove orphaned loans.balance key"
```

---

## Phase 6 — Remove redundant `subscribeToTableChanges` calls

### Task 6.1: Audit and remove the calls that exist solely for loan-balance invalidation

**Files:**
- Modify: `src/collections/loan-extras.ts:26-29` (only the ones that invalidate `["loans"]`-related keys)

- [ ] **Step 1: List all remaining `subscribeToTableChanges` call sites**

Run: `pnpm grep "subscribeToTableChanges(" -- "src/collections/**/*.ts"`

Categorize each:
- Calls invalidating `queryKeys.locationBalances.all` — KEEP (location balances aren't projection-backed yet).
- Calls invalidating `queryKeys.dashboard.kpis`, `queryKeys.dailyCollections.all`, `queryKeys.reports.*` — KEEP (those collections aren't projection-backed yet).
- Calls invalidating ONLY `queryKeys.loans.all` or `queryKeys.loans.balance` — DELETE (Electric direct on `loans` and `loan_balances` makes them redundant).

For this codebase, the only candidate to delete is in `src/collections/loans.ts` — but that file was already rewritten in Task 3.1, which removed those calls. So Phase 6 may be a no-op if Task 3.1 was thorough.

- [ ] **Step 2: Verify nothing else references invalidating `["loans"]`**

Run: `pnpm grep "queryKeys.loans.all" -- "src/**/*.{ts,tsx}"`

Expected: zero matches in `src/collections/` and `src/lib/`. Matches in mutation handlers (`payments.ts:invalidateCrossCutting`, `loan-extras.ts`) are fine — those serve cross-cutting refresh of NON-projection collections that still depend on loan changes.

- [ ] **Step 3: Commit (no-op or trivial cleanup)**

If anything was removed:
```bash
git add src/collections/
git commit -m "refactor(electric): drop redundant subscribeToTableChanges for loans"
```

If nothing was removed: skip — Phase 6 was already absorbed into Phase 3.

---

## Phase 7 — Retire `listLoansWithOverdueAction` and add reconciliation tool

### Task 7.1: Delete `listLoansWithOverdueAction`

**Files:**
- Modify: `src/actions/loan.actions.ts`

- [ ] **Step 1: Verify no consumers**

Run: `pnpm grep "listLoansWithOverdueAction" -- "src/**/*.{ts,tsx}"`

Expected: zero matches outside `src/actions/loan.actions.ts` itself. (If any remain, they were missed in Phase 4 — go fix them first.)

- [ ] **Step 2: Delete the export**

Find `export const listLoansWithOverdueAction = ...` (or wherever it's defined in `src/actions/loan.actions.ts`) and delete it. The other actions in the file stay.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/actions/loan.actions.ts
git commit -m "refactor(actions): retire listLoansWithOverdueAction (replaced by loan_balances projection)"
```

---

### Task 7.2: Reconciliation CLI tool

**Files:**
- Create: `scripts/reconcile-loan-balances.ts`

- [ ] **Step 1: Write the script**

```ts
// scripts/reconcile-loan-balances.ts
// One-off reconciliation: compares trigger-maintained loan_balances rows
// against a fresh server-side recompute via getLoanBalancesFromLedger /
// getInterestEarnedFromLedger. Reports any drift.
//
// Usage: pnpm tsx scripts/reconcile-loan-balances.ts
// Exit code 0 if all match; 1 if any drift.

import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { loanBalances } from "@/lib/db/schema/loan-balances"
import { payments } from "@/lib/db/schema/payments"
import {
  getLoanBalancesFromLedger,
  getInterestEarnedFromLedger,
} from "@/services/ledger-queries.service"
import { eq, sql } from "drizzle-orm"
import BigNumber from "bignumber.js"

async function main() {
  const allLoans = await db.select({ id: loans.id }).from(loans)
  const ids = allLoans.map((l) => l.id)
  if (ids.length === 0) {
    console.log("[reconcile] no loans found; nothing to check")
    return
  }

  const [serverBalances, serverInterest, projectionRows] = await Promise.all([
    getLoanBalancesFromLedger(ids),
    getInterestEarnedFromLedger(ids),
    db.select().from(loanBalances),
  ])

  // Server-side last_payment_date per loan (one query for all loans).
  const lpdRows = await db
    .select({ loanId: payments.loanId, lpd: sql<Date>`MAX(${payments.paymentDate})` })
    .from(payments)
    .groupBy(payments.loanId)
  const serverLpd = new Map(lpdRows.map((r) => [r.loanId, r.lpd]))

  const projection = new Map(projectionRows.map((r) => [r.loanId, r]))

  let drift = 0
  for (const id of ids) {
    const expectedBalance = serverBalances.get(id) ?? new BigNumber(0)
    const expectedInterest = serverInterest.get(id) ?? new BigNumber(0)
    const expectedLpd = serverLpd.get(id) ?? null
    const proj = projection.get(id)
    if (!proj) {
      console.error(`[reconcile] DRIFT loan=${id}: projection row missing entirely`)
      drift++
      continue
    }
    const actualBalance = new BigNumber(proj.outstandingBalance)
    const actualInterest = new BigNumber(proj.unpaidInterest)
    if (!actualBalance.isEqualTo(expectedBalance)) {
      console.error(
        `[reconcile] DRIFT loan=${id} outstanding_balance: projection=${actualBalance.toFixed(2)} expected=${expectedBalance.toFixed(2)}`,
      )
      drift++
    }
    if (!actualInterest.isEqualTo(expectedInterest)) {
      console.error(
        `[reconcile] DRIFT loan=${id} unpaid_interest: projection=${actualInterest.toFixed(2)} expected=${expectedInterest.toFixed(2)}`,
      )
      drift++
    }
    const projLpdMs = proj.lastPaymentDate?.getTime() ?? null
    const expLpdMs = expectedLpd?.getTime() ?? null
    if (projLpdMs !== expLpdMs) {
      console.error(
        `[reconcile] DRIFT loan=${id} last_payment_date: projection=${proj.lastPaymentDate} expected=${expectedLpd}`,
      )
      drift++
    }
  }

  if (drift === 0) {
    console.log(`[reconcile] OK — ${ids.length} loan(s) checked, no drift`)
  } else {
    console.error(`[reconcile] FAIL — ${drift} drift event(s) across ${ids.length} loan(s)`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("[reconcile] crashed:", err)
  process.exit(1)
})
```

- [ ] **Step 2: Test it against the dev DB**

Seed some test data (issue a loan, record a payment via the UI in dev), then:

Run: `pnpm tsx scripts/reconcile-loan-balances.ts`

Expected: `[reconcile] OK — N loan(s) checked, no drift`.

- [ ] **Step 3: Commit**

```bash
git add scripts/reconcile-loan-balances.ts
git commit -m "feat(scripts): add reconcile-loan-balances drift check"
```

---

## Phase 8 — Final verification

### Task 8.1: Run the full validation pipeline

**Files:** none

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`

Expected: zero errors.

- [ ] **Step 2: Run unit tests**

Run: `pnpm test:unit`

Expected: all PASS.

- [ ] **Step 3: Run integration tests**

Run: `pnpm test:integration`

Expected: all PASS.

- [ ] **Step 4: Run full Cypress suite**

Run: `pnpm test:e2e`

Expected: all PASS, including the new `loan-balance-live.cy.ts`.

- [ ] **Step 5: Run reconciliation as a final sanity check**

Issue a few loans + record a few payments in dev, then:

Run: `pnpm tsx scripts/reconcile-loan-balances.ts`

Expected: zero drift.

- [ ] **Step 6: Manual smoke test in dev (optional but recommended)**

Open `pnpm dev`. Verify in the browser:
- Loan list page renders with balance values populated.
- Loan detail page shows outstanding balance.
- Recording a payment updates the loan list and detail balance within ~1s, no page reload.
- Network tab: `/api/electric/loan_balances` shape returns rows; `/api/electric/loans` shape returns rows; no `listLoansWithOverdueAction` calls in the Network tab (it's been removed).

- [ ] **Step 7: Final commit if any docs/comments need cleanup**

If any TODOs were left in the code, address them now. Otherwise the plan is complete.

---

## Out of scope (intentional)

- Migrating `dashboardCollection`, `dailyCollectionsCollection`, `loanStatusCountsCollection`, `locationBalancesCollection`, `creditor-extras` to projection tables. Same pattern, separate plans.
- Plan A (`live=true` ShapeStream optimization). Skipped per design decisions; the savings dissolve as more collections become projections.
- Branch-level WHERE-injection in the Electric proxy. Defer until a real authorization requirement materializes.
- Replacing `subscribeToTableChanges` entirely. Most calls remain because they invalidate non-projection collections (`dashboard`, `reports`, `locationBalances`).

## Rollback strategy

Each phase commits independently. To roll back:

- Phases 5, 6, 7 are pure deletions — `git revert <commit>` is safe.
- Phase 4 (the bundled commit) — `git revert` reintroduces the old shape; the projection tables remain in the DB but become unused. Safe.
- Phases 1, 2, 3 — `git revert`, then either drop the projection table (`DROP TABLE loan_balances; DROP FUNCTION refresh_loan_balance, on_transactions_change_for_loan_balance, on_payments_change_for_loan_balance;`) or leave it harmlessly in place.
