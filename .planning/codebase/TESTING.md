# Testing

**Last Updated:** 2026-03-22

## Current State

Testing infrastructure is fully operational with three tiers: unit tests, integration tests, and E2E tests.

### Test Counts (as of 2026-03-22)

| Tier | Framework | Files | Tests | Status |
|------|-----------|-------|-------|--------|
| Unit | Vitest | 6 | 97 | All passing |
| Integration | Vitest + Neon test DB | 5 | 60 | All passing |
| E2E | Cypress | ~19 | ~95 | Passing |

### Scripts

```json
{
  "test": "vitest run",
  "test:integration": "vitest run --config vitest.integration.config.ts",
  "test:watch": "vitest",
  "test:e2e": "CYPRESS=true DATABASE_URL=$DATABASE_URL_TEST next dev -p 3001 & sleep 5 && cypress run; kill %1 2>/dev/null",
  "test:e2e:open": "CYPRESS=true DATABASE_URL=$DATABASE_URL_TEST next dev -p 3001 & cypress open; kill %1 2>/dev/null"
}
```

## Architecture

### Unit Tests (`vitest.config.ts`)

- **Location:** `src/services/__tests__/*.test.ts`, `src/lib/interest/__tests__/*.test.ts`
- **DB:** Mocked via `vi.mock("@/lib/db")`
- **Excludes:** `src/services/__integration__/**` (handled by separate config)
- **Speed:** ~1 second total

Key files:
- `engine.test.ts` — Interest calculation, allocation, days overdue (18 tests, A-rated)
- `customer.service.test.ts` — CRUD + Effect error channels (mocked DB)
- `loan.service.test.ts` — Creation, collateral, audit, blacklist validation (mocked DB)
- `payment.service.test.ts` — Record/edit/delete, status transitions, cascades (mocked DB)
- `creditor.service.test.ts` — CRUD, investments, repayments, dashboard, system capital (mocked DB)
- `report.service.test.ts` — P&L math, balance sheet identity, portfolio risk flags, snapshot idempotency (mocked DB)

### Integration Tests (`vitest.integration.config.ts`)

- **Location:** `src/services/__integration__/*.test.ts`
- **DB:** Real Neon test database (`DATABASE_URL_TEST_UNPOOLED`)
- **Setup:** `src/services/__integration__/setup.ts`
- **Config:** Sequential execution (`fileParallelism: false`), 30s timeout, `CYPRESS=true` env
- **Speed:** ~6 minutes (network-bound to Neon)

Key files:
- `customer.service.test.ts` — Full CRUD, search, pagination, status change + audit log (7 tests)
- `loan.service.test.ts` — Creation, collateral, audit, blacklist/incomplete blocking (10 tests)
- `payment.service.test.ts` — Record/edit/delete with recalculation cascades, status transitions (14 tests)
- `creditor.service.test.ts` — CRUD, investments, repayments, dashboard, system capital (16 tests)
- `report.service.test.ts` — P&L queries, portfolio, balance sheet, snapshots (9 tests)

### E2E Tests (Cypress)

- **Location:** `cypress/e2e/*.cy.ts`
- **Config:** `cypress.config.ts`
- **DB:** Test database via `CYPRESS=true` env (bypasses email verification)
- **Coverage:** Registration, auth, customer CRUD, loan wizard, payments, admin panel, dashboard, creditors, reports, notifications, etc.

## Test DB Infrastructure

### resetDb() — Hardcoded TRUNCATE

The `setup.ts` file uses a hardcoded `TRUNCATE TABLE ... CASCADE` of all 17 known tables. This replaced a dynamic PL/pgSQL approach that deadlocked on Neon's connection routing.

```sql
TRUNCATE TABLE
  transactions, transaction_categories, financial_snapshots,
  creditor_repayments, creditor_investments, creditors,
  payments, collateral, loans, audit_log, notifications,
  customers, system_settings, verification, account, session, "user"
CASCADE
```

**When adding new tables:** Update the TRUNCATE list in `src/services/__integration__/setup.ts`.

### seedCategories()

Seeds default transaction categories (`Interest Earned`, `Interest Payments`, `Share Capital`) needed by payment and creditor auto-posting flows. Called in `beforeEach` for integration tests that exercise payment/creditor services.

## Mocking Strategy

- **Database (unit tests):** `vi.mock("@/lib/db")` — mock `db.select`, `db.insert`, `db.update`, `db.transaction`
- **Services (unit tests):** `vi.mock("@/services/audit.service")`, `vi.mock("@/services/transaction.service")` for isolating service under test
- **Database (integration tests):** Real Neon test DB with unpooled connection (`max: 1` to prevent search_path issues)
- **Auth (E2E):** `CYPRESS=true` bypasses email verification

## Known Constraints

- Integration tests are slow (~6 min) due to Neon network latency — consider PGlite for local speed
- Default `vitest run` only runs unit tests; use `--config vitest.integration.config.ts` for integration
- Neon cold starts can cause occasional first-test timeouts (30s timeout configured)

---

*Updated: 2026-03-22*
