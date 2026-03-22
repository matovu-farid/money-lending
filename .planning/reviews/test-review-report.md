# Vitest Test Review Report

**Reviewer**: test-reviewer (QA Review Team)
**Date**: 2026-03-21
**Scope**: All Vitest unit and service tests

---

## Executive Summary

The test suite covers **7 test files** with a mix of passing unit tests and `.todo` placeholders. The **interest engine** (`src/lib/interest/__tests__/engine.test.ts`) is the strongest tested module with thorough pure-function coverage. Service tests are largely **export-existence checks** and **type-shape validations** rather than behavioral tests. All DB-dependent logic is deferred to `.todo` stubs. **6 services have zero test files**: transaction, watchlist, dashboard, audit, notification, and category.

### Scorecard

| File | Passing Tests | .todo Stubs | Quality Rating |
|------|:---:|:---:|:---:|
| `engine.test.ts` (lib) | 18 | 0 | **A** — Excellent |
| `report.service.test.ts` | 10 | 5 | **C+** — Mixed |
| `creditor.service.test.ts` | 14 | 14 | **C** — Shallow |
| `payment.service.test.ts` | 9 | 9 | **D** — Very shallow |
| `loan.service.test.ts` | 4 | 3 | **D** — Minimal |
| `customer.service.test.ts` | 2 | 2 | **D** — Minimal |
| `interest-engine.test.ts` (src) | 0 | 6 | **F** — All stubs |

---

## Per-File Analysis

### 1. `src/lib/interest/__tests__/engine.test.ts` — Rating: A

**Coverage**: Excellent. Tests all 6 exported functions: `calculateInterest`, `calculateDailyRate`, `calculateLoanSummary`, `calculateDaysOverdue`, `formatAmount`, `allocatePayment`.

**Strengths**:
- 12 tests for `calculateInterest` and `allocatePayment` (the two most critical functions)
- Tests cover: basic calculation, pro-rated days, minimum period enforcement, custom minimum period override
- `allocatePayment` tests cover: payment < interest, payment > interest, payment exceeds total, min period enforcement, any-amount acceptance (1.00), custom minInterestDays
- BigNumber precision is validated throughout (`.toFixed(2)`)
- Requirement traceability: tests reference LOAN-03, LOAN-08, LOAN-09, LOAN-10, LOAN-11, RISK-01

**Missing edge cases**:
- Zero principal balance (what happens if `allocatePayment` receives `"0"` principal?)
- Zero days elapsed with zero minInterestDays (0/30 * 0 = 0 interest edge)
- Negative values (negative payment amount, negative rate — should these be rejected?)
- Very large numbers (overflow boundary testing with BigNumber)
- `calculateDaysOverdue` with zero daily rate (division by zero — the function doesn't guard against this)
- `formatAmount` with `NaN` or negative BigNumber

**Quality issues**: None significant. This is the gold standard file in the suite.

---

### 2. `src/services/__tests__/report.service.test.ts` — Rating: C+

**Coverage**: Partial. Tests P&L aggregation math, balance sheet identity, portfolio risk flags, and export existence.

**Strengths**:
- P&L aggregation math tested with meaningful BigNumber assertions (lines 22-73)
- Balance sheet identity `A = L + E` tested correctly, including imbalance detection (lines 79-112)
- Portfolio risk flag logic tested with 3 scenarios using real engine functions (lines 118-201)
- Requirement traceability: RPTS-02, RPTS-03, RPTS-04

**Critical weakness**: Tests re-implement service logic inline rather than calling actual service functions. The P&L test (lines 32-53) manually creates `incomeRows`/`expenseRows` and reduces them — it never calls `getPnlData()`. This means:
- The actual `getPnlData` query logic is untested
- The `getBalanceSheetData` function is untested
- The `getPortfolioData` function is untested
- `generateMonthlySnapshot` is untested

**Export checks** (lines 207-239): Only verify functions exist, not behavior.

**5 `.todo` stubs** document the DB-dependent tests that are missing.

**Missing**:
- No test for `getPortfolioData` sorting (descending by daysOverdue)
- No test for `getBalanceSheetData` date parsing (supports "YYYY-MM" and "YYYY-MM-DD")
- No test for `generateMonthlySnapshot` idempotency with real data
- No test for error channel (`DatabaseError` propagation)

---

### 3. `src/services/__tests__/creditor.service.test.ts` — Rating: C

**Coverage**: 8 export checks + 6 math/allocation tests using engine functions + type shape tests. 14 `.todo` stubs.

**Strengths**:
- Interest accrual math tested for minInterestDays=0 scenario (creditor-specific behavior) — lines 68-97
- Repayment allocation tested with 3 scenarios (payment < interest, payment > interest, fully repaid) — lines 99-151
- Type shape tests verify TS interfaces compile correctly (lines 153-203)
- Good differentiation between creditor (minInterestDays=0) and borrower (minInterestDays=30)

**Weaknesses**:
- All 8 export checks (lines 18-66) only verify `typeof === "function"` — zero behavioral testing
- No service function is actually called; all math tests use `calculateInterest`/`allocatePayment` directly
- `getCreditorDashboard` is not tested at all (complex aggregation logic)
- `getSystemCapital` is not tested at all (critical for balance sheet)
- `daysBetween` helper is private but untested through public API
- No error channel testing (CreditorNotFound, InvestmentNotFound, DatabaseError)

**14 `.todo` stubs** document all DB-dependent gaps.

---

### 4. `src/services/__tests__/payment.service.test.ts` — Rating: D

**Coverage**: 9 tests, all are export checks or type shape validations. Zero behavioral tests.

**Strengths**:
- Verifies `autoPostInterestEarned` import exists and has correct arity (2 params) — FINC-01 wiring check
- Type shape tests for `RecordPaymentInput`, `EditPaymentInput`, `DeletePaymentInput` verify required fields
- `EditPaymentInput` and `DeletePaymentInput` correctly assert `reason` field exists (audit requirement)

**Critical weaknesses**:
- `recordPayment` — the most complex function (interest-first allocation, status transitions, audit log, auto-posting) — is NOT tested at all
- `editPayment` — cascade recalculation logic — NOT tested
- `deletePayment` — soft-delete logic, cascade recalculation — NOT tested
- `getPaymentsForLoan` — NOT tested
- `recalculateFromPayment` (private helper) — NOT tested through public API
- No error channel testing (LoanNotFound, PaymentNotFound)
- No test for status transitions: pending -> active, active -> fully_paid, fully_paid -> active (edit reversal)

**9 `.todo` stubs** document gaps.

---

### 5. `src/services/__tests__/loan.service.test.ts` — Rating: D

**Coverage**: 4 tests — type shape checks and export existence. Zero behavioral tests.

**Strengths**:
- Correctly asserts no `termDays` field (perpetual loan model — LOAN-02)
- Verifies collateral `nature` field is required

**Critical weaknesses**:
- `createLoan` — atomic transaction with collateral, customer validation, blacklist check, audit log — NOT tested
- `getLoan` — Effect.flatMap error handling — NOT tested
- `listLoans` — NOT tested
- `checkCustomerCompleteness` (private) — NOT tested through public API
- No test for blacklisted customer rejection (CUST-06)
- No test for incomplete customer requirements (CUST-04)
- No error channel testing (CustomerNotFound, IncompleteLoanRequirements, DatabaseError)

**3 `.todo` stubs** document gaps.

---

### 6. `src/services/__tests__/customer.service.test.ts` — Rating: D

**Coverage**: 2 tests — export existence only.

**Weaknesses**:
- Only checks 4 functions exist: `createCustomer`, `getCustomer`, `updateCustomer`, `listCustomers`
- Missing: `searchCustomers` (complex — has daysRemainingFilter with in-process calculation)
- Missing: `changeCustomerStatus` (blacklisting with audit log)
- No type shape tests
- No error channel testing (CustomerNotFound)

**2 `.todo` stubs**.

---

### 7. `src/__tests__/interest-engine.test.ts` — Rating: F

**Coverage**: Zero. All 6 tests are `.todo` stubs.

**Note**: This file duplicates intent already covered by `src/lib/interest/__tests__/engine.test.ts`. It appears to be an earlier placeholder that was superseded. **Recommendation**: Delete this file to avoid confusion, or merge any unique test ideas into the canonical engine test file.

---

## Services With NO Test Files

| Service | Public Functions | Complexity | Priority |
|---------|-----------------|------------|----------|
| `transaction.service.ts` | `recordExpense`, `recordIncome`, `listTransactions`, `getTransactionById`, `deleteTransaction`, `autoPostInterestEarned`, `autoPostInterestExpense` | Medium | **High** — Financial ledger integrity |
| `watchlist.service.ts` | `getWatchlistData` | Medium | **High** — Risk management (RISK-01, RISK-02) |
| `dashboard.service.ts` | `getDashboardKPIs`, `getRecentActivity` | Medium | **Medium** — Aggregation correctness |
| `category.service.ts` | `seedDefaultCategories`, `listCategories`, `createCategory`, `deleteCategory`, `getCategoryByName` | Low | **Medium** — FINC-02 category management |
| `audit.service.ts` | `writeAuditLog` | Low | **Low** — Simple insert, tested indirectly |
| `notification.service.ts` | `getNotifications`, `getUnreadCount`, `markAsRead`, `markAllAsRead`, `createNotificationsForLoan` | Low | **Low** — CRUD with dedup |

---

## Cross-Cutting Quality Issues

### 1. Export-Check Anti-Pattern (HIGH)
Most service tests only verify `typeof mod.functionName === "function"`. This catches import errors but provides **zero confidence** in behavior. These tests would pass even if every function returned `undefined`.

### 2. Re-implemented Logic Instead of Calling Services (MEDIUM)
`report.service.test.ts` manually reduces arrays with BigNumber instead of calling `getPnlData()`. If the service logic changes, these tests won't catch regressions.

### 3. No Effect Error Channel Testing (HIGH)
Every service uses `Effect.tryPromise` with typed error channels (e.g., `Effect.Effect<Loan, LoanNotFound | DatabaseError>`). Zero tests verify that errors are correctly typed or that `Effect.fail` paths work. Example: no test confirms `getCustomer("nonexistent-id")` yields `CustomerNotFound`.

### 4. No DB Mocking Strategy (MEDIUM)
All DB-interactive tests are `.todo`. The codebase uses Drizzle ORM — a viable approach would be:
- In-memory SQLite for unit tests (Drizzle supports it)
- Or: mock the `db` object at the module level using `vi.mock`

### 5. `.todo` Count: 39 total
Across all files, 39 tests are `.todo` stubs. This is useful documentation but represents unfulfilled testing intent.

### 6. Zero BigNumber Edge Case Testing (LOW)
No test validates behavior with: `"0"`, `"-1"`, `""`, `"NaN"`, extremely large values, or non-numeric strings passed to engine functions.

### 7. `calculateDaysOverdue` Division by Zero (HIGH — Bug Risk)
The engine function `calculateDaysOverdue` does `unpaidInterest.dividedBy(currentDailyRate)` without guarding against `currentDailyRate === "0"`. If a loan has a 0% rate, this returns `Infinity`. No test covers this.

---

## Missing Test Coverage by Feature Area

### Loan Lifecycle (LOAN-01 through LOAN-11)
- **Tested**: Interest calculation (LOAN-03), allocation (LOAN-08, LOAN-09, LOAN-10, LOAN-11), perpetual model (LOAN-02)
- **Untested**: Loan creation (LOAN-01), payment recording flow (LOAN-06), edit/delete cascade (LOAN-07), status transitions (LOAN-05)

### Customer Management (CUST-01 through CUST-06)
- **Tested**: None behaviorally
- **Untested**: CRUD operations, search with daysRemainingFilter, blacklist safeguard (CUST-06), completeness check (CUST-04)

### Creditor System (CRED-01 through CRED-06)
- **Tested**: Interest math with minInterestDays=0 (CRED-03), allocation (CRED-04)
- **Untested**: CRUD (CRED-01), investment management (CRED-02), dashboard aggregation (CRED-05), system capital (CRED-06)

### Financial Controls (FINC-01, FINC-02)
- **Tested**: `autoPostInterestEarned` exists (import check only)
- **Untested**: Auto-posting behavior, transaction CRUD, category management

### Reporting (RPTS-01 through RPTS-04)
- **Tested**: P&L math (re-implemented, not calling service), balance sheet identity, risk flags
- **Untested**: Actual service function calls, snapshot generation, report data queries

### Risk/Watchlist (RISK-01, RISK-02)
- **Tested**: `calculateDaysOverdue` (in engine tests)
- **Untested**: `getWatchlistData` service, 30-day threshold filtering

---

## Recommendations

1. **Prioritize `payment.service` behavioral tests** — ~~This is the most complex service with cascade recalculation, status transitions, and auto-posting. A bug here silently corrupts financial data.~~ **RESOLVED (2026-03-22):** Full integration tests added in `src/services/__integration__/payment.service.test.ts` — 14 tests covering recordPayment, editPayment (with cascade recalculation), deletePayment (soft-delete + cascade), getPaymentsForLoan, and status transitions (pending→active, active→fully_paid, fully_paid→active reversal).

2. **Add Effect error channel tests** — ~~At minimum, test that `Effect.runPromise(getCustomer("bad-id"))` rejects with `CustomerNotFound._tag`.~~ **RESOLVED (2026-03-22):** Integration tests cover CustomerNotFound, LoanNotFound, CreditorNotFound, InvestmentNotFound, IncompleteLoanRequirements, and PaymentNotFound error channels.

3. **Replace export-check tests** with at least one behavioral test per function (even if mocked). — **PARTIALLY RESOLVED:** Unit tests now include DB-mocked behavioral tests (recordPayment, editPayment, deletePayment, createLoan, createCreditor, etc.). Integration tests provide full behavioral coverage.

4. **Guard `calculateDaysOverdue` against zero rate** — Add a check and a test for the division-by-zero case. — **OPEN**

5. **Delete `src/__tests__/interest-engine.test.ts`** — ~~It's a dead placeholder duplicating the real engine test file.~~ **RESOLVED (2026-03-22):** File deleted.

6. **Add test files for**: `transaction.service`, `watchlist.service`, `dashboard.service`, `category.service`. — **OPEN** (these services are tested indirectly via integration tests that exercise auto-posting and category seeding, but have no dedicated test files)

7. **Establish a DB mocking pattern** — ~~Either in-memory SQLite or Drizzle mock layer — to unblock the 39 `.todo` tests.~~ **RESOLVED (2026-03-22):** Two approaches now in use: (a) `vi.mock("@/lib/db")` with mock chainable return values for unit tests, (b) real Neon test DB via `vitest.integration.config.ts` for integration tests. The 39 `.todo` stubs have been replaced by 60 passing integration tests.

---

## Addendum: 2026-03-22 Update

### Test Infrastructure Fixes

1. **resetDb() deadlock fix:** Replaced dynamic PL/pgSQL `DO $$ ... pg_tables ... $$` with hardcoded `TRUNCATE TABLE ... CASCADE` listing all 17 tables. The dynamic approach occasionally deadlocked on Neon's connection routing.

2. **Vitest config separation:** Added `exclude: ["src/services/__integration__/**"]` to `vitest.config.ts` so `vitest run` doesn't accidentally run integration tests without setup/env.

3. **Report portfolio assertion fix:** `toBeLessThan(1000000)` → `toBeLessThanOrEqual(1000000)` — a 100k payment on a 1M loan at 10%/month after 30 days covers exactly interest, leaving principal at 1M.

### Current Test Results

- **Unit tests:** 97/97 passing (6 files, <1s)
- **Integration tests:** 60/60 passing (5 files, ~6 min)
- **Total:** 157/157 passing
