---
phase: 01-foundation
verified: 2026-03-20T20:15:00Z
status: gaps_found
score: 18/22 must-haves verified
gaps:
  - truth: "Vitest runs and passes -- service module tests fail with ERR_INVALID_URL in test environment"
    status: failed
    reason: "src/lib/db/index.ts calls new URL(process.env.DATABASE_URL!) at module-load time. When tests import customer.service or loan.service, the db module is instantiated without DATABASE_URL set, throwing ERR_INVALID_URL. The customer and loan service test files each have one real test that performs a module import, causing it to fail. 2 tests fail; interest engine tests all pass."
    artifacts:
      - path: "src/lib/db/index.ts"
        issue: "new URL(connectionString) executed at module scope — crashes when DATABASE_URL is undefined at test time"
      - path: "src/services/__tests__/customer.service.test.ts"
        issue: "Test 'createCustomer returns an Effect (type check)' fails: dynamic import of @/services/customer.service triggers db/index.ts URL parse"
      - path: "src/services/__tests__/loan.service.test.ts"
        issue: "Test 'loan service exports expected functions' fails: same root cause"
    missing:
      - "Guard the URL parse in db/index.ts so it does not throw when DATABASE_URL is undefined (e.g. use optional chaining: const url = connectionString ? new URL(connectionString) : null) or move search_path extraction to connection-time rather than module-load time"
  - truth: "LOAN-05 lifecycle matches REQUIREMENTS.md specification (Pending → Active → Partially Paid → Fully Paid → Defaulted)"
    status: failed
    reason: "REQUIREMENTS.md defines 5 loan statuses. The schema intentionally implements only 3 (pending, active, fully_paid) per a user decision recorded in project memory. This is a documented scope reduction, not an implementation error, but REQUIREMENTS.md still shows the original 5-status spec as the contract. The requirement is marked Complete in the tracking table while its content says otherwise. This needs explicit reconciliation."
    artifacts:
      - path: "src/lib/db/schema/loans.ts"
        issue: "loanStatusEnum only has ['pending', 'active', 'fully_paid'] — omits 'partially_paid' and 'defaulted'"
    missing:
      - "Either update REQUIREMENTS.md LOAN-05 description to reflect the v1 3-status decision, or add a formal DEVIATION note under LOAN-05 noting the scope reduction and rationale"
  - truth: "AUTH-01 register flow works without email verification gate (plan spec)"
    status: failed
    reason: "Plan 01-03 specified that users register and receive the unassigned role by default — no email verification step was planned. The implemented auth.ts enables requireEmailVerification: true and adds a Resend email integration. The proxy.ts also adds a /verify-email gate. This is an undocumented scope expansion that changes the registration flow from what plan 01-06 describes (register → /pending-approval) to (register → /verify-email → /pending-approval). The verify-email page exists, but neither its plan nor its summary was written. Human verification of this flow is required."
    artifacts:
      - path: "src/lib/auth.ts"
        issue: "requireEmailVerification: true and emailVerification Resend hook not specified in any plan"
      - path: "src/proxy.ts"
        issue: "/verify-email added to AUTH_PAGES and email verification check added — deviates from plan 01-03 spec"
    missing:
      - "Document the email verification addition as an explicit scope change in a plan or CONTEXT.md decision"
      - "Ensure RESEND_API_KEY and EMAIL_FROM are added to .env.example (currently absent)"
human_verification:
  - test: "Register first user and verify superAdmin promotion"
    expected: "First registered user (after email verification if required) lands on /dashboard, not /pending-approval, and has superAdmin role in Better Auth admin panel"
    why_human: "First-user databaseHook runs server-side; cannot verify count query + role update without a live database"
  - test: "Verify email verification flow"
    expected: "After registration, user is redirected to /verify-email. After clicking verification link, user can log in. Unverified users are redirected to /verify-email by proxy.ts. Verified unassigned users land on /pending-approval."
    why_human: "Flow involves email delivery, URL tokens, and proxy redirect chains that cannot be traced statically"
  - test: "Interest math correctness in loan wizard"
    expected: "Entering 1,000,000 UGX at 10%/month in Step 1 shows: Daily interest = 3,333.33 UGX; Total interest at min period = 100,000.00 UGX; Total owed = 1,100,000.00 UGX in Step 3 Review"
    why_human: "calculateLoanSummary uses parseFloat(interestRateDisplay)/100 conversion in the page — need to verify the display math is correct end-to-end"
  - test: "Admin role dropdown hierarchy enforcement"
    expected: "Admin user sees only [unassigned, loanOfficer] in role dropdown. SuperAdmin sees [unassigned, loanOfficer, admin]. Neither can assign roles at or above their own level."
    why_human: "Session-based role filtering requires a live multi-user auth scenario"
  - test: "Loan issuance blocks incomplete customer (CUST-04)"
    expected: "Attempting to issue a loan for a customer missing contact or address shows 'Missing fields: contact, address' error"
    why_human: "Requires database with a partial customer record"
---

# Phase 01: Foundation Verification Report

**Phase Goal:** The schema, authentication, and loan calculation engine are correct and production-safe before any financial data is written
**Verified:** 2026-03-20T20:15:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All monetary columns use NUMERIC(15,2) — no mode:number | VERIFIED | loans.ts: `numeric("principal_amount", { precision: 15, scale: 2 })`, payments.ts: same for all 5 monetary columns. Grep confirms no `mode: 'number'` in any schema file. |
| 2 | Drizzle can connect to PostgreSQL; db instance exported | VERIFIED | src/lib/db/index.ts exports `db` via `drizzle(client, { schema })`. Connection wiring is correct; runtime depends on DATABASE_URL. |
| 3 | Effect.js error types defined and exported | VERIFIED | src/lib/errors.ts: 8 tagged error classes (DatabaseError, CustomerNotFound, LoanNotFound, ValidationError, IncompleteLoanRequirements, UnauthorizedError, ForbiddenError, DuplicateError) |
| 4 | Vitest runs and passes with path aliases | PARTIAL | Interest engine: 12/12 tests PASS. Customer service: 1/2 fail (ERR_INVALID_URL from db module load). Loan service: 1/4 fail (same root cause). 2 test failures block "all tests pass". |
| 5 | .env.example documents required environment variables | PARTIAL | Contains DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, BUSINESS_TIMEZONE. Missing RESEND_API_KEY and EMAIL_FROM which are now required by auth.ts email verification. |
| 6 | INFR-06 Layer deferral formally documented | VERIFIED | 01-CONTEXT.md line 129: "Effect Service Layer Injection (INFR-06 Deferral)" section present |
| 7 | Wave 0 test stubs exist for interest engine, customer service, loan service | VERIFIED | All 3 files exist with real tests replacing stubs. engine.test.ts has 12 passing tests. |
| 8 | Loan table has NO term_days or due_date columns | VERIFIED | loans.ts: no term_days, no due_date columns. Grep confirms absence. |
| 9 | Payment table has principal_balance_before and principal_balance_after | VERIFIED | payments.ts: both columns present as NUMERIC(15,2) |
| 10 | Collateral is a separate table with loanId FK | VERIFIED | collateral.ts exists with loan_id FK referencing loans.id, nature, description |
| 11 | calculateInterest returns correct reducing-balance interest | VERIFIED | Tests pass: 500000 at 10%/month for 30 days = 50000.00; minimum period enforced |
| 12 | All arithmetic uses BigNumber — no native float on money | VERIFIED | engine.ts uses .multipliedBy(), .dividedBy(), .plus(), .minus() throughout. No bare arithmetic operators on monetary values. |
| 13 | calculateLoanSummary does NOT reference termDays or dueDate | VERIFIED | engine.ts test explicitly asserts `"termDays" in result === false` and `"dueDate" in result === false`. Test passes. |
| 14 | calculateDaysOverdue returns correct days overdue | VERIFIED | 3 tests cover zero, partial, and full unpaid scenarios — all pass |
| 15 | Users register with email+password and get unassigned role by default | VERIFIED | auth.ts: `emailAndPassword: { enabled: true }`, `defaultRole: "unassigned"`. First-user hook promotes to superAdmin. |
| 16 | First registered user auto-promoted to superAdmin | VERIFIED | auth.ts databaseHooks.user.create.after: counts users via SQL, updates role to superAdmin when count === 1 |
| 17 | proxy.ts uses auth.api.getSession (full session validation) | VERIFIED | proxy.ts line 8: `auth.api.getSession({ headers: request.headers })`. Checks role and emailVerified. |
| 18 | Unassigned users redirected to /pending-approval | VERIFIED | proxy.ts: `if (session.user.role === "unassigned") → redirect /pending-approval` |
| 19 | Role assignment enforces hierarchy (AUTH-05) | VERIFIED | user.actions.ts: `if (targetLevel >= actorLevel) return { error: ... }` and admin-level check |
| 20 | Customer CRUD Service Actions with Effect types | VERIFIED | customer.service.ts: createCustomer, getCustomer, updateCustomer, listCustomers all return Effect types. customer.actions.ts: all 4 Server Actions wired with auth check + Effect.runPromise |
| 21 | Loan creation is atomic: loan + collateral + audit log in one transaction | VERIFIED | loan.service.ts: db.transaction wraps tx.insert(loans), tx.insert(collateral), await writeAuditLog(tx, ...) |
| 22 | LOAN-05 matches requirements spec | FAILED | REQUIREMENTS.md specifies 5 statuses (Pending/Active/Partially Paid/Fully Paid/Defaulted). Schema has 3. Decision is user-approved but requirement text not updated. |

**Score:** 18/22 truths verified (2 failed, 2 partial)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/db/schema/customers.ts` | Customer table with uuid PK | VERIFIED | pgTable("customers"), customerStatusEnum, all columns present |
| `src/lib/db/schema/loans.ts` | Loan table, NUMERIC(15,2), no term_days/due_date | VERIFIED | All monetary columns numeric(15,2), no forbidden columns, 3-status enum |
| `src/lib/db/schema/collateral.ts` | Separate table with loanId FK | VERIFIED | loan_id FK, nature (notNull), description (nullable) |
| `src/lib/db/schema/payments.ts` | Payment table as rate-period source of truth | VERIFIED | principal_balance_before and principal_balance_after present |
| `src/lib/db/schema/audit.ts` | Audit log table | VERIFIED | audit_log with before_value, after_value columns |
| `src/lib/db/schema/settings.ts` | System settings table | VERIFIED | system_settings with key/value/unique key |
| `src/lib/db/schema/index.ts` | Barrel export all 6 + auth schemas | VERIFIED | exports from customers, loans, collateral, payments, audit, settings, auth |
| `src/lib/db/index.ts` | Drizzle db instance | VERIFIED | exports db; search_path extraction added for test isolation (but causes test failures — see gaps) |
| `src/lib/errors.ts` | Tagged Effect error types | VERIFIED | 8 error classes using Data.TaggedError |
| `vitest.config.ts` | Test framework with path aliases | VERIFIED | defineConfig with @ alias pointing to ./src |
| `src/lib/interest/engine.ts` | Pure BigNumber interest functions | VERIFIED | 87 lines, 5 exported functions, all BigNumber arithmetic, 12 tests pass |
| `src/lib/interest/__tests__/engine.test.ts` | 12+ unit tests | VERIFIED | 12 tests, all pass |
| `src/lib/auth.ts` | Better Auth with admin plugin and RBAC | VERIFIED | betterAuth with drizzleAdapter, 4 roles, defaultRole: unassigned, first-user hook |
| `src/lib/auth-client.ts` | Browser auth client | VERIFIED | createAuthClient with adminClient plugin, exports signIn/signUp/signOut/useSession |
| `src/lib/permissions.ts` | 4-role RBAC definitions | VERIFIED | ac, unassignedRole, loanOfficerRole, adminRole, superAdminRole all exported |
| `src/proxy.ts` | Auth gate with full session validation | VERIFIED | auth.api.getSession, role check, emailVerified check, correct redirects |
| `src/app/api/auth/[...all]/route.ts` | Better Auth handler | VERIFIED | toNextJsHandler(auth), exports GET and POST |
| `src/lib/db/schema/auth.ts` | Better Auth generated schema | VERIFIED | user, session, account, verification tables; session table satisfies AUTH-04 |
| `src/actions/user.actions.ts` | Role assignment Server Action | VERIFIED | "use server", assignRole with ROLE_LEVELS hierarchy guard |
| `src/services/customer.service.ts` | Customer CRUD with Effect | VERIFIED | createCustomer, getCustomer, updateCustomer, listCustomers — all Effect.tryPromise |
| `src/services/audit.service.ts` | Audit log plain async helper | VERIFIED | writeAuditLog takes tx, uses tx.insert directly (not Effect) |
| `src/actions/customer.actions.ts` | Customer Server Actions | VERIFIED | "use server", 4 exports, auth checks, Effect.runPromise, no Zod |
| `src/services/loan.service.ts` | Loan service with transaction | VERIFIED | createLoan, getLoan, listLoans; db.transaction wraps loan+collateral+audit |
| `src/actions/loan.actions.ts` | Loan Server Actions | VERIFIED | "use server", createLoanAction with role guard for overrides |
| `src/actions/settings.actions.ts` | Settings Server Actions | VERIFIED | "use server", superAdmin-only updateSettingAction |
| `src/types/index.ts` | All shared TypeScript types | VERIFIED | Customer, Loan, Collateral, Payment, ROLE_LEVELS, CreateCustomerInput, CreateLoanInput, CollateralInput all present |
| `src/components/layout/sidebar.tsx` | Collapsible sidebar with all nav groups | VERIFIED | Dashboard, Operations, Capital, Insights, System groups; disabled items with opacity-50 |
| `src/app/(auth)/login/page.tsx` | Custom login with email+password | VERIFIED | signIn.email(), email+password fields, no username |
| `src/app/pending-approval/page.tsx` | Pending approval page | VERIFIED | "Account Pending Approval" heading, signOut, no AppShell |
| `src/app/(app)/layout.tsx` | Protected route layout with AppShell | VERIFIED | AppShell wraps children |
| `src/app/(app)/loans/new/page.tsx` | 3-step loan wizard with interest preview | VERIFIED | 388 lines, 3 steps, calculateLoanSummary imported, totalInterestAtMinPeriod displayed |
| `src/app/(app)/admin/page.tsx` | Admin page with role management | VERIFIED | ROLE_LEVELS, assignRole, "Last Active" column with createdAt |
| `src/app/(app)/customers/page.tsx` | Customer list with data table | VERIFIED | listCustomersAction, Table, Badge, row click navigates to profile |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `loans.ts` | `customers.ts` | customerId FK | VERIFIED | `uuid("customer_id").references(() => customers.id)` |
| `collateral.ts` | `loans.ts` | loanId FK | VERIFIED | `uuid("loan_id").references(() => loans.id)` |
| `payments.ts` | `loans.ts` | loanId FK | VERIFIED | `uuid("loan_id").references(() => loans.id)` |
| `audit.ts` | entity records | entityType/entityId | VERIFIED | `entity_type` and `entity_id` text columns present |
| `auth.ts` | `db/index.ts` | drizzleAdapter | VERIFIED | `drizzleAdapter(db, { provider: "pg" })` |
| `auth.ts` | `permissions.ts` | ac + roles | VERIFIED | `ac, superAdminRole, adminRole, loanOfficerRole, unassignedRole` passed to admin plugin |
| `proxy.ts` | `auth.ts` | auth.api.getSession | VERIFIED | Line 8: `auth.api.getSession({ headers: request.headers })` |
| `auth/[...all]/route.ts` | `auth.ts` | toNextJsHandler | VERIFIED | `export const { POST, GET } = toNextJsHandler(auth)` |
| `user.actions.ts` | `auth.ts` | auth.api.setRole | VERIFIED | `await auth.api.setRole({ body: { userId, role: targetRole }, headers: await headers() })` |
| `customer.service.ts` | `db/index.ts` | db import | VERIFIED | `import { db } from "@/lib/db"` |
| `customer.actions.ts` | `customer.service.ts` | Effect.runPromise | VERIFIED | `await Effect.runPromise(createCustomer(input))` |
| `customer.actions.ts` | `auth.ts` | getSession via headers() | VERIFIED | `auth.api.getSession({ headers: await headers() })` |
| `loan.service.ts` | `audit.service.ts` | await writeAuditLog(tx,...) | VERIFIED | Direct async call inside tx callback — NOT Effect.runPromise |
| `loan.service.ts` | `loans.ts` | tx.insert(loans) | VERIFIED | `tx.insert(loans).values(...)` in transaction |
| `loan.service.ts` | `collateral.ts` | tx.insert(collateral) | VERIFIED | Separate import: `import { collateral } from "@/lib/db/schema/collateral"` |
| `loan.actions.ts` | `loan.service.ts` | Effect.runPromise(createLoan) | VERIFIED | `Effect.runPromise(createLoan(loanInput, session.user.id))` |
| `loans/new/page.tsx` | `engine.ts` | calculateLoanSummary | VERIFIED | `import { calculateLoanSummary } from "@/lib/interest"` — client-side pure import |
| `customers/new/page.tsx` | `customer.actions.ts` | createCustomerAction | VERIFIED | Direct Server Action call on form submit |
| `loans/new/page.tsx` | `loan.actions.ts` | createLoanAction | VERIFIED | `const result = await createLoanAction(input)` |
| `admin/page.tsx` | `user.actions.ts` | assignRole | VERIFIED | `const result = await assignRole({ userId, role: newRole })` |
| `(app)/layout.tsx` | `app-shell.tsx` | AppShell | VERIFIED | `return <AppShell>{children}</AppShell>` |
| `login/page.tsx` | `auth-client.ts` | signIn | VERIFIED | `import { signIn } from "@/lib/auth-client"` |
| `sidebar.tsx` | `auth-client.ts` | signOut/useSession | VERIFIED | Both imported and used |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| AUTH-01 | 01-03, 01-06 | Register, login, reset password, session management | VERIFIED | Better Auth handles all; proxy guards all non-auth routes |
| AUTH-02 | 01-03 | New accounts default to Unassigned | VERIFIED | `defaultRole: "unassigned"` in auth.ts admin plugin |
| AUTH-03 | 01-03 | 3-tier role hierarchy enforced | VERIFIED | permissions.ts defines 4 roles; user.actions.ts enforces hierarchy |
| AUTH-04 | 01-03, 01-07 | Login activity recorded | VERIFIED | Better Auth session table (auth.ts) stores session per login; admin page shows createdAt as "Last Active" |
| AUTH-05 | 01-03 | Cannot assign roles at or above own level | VERIFIED | user.actions.ts: `if (targetLevel >= actorLevel) return error` |
| CUST-01 | 01-04, 01-07 | Register customer with Name, Contact, Address | VERIFIED | createCustomerAction → createCustomer → customers table |
| CUST-02 | 01-04, 01-07 | View and edit customer profile | VERIFIED | getCustomerAction, updateCustomerAction; customer [id] page has edit toggle |
| CUST-03 | 01-05, 01-07 | Capture collateral per loan | VERIFIED | collateral table; createLoan inserts into separate collateral table |
| CUST-04 | 01-05 | Block loan if customer incomplete | VERIFIED | checkCustomerCompleteness in loan.service.ts; throws IncompleteLoanRequirements |
| LOAN-01 | 01-05, 01-07 | Create loan with Amount, Date, Rate, Security | VERIFIED | createLoan + createLoanAction; wizard has all 3 steps |
| LOAN-02 | 01-01, 01-05 | Loan is perpetual, no fixed maturity | VERIFIED | No term_days/due_date in schema; no dueDate in service or action code |
| LOAN-03 | 01-02 | Reducing-balance interest calculation | VERIFIED | calculateInterest: balance × monthly_rate/30 × effective_days; 12 tests pass |
| LOAN-04 | 01-02 | BigNumber for all arithmetic | VERIFIED | engine.ts uses only BigNumber methods; no native float arithmetic on money |
| LOAN-05 | 01-01, 01-05 | Loan status lifecycle | PARTIAL | Schema has 3 statuses (pending/active/fully_paid) by user decision. REQUIREMENTS.md text still specifies 5. Requirement text needs reconciliation. |
| LOAN-10 | 01-02 | 30-day minimum interest period enforced | VERIFIED | calculateInterest: `Math.max(daysElapsed, minInterestDays)`; tests pass for 1-day and 15-day scenarios |
| LOAN-11 | 01-05 | Admin can override rate and period per loan or globally | VERIFIED | interestRateOverride/minPeriodOverride on loans table; createLoanAction strips overrides for non-admin; settings.actions.ts for global defaults |
| INFR-01 | 01-01, 01-05 | PostgreSQL, NUMERIC(15,2), audit log | VERIFIED | Schema uses numeric(15,2); audit_log table with before/after values; loan creation writes audit in same transaction |
| INFR-02 | 01-04, 01-05 | Input validation and consistent error handling | VERIFIED (adapted) | Plans replaced Zod with TypeScript types + runtime guards per user decision; Server Actions return `{ data } or { error }` consistently |
| INFR-03 | 01-06 | Responsive for desktop and tablet, UGX display | NEEDS HUMAN | UI components exist with responsive classes (max-w-md, md:px-6); UGX displayed via Intl.NumberFormat. Visual responsiveness requires human check. |
| INFR-05 | 01-02 | BigNumber for all monetary arithmetic | VERIFIED | engine.ts enforces BigNumber throughout; principalAmount stays as string through service layer; no parseFloat in service files |
| INFR-06 | 01-01 | Effect.js in service layer | VERIFIED (Phase 1 scope) | All service functions return Effect types; Layer deferral documented in CONTEXT.md. INFR-06 full Layer injection deferred per documented decision. |

**Orphaned requirement check:** REQUIREMENTS.md Phase 1 list includes INFR-05 but Plans 01-01 through 01-07 only explicitly list INFR-05 in plan 01-01. Verified it is covered by engine.ts and schema string types.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/db/index.ts` | 8 | `new URL(connectionString)` at module scope without guard | BLOCKER | Causes 2 test failures: ERR_INVALID_URL when DATABASE_URL is undefined in test environment |
| `src/lib/auth.ts` | 4,8 | Resend import + requireEmailVerification not in plan | WARNING | Undocumented scope expansion; RESEND_API_KEY missing from .env.example; changes registration UX flow |
| `src/services/audit.service.ts` | 17 | `tx: any` type | INFO | Weak typing for transaction handle; acceptable for Phase 1 |
| `src/app/(app)/loans/new/page.tsx` | 23 | `parseFloat(amount)` in formatUGX helper | INFO | Only used for display formatting via Intl.NumberFormat, not for financial arithmetic. Acceptable. |

### Human Verification Required

**1. First-User SuperAdmin Flow**

**Test:** Register the very first user on a fresh database (after clearing all user records)
**Expected:** That user lands on /dashboard (not /pending-approval) because the databaseHook promotes them to superAdmin. The admin page shows their role as superAdmin.
**Why human:** The SQL count + UPDATE hook runs server-side against a live database; cannot verify statically.

**2. Email Verification Flow**

**Test:** Register a new account, check for verification email. Click verification link. Attempt to access /dashboard before verification — expect redirect to /verify-email. After verification, log in and confirm redirect to /pending-approval (unassigned) or /dashboard (superAdmin).
**Expected:** Full email verification gate works end-to-end. If CYPRESS=true is set, the /api/test/verification-url endpoint returns the URL instead of sending email.
**Why human:** Flow involves email delivery, token validation, and proxy redirect chains across multiple HTTP requests.

**3. Interest Math Spot Check**

**Test:** In loan wizard Step 1, enter 1,000,000 UGX at 10%/month. Advance to Step 3.
**Expected:** Daily interest = 3,333.33 UGX; Total interest at min period = 100,000.00 UGX; Total owed = 1,100,000.00 UGX; Minimum period reminder shows "30 days".
**Why human:** The wizard converts display rate ("10" % per month) to decimal by dividing by 100. Verify the conversion is correct in the rendered UI.

**4. Admin Role Dropdown Hierarchy**

**Test:** Log in as Admin. Navigate to /admin. Verify role dropdown for a loanOfficer user only shows [unassigned, loanOfficer]. Attempt via UI to assign "admin" to a user — expect the dropdown to not show that option.
**Expected:** Options are filtered by getRoleOptions(actorRole) which returns roles strictly below the actor's level.
**Why human:** Requires multi-user live session scenario.

**5. Responsive Layout (INFR-03)**

**Test:** Open app on desktop (1440px), resize to tablet (768px). Verify sidebar collapses, forms remain usable, tables scroll horizontally if needed.
**Expected:** All pages adapt gracefully; no overflow or layout breakage.
**Why human:** Visual layout behavior cannot be verified by static grep.

### Gaps Summary

**Gap 1 (Blocker — test suite partially broken):** `src/lib/db/index.ts` parses `DATABASE_URL` as a URL at module load time. This was added to extract `search_path` for test schema isolation (a legitimate purpose), but it crashes when `DATABASE_URL` is not set in the test environment. Two service module-import tests fail as a result. The fix is a one-line guard: `const url = connectionString ? new URL(connectionString) : null`. This does not affect production behavior where DATABASE_URL is always set.

**Gap 2 (Documentation — LOAN-05 scope mismatch):** The REQUIREMENTS.md text for LOAN-05 specifies 5 loan statuses but the implementation has 3 by explicit user decision (documented in project memory). The requirement tracking table marks it Complete. The gap is that the requirement *text* contradicts the implementation. This needs a DEVIATION note added to REQUIREMENTS.md under LOAN-05, or the requirement text updated to reflect v1 scope.

**Gap 3 (Undocumented scope expansion — email verification):** `auth.ts` enables `requireEmailVerification: true` with a Resend email integration. This was not in any plan. The proxy now has an additional `/verify-email` gate (`!session.user.emailVerified` check). This changes the signup UX from what Plan 01-06 documents (register → /pending-approval) to (register → verify email → /pending-approval). The `.env.example` is missing `RESEND_API_KEY` and `EMAIL_FROM`. This deviation needs documentation and the env file needs updating.

---

_Verified: 2026-03-20T20:15:00Z_
_Verifier: Claude (gsd-verifier)_
