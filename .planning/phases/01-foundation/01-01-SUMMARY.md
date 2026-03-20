---
phase: 01-foundation
plan: 01
subsystem: database
tags: [drizzle-orm, postgresql, effect, bignumber, vitest, shadcn, better-auth]

# Dependency graph
requires: []
provides:
  - "PostgreSQL schema: customers, loans, collateral, payments, audit_log, system_settings tables"
  - "Drizzle ORM db instance connected to PostgreSQL"
  - "Effect.js tagged error types for service layer"
  - "Shared TypeScript types inferred from schema (Customer, Loan, Collateral, Payment, etc.)"
  - "Vitest configured with path alias @ -> ./src"
  - "Wave 0 test stubs for interest engine, customer service, and loan service"
  - "shadcn/ui initialized with Tailwind v4 / new-york style"
  - ".env.example documenting all required environment variables"
  - "drizzle.config.ts for schema migrations"
affects: [02, 03, 04, 05, 06, 07]

# Tech tracking
tech-stack:
  added:
    - "better-auth@1.5.5 — auth, sessions, RBAC"
    - "drizzle-orm@0.45.1 — PostgreSQL ORM with type-safe schema"
    - "drizzle-kit@0.31.10 — schema migrations (generate/migrate/push)"
    - "postgres@3.4.8 — PostgreSQL driver (Promise-native)"
    - "effect@3.21.0 — service layer typed errors"
    - "bignumber.js@10.0.2 — financial arithmetic (no native float)"
    - "vitest@4.1.0 — unit test framework"
    - "@vitejs/plugin-react@6.0.1 — React support for Vitest"
    - "@testing-library/react@16.3.2 — React component testing"
    - "@testing-library/user-event@14.6.1 — user interaction simulation"
    - "shadcn/ui CLI@4.1.0 — copy-paste components (Radix UI + Tailwind v4, new-york style)"
  patterns:
    - "NUMERIC(15,2) for all monetary columns — no mode:'number' — Drizzle returns strings"
    - "Effect.js Data.TaggedError for typed service layer errors"
    - "Perpetual loan model — no term_days, no due_date, payment table is rate-period source of truth"
    - "Separate collateral table with loanId FK (not inline columns on loans)"
    - "Wave 0 test stubs committed before implementation to establish test infrastructure"

key-files:
  created:
    - "src/lib/db/index.ts — Drizzle db instance"
    - "src/lib/db/schema/customers.ts — customers table + customerStatusEnum"
    - "src/lib/db/schema/loans.ts — loans table + loanStatusEnum (pending/active/fully_paid)"
    - "src/lib/db/schema/collateral.ts — separate collateral table with loanId FK"
    - "src/lib/db/schema/payments.ts — payments table as rate-period source of truth"
    - "src/lib/db/schema/audit.ts — audit_log table for financial mutation tracking"
    - "src/lib/db/schema/settings.ts — system_settings table"
    - "src/lib/db/schema/index.ts — barrel export from all 6 schema files"
    - "src/lib/errors.ts — Effect.js tagged error types"
    - "src/types/index.ts — shared TypeScript types inferred from schema"
    - "src/lib/interest/__tests__/engine.test.ts — Wave 0 stubs"
    - "src/services/__tests__/customer.service.test.ts — Wave 0 stubs"
    - "src/services/__tests__/loan.service.test.ts — Wave 0 stubs"
    - "vitest.config.ts — Vitest with @ path alias"
    - "drizzle.config.ts — Drizzle migrations config"
    - ".env.example — all required environment variables documented"
  modified:
    - "package.json — added dependencies + test/db scripts"
    - ".gitignore — allow .env.example while keeping .env excluded"
    - ".env — added BUSINESS_TIMEZONE=Africa/Kampala"
    - "src/app/globals.css — shadcn/ui CSS variables added"

key-decisions:
  - "No Zod installed — Server Actions use TypeScript types; only Better Auth catch-all route handler needs Zod-level validation"
  - "Loan statuses simplified to 3 (pending/active/fully_paid) — perpetual loans use watchlist formula for at-risk detection, not 'defaulted' status"
  - "INFR-06 Layer deferral — services return Effect<S,E,never> with db closed over module scope in Phase 1; full Context.Tag/Layer wiring deferred to Phase 2"
  - "Collateral is a separate table (not inline columns on loans) — enables future multi-item collateral without schema change"

patterns-established:
  - "Pattern: All monetary columns use numeric({ precision: 15, scale: 2 }) — never mode:'number'"
  - "Pattern: Drizzle returns NUMERIC columns as strings — always wrap in new BigNumber(value) before arithmetic"
  - "Pattern: Payment table is the rate-period source of truth — principal_balance_before/after govern interest calculation periods"
  - "Pattern: Effect.js Data.TaggedError used for all service layer error types — never untyped throws"

requirements-completed: [INFR-01, INFR-05, INFR-06]

# Metrics
duration: 5min
completed: 2026-03-20
---

# Phase 01 Plan 01: Foundation Infrastructure Summary

**Drizzle ORM schema with 6 PostgreSQL tables (perpetual loan model, separate collateral table, payment-as-rate-period), Effect.js error types, Vitest with path aliases, and shadcn/ui initialized**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-20T10:35:39Z
- **Completed:** 2026-03-20T10:40:38Z
- **Tasks:** 2
- **Files modified:** 18

## Accomplishments

- Complete 6-table PostgreSQL schema with all NUMERIC(15,2) monetary columns, perpetual loan model (no term_days/due_date), and separate collateral table
- Payment table defined as rate-period source of truth with principal_balance_before/after columns per the Loan Ledger Model
- All Phase 1 npm dependencies installed (no Zod — Server Actions use TypeScript types)
- Vitest configured with path alias; all 13 Wave 0 test stubs running successfully
- Effect.js tagged error types and shared TypeScript types inferred from schema

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies, configure Vitest, create env files** - `083b129` (chore)
2. **Task 2: Define schema, error types, shared types, Wave 0 stubs** - `0f1385e` (feat)

**Plan metadata:** _(added after state update)_

## Files Created/Modified

- `src/lib/db/schema/customers.ts` — customers table with customerStatusEnum
- `src/lib/db/schema/loans.ts` — loans table (pending/active/fully_paid); no term_days, no collateral columns
- `src/lib/db/schema/collateral.ts` — separate collateral table with loanId FK
- `src/lib/db/schema/payments.ts` — payment table as rate-period source of truth (principal_balance_before/after)
- `src/lib/db/schema/audit.ts` — audit_log table for financial mutation tracking
- `src/lib/db/schema/settings.ts` — system_settings for admin overrides
- `src/lib/db/schema/index.ts` — barrel export from all 6 schema files
- `src/lib/db/index.ts` — Drizzle db instance connected via postgres driver
- `src/lib/errors.ts` — 8 Effect.js tagged error types
- `src/types/index.ts` — shared TypeScript types including Collateral, Payment, ROLE_LEVELS
- `src/lib/interest/__tests__/engine.test.ts` — 5 Wave 0 stubs
- `src/services/__tests__/customer.service.test.ts` — 4 Wave 0 stubs
- `src/services/__tests__/loan.service.test.ts` — 4 Wave 0 stubs
- `vitest.config.ts` — Vitest config with @ path alias
- `drizzle.config.ts` — Drizzle migrations targeting src/lib/db/schema/index.ts
- `.env.example` — DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, BUSINESS_TIMEZONE
- `package.json` — dependencies + test/db:* scripts added
- `.gitignore` — allow .env.example, keep .env excluded

## Decisions Made

- No Zod installed. Server Actions use TypeScript for type safety; the only Route Handler (Better Auth catch-all) handles its own validation. This aligns with the project's Server Action architecture.
- INFR-06 Layer deferral already documented in 01-CONTEXT.md decisions section before this plan executed.
- VALIDATION.md test paths already aligned with actual plan structure (src/lib/interest/__tests__, src/services/__tests__).

## Deviations from Plan

**1. [Rule 3 - Blocking] Updated .gitignore to allow .env.example**
- **Found during:** Task 1 (env files)
- **Issue:** .gitignore had `.env*` which blocked committing .env.example (a template file with no secrets)
- **Fix:** Added `!.env.example` exception to .gitignore
- **Files modified:** .gitignore
- **Verification:** git add .env.example succeeded
- **Committed in:** 083b129 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking)
**Impact on plan:** Necessary fix to allow documenting required environment variables. No scope creep.

## Issues Encountered

None — all planned work executed as specified.

## User Setup Required

None — no external service configuration required beyond what's already in .env.

## Next Phase Readiness

- Database schema is the single source of truth for all downstream Phase 1 plans
- Vitest infrastructure ready for Plan 01-02 (Interest Engine) and Plan 01-04/05 (services)
- Wave 0 test stubs establish test file locations that VALIDATION.md references
- Drizzle config ready for `pnpm db:generate` once Better Auth schema is generated (Plan 01-03)
- Effect.js error types ready to import in all service layer functions (Plans 01-04, 01-05)

## Self-Check: PASSED

All 16 expected files found. Both task commits verified (083b129, 0f1385e). Final metadata commit: 85ddf4c.

---
*Phase: 01-foundation*
*Completed: 2026-03-20*
