# Project Research Summary

**Project:** Money Lending Management System
**Domain:** Microfinance / Small Business Lending Operations
**Researched:** 2026-03-19
**Confidence:** MEDIUM — core stack is pre-decided and confirmed from package.json; library choices and patterns are training-data-only; external verification tools were unavailable during research

## Executive Summary

This is a microfinance management system for a small lending operation with 3-5 staff roles. The system must handle the complete loan lifecycle: customer registration, loan issuance with guarantor/collateral capture, daily interest accrual on a reducing-balance model, payment recording with interest-first allocation, receipt generation, and financial reporting (P&L and Balance Sheet). The project adds creditor/investor capital tracking — meaning interest flows in two directions: earned from borrowers and owed to investors. This dual-direction interest model is the defining architectural complexity of this system compared to a simple loan tracker.

The recommended approach is a Next.js 16 App Router full-stack monolith backed by PostgreSQL, with a dedicated service layer that isolates all financial business logic from the HTTP layer. The calculation engine (InterestEngine, PaymentProcessor) must be independently testable because its correctness is non-negotiable: bugs in daily interest accrual or payment allocation cause real money discrepancies that compound daily and are extremely difficult to reverse. The cron job for daily interest must be idempotent from day one — the `@@unique([loanId, date])` constraint on the InterestAccrual table is the hard guard, not just application-level checks.

The top risk category is financial calculation integrity. Floating-point arithmetic, double-accrual from cron retries, concurrent payment race conditions, and timezone mismatches are all silent failure modes — they do not throw errors, they just produce wrong numbers that accumulate until discovered during reconciliation. These must be addressed in Phase 1 and Phase 2 schema/engine work, before any UI is built. A second risk category is access control: RBAC must be enforced server-side on every API route from the start; UI-only enforcement is a security gap that cannot be patched incrementally once routes are in production.

## Key Findings

### Recommended Stack

The core framework (Next.js 16.2.0, React 19.2.4, TypeScript, Tailwind CSS, PostgreSQL) is pre-decided by the client and already installed. The key additions are Drizzle ORM (over Prisma — lighter, no Rust binary, explicit query model that surfaces N+1 issues in complex loan portfolio queries), decimal.js for financial arithmetic, Clerk for auth and RBAC, and date-fns for date arithmetic. For outputs: @react-pdf/renderer for receipts/reports, ExcelJS for Excel exports, and Resend + react-email for email notifications. The daily interest cron is implemented as an external HTTP trigger to a secured Route Handler — not in-process scheduling — ensuring portability between Vercel and self-hosted VPS.

**Core technologies:**
- **Next.js 16 App Router:** Full-stack framework; RSC reduces client bundle cost for data-heavy financial dashboards
- **Drizzle ORM:** Type-safe SQL with transparent query behavior; no Rust binary; explicit API prevents hidden N+1 on loan portfolio queries
- **decimal.js:** Arbitrary-precision decimal arithmetic; prevents IEEE 754 errors from compounding across 30+ days of daily interest calculations
- **Zod:** Schema validation shared between API boundary and client forms; enforces monetary field constraints before any DB write
- **Clerk (@clerk/nextjs ^6):** Auth + RBAC via `publicMetadata.role`; session enforcement in App Router middleware; webhook support for login activity
- **date-fns:** Timezone-safe date arithmetic for loan duration, due date, and accrual date calculations
- **@react-pdf/renderer:** Server-side receipt and report PDF generation with React component model
- **ExcelJS:** Full-featured xlsx generation with formatting for financial report exports
- **Resend + react-email:** Email notification delivery for money-in/money-out admin alerts
- **shadcn/ui:** Zero-runtime Tailwind component library for data tables, dialogs, forms, and status badges
- **Vitest + Playwright:** Unit tests for calculation engine correctness; E2E tests for full loan lifecycle

**Critical version gaps:** Clerk major version, @react-pdf/renderer React 19 compatibility, and Drizzle ORM exact version must all be verified on npm/docs before installation. All recommendations are from training data (cutoff August 2025).

### Expected Features

The feature set is firmly grounded in client requirements (PROJECT.md, Feb 2026). The MVP must ship a complete working loan cycle before any reporting or risk tooling is added.

**Must have (table stakes):**
- Customer registration with guarantor and collateral capture — loans cannot be issued without complete borrower identity
- Loan issuance with interest rate, disbursement date, and safeguard validation — blocked if customer is inactive/blacklisted
- Daily interest accrual cron on reducing balance — business critical; runs every day at midnight
- Payment recording with interest-first allocation — non-negotiable business rule
- Disbursement and repayment receipt generation — required proof of transaction for both parties
- Loan status lifecycle (Pending / Active / Partially Paid / Fully Paid / Defaulted) — status derived from financial state, not set directly
- Role-based access control (Super Admin / Admin / Loan Officer / Viewer) — enforced at API level
- Audit trail for all financial writes — immutable append-only log with before/after snapshots
- Executive dashboard — portfolio health summary for management
- Customer search, filtering, blacklist status, and overdue flagging

**Should have (differentiators):**
- Repayment simulator ("if borrower pays X, how many days left?") — calls same service function as cron; no separate approximation logic
- Borrower watchlist with auto-flag when < 30 days remaining
- 5-day pre-due-date in-app alert
- Email alert on every money-in / money-out
- Creditor / investor capital tracking with dual-direction interest (mirrors loan engine)
- Expense and income tracking for P&L
- P&L statement and Balance Sheet auto-generation
- PDF and Excel report exports
- Minimum interest period enforcement (30-day floor, admin-overridable with audit log)

**Defer (post-launch):**
- Admin settings UI for overriding default interest rates (hardcode defaults; UI after MVP validates)
- Loan portfolio report (approximated from dashboard initially)
- SMS notifications — excluded from scope entirely in v1
- Mobile money integration — excluded from scope entirely in v1

**Anti-features to avoid:**
- Real-time sub-daily interest accrual (creates reconciliation complexity)
- Inline editing in data tables (bypasses validation and audit logging)
- "Undo" for payments (must be a formal reversal workflow, not a button)
- Soft-delete on financial records (mark as voided/cancelled; never delete)
- Custom role configuration UI (fixed role set in code)

### Architecture Approach

The system uses a 4-layer architecture: Presentation (React Server Components + Client Components), API (Route Handlers — thin, auth-check, delegate), Service Layer (LoanService, InterestEngine, PaymentProcessor, CreditorService, ReportService, NotificationService), and Data Access (Drizzle ORM + PostgreSQL). All financial business logic lives in the service layer, making it independently testable without HTTP. The InterestAccrual table stores daily accrual rows with a `@@unique([loanId, date])` constraint that acts as a hard idempotency guard against cron double-execution. Running balance columns (`outstandingBalance`, `accruedInterestBalance`) are maintained transactionally and are the single source of truth — dashboards read these columns directly, not recalculated from history.

**Major components:**
1. **InterestEngine** — Daily accrual calculation, batch cron runner, repayment simulator, balance-to-days converter; shared math function reused by CreditorService
2. **PaymentProcessor** — Interest-first allocation with minimum period floor; pessimistic lock (`SELECT FOR UPDATE`) on loan row to prevent concurrent payment race conditions; atomic transaction wrapping all balance updates
3. **CronJobLog table** — Secondary idempotency guard (complements the DB unique constraint); tracks job runs by date for monitoring and cron failure alerting
4. **AuditLog table** — Append-only, written in the same transaction as every financial mutation; captures Clerk user ID, before/after snapshots
5. **ReportService** — Read-only aggregate queries; SQL `GROUP BY` for dashboard and reports; never recalculates from row history

### Critical Pitfalls

1. **Floating-point arithmetic for money** — Use `NUMERIC(15,2)` in PostgreSQL and decimal.js in all calculation code; establish ROUND_HALF_UP as the canonical rounding rule; never mix native JS `number` with decimal library operations. Address in Phase 1 before any financial data is written.

2. **Cron double-execution accruing interest twice** — The `@@unique([loanId, date])` constraint on InterestAccrual is the hard guard; CronJobLog provides the secondary idempotency check. Both must be in place before the cron endpoint goes live. Address in Phase 2.

3. **RBAC enforced only in the UI** — Every API route must resolve the Clerk session server-side and check the permissions matrix before executing. UI-only role enforcement is a security gap exploitable via DevTools or direct API calls. Address in Phase 1 alongside auth setup.

4. **Payment allocation race conditions** — Concurrent payment submissions (double-click, network retry) both pass the minimum interest check independently. Use `SELECT FOR UPDATE` on the loan row at the start of every payment transaction plus a client-generated idempotency key. Address in Phase 2.

5. **Audit trail as afterthought** — The audit log schema must exist in Phase 1 and be written to in every subsequent phase. Retrofitting it after financial data exists requires rewrites to every mutation path.

6. **Timezone mismatch on loan start date** — Define a `BUSINESS_TIMEZONE` config constant; store loan dates as `DATE` (not `TIMESTAMP`); compute cron "today" in the business timezone using date-fns-tz. Address in Phase 1 schema design.

7. **Creditor interest entangled with borrower loan engine** — Share the math function (`calculateDailyInterest(principal, rate)`) but use separate tables, separate service modules, and separate cron handling. A settings change to borrower interest rates must not affect creditor accruals. Address in Phase 1 schema design.

## Implications for Roadmap

Research strongly suggests a 4-phase build order driven by data dependencies and risk mitigation. Financial correctness must be established in the engine before any UI exposes it to users.

### Phase 1: Foundation — Schema, Auth, and Core Engine

**Rationale:** All other work depends on this. Database schema design decisions (numeric types, audit log structure, separate borrower/creditor accrual tables, timezone constants) are extremely expensive to reverse after financial data exists. Auth and RBAC must be correct before any financial route is accessible. The loan issuance and interest calculation engine is the critical path — everything downstream depends on it being correct.

**Delivers:** Working database schema with all tables and constraints; Clerk auth with server-side RBAC middleware; customer CRUD; loan issuance (create loan + guarantor + collateral); InterestEngine with daily accrual logic and unit tests; cron endpoint with idempotency (CronJobLog + unique constraint); audit log written on every financial mutation.

**Addresses features:** Authentication, RBAC, customer registration, loan issuance, daily interest cron, loan status lifecycle, audit trail, input validation safeguards.

**Avoids pitfalls:** Floating-point money (schema uses NUMERIC), audit trail as afterthought (schema from day 1), RBAC UI-only enforcement (server-side middleware), timezone off-by-one (DATE type + BUSINESS_TIMEZONE constant), creditor/borrower entanglement (separate tables from schema).

### Phase 2: Loan Operations — Payment Processing and Receipts

**Rationale:** PaymentProcessor depends on a working InterestEngine (Phase 1). Receipts depend on payment records with balance snapshots. This phase completes the core business transaction loop — a loan officer can now do their full daily job in the system.

**Delivers:** Payment recording with interest-first allocation and minimum period enforcement; pessimistic lock + idempotency key against concurrent submissions; disbursement and repayment receipt generation (PDF via @react-pdf/renderer with immutable snapshots); blacklisted customer check at payment time; email notification to admin on money-in/money-out.

**Addresses features:** Payment recording, receipt generation, minimum interest period enforcement, email alerts, blacklist enforcement.

**Avoids pitfalls:** Payment race conditions (SELECT FOR UPDATE), receipt live-data problem (immutable snapshots), payment allocation bypass (atomic transaction), permissive input validation on financial fields.

### Phase 3: Operational Management — Dashboard, Risk Tools, and Notifications

**Rationale:** Dashboard and risk tooling require financial data that only exists after Phase 1-2. The repayment simulator must call the same InterestEngine service function as the cron — meaning the engine must be stable and proven correct before the simulator is built on top of it.

**Delivers:** Executive dashboard with SQL-aggregated portfolio metrics; customer search, filtering, pagination; borrower watchlist (auto-flag < 30 days remaining); overdue/defaulted loan flagging; 5-day pre-due-date in-app alerts; repayment simulator and balance-to-days converter; login activity tracking via Clerk webhook (fast-insert queue pattern).

**Addresses features:** Dashboard, customer search, borrower watchlist, overdue flagging, in-app alerts, repayment simulator, login activity tracking.

**Avoids pitfalls:** N+1 queries on dashboard (SQL GROUP BY + indexes), repayment simulator drift (shared service function), Clerk webhook reliability (fast-insert queue + async processing).

### Phase 4: Financial Reporting and Creditor Management

**Rationale:** P&L and Balance Sheet require the complete expense/income ledger plus creditor balances. Creditor management reuses the InterestEngine but must use separate tables — only safe to build after the engine is proven stable and tested in production. Excel and PDF exports are the final delivery mechanism for reports that must leave the system.

**Delivers:** Creditor registration and investment tracking; creditor daily interest accrual (separate CreditorService reusing math function only); expense and income transaction logging; P&L statement (interest income vs interest expense clearly separated); Balance Sheet (loan book assets, creditor liabilities, equity); PDF and Excel export of reports; admin settings UI for overriding default interest rate and minimum period.

**Addresses features:** Creditor management, expense/income tracking, P&L statement, Balance Sheet, PDF/Excel export, admin settings.

**Avoids pitfalls:** Creditor/borrower engine entanglement (separate tables), PDF environment rendering failures (test in production environment before client demo), N+1 on reports (materialized views or pre-computed aggregates).

### Phase Ordering Rationale

- The dependency graph in FEATURES.md and ARCHITECTURE.md both independently derive the same order: schema first, core engine second, operational tools third, reporting fourth.
- Financial correctness must be established in a clean environment (no real user data) before it is trusted with actual transactions.
- The InterestEngine is a shared dependency across borrower loans, creditor investments, and the repayment simulator — stabilizing it in Phase 1-2 prevents cascading rework in later phases.
- Creditor management is deferred to Phase 4 (not Phase 2) because it is a differentiator feature that reuses proven infrastructure, and getting borrower loan operations correct is the higher-priority business risk.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 — Drizzle ORM setup:** The recommended Drizzle version is from training data; migration tooling (drizzle-kit) and schema definition patterns may have changed. Run `npm info drizzle-orm` before planning Phase 1 tasks.
- **Phase 1 — Clerk RBAC with App Router:** Clerk major versions have breaking changes; `@clerk/nextjs` App Router middleware API must be verified against current docs before implementation tasks are written.
- **Phase 2 — @react-pdf/renderer React 19 compatibility:** React 19 peer dependency support was unverified during research. Verify before building the receipt generation feature.
- **Phase 3 — Clerk webhook fast-insert queue:** The specific `instrumentation.ts`-based background processing pattern in Next.js 16 should be verified against current Next.js docs.

Phases with standard patterns (skip research-phase):
- **Phase 2 — Payment allocation logic:** Reducing balance with interest-first allocation is a well-documented financial formula with no framework dependency. Unit tests validate correctness; no research needed.
- **Phase 3 — SQL aggregation for dashboard:** Standard PostgreSQL GROUP BY queries; no special library or framework pattern needed.
- **Phase 4 — ExcelJS report generation:** ExcelJS API is stable and well-documented; the pattern is straightforward.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Core framework confirmed from package.json; supplementary libraries (Drizzle, Clerk version, @react-pdf React 19 compat) unverified against live npm |
| Features | HIGH | Primary source is the client requirements document (PROJECT.md, Feb 2026); feature set is specific and well-defined |
| Architecture | MEDIUM | Patterns are sound and standard; specific Next.js 16.2.0 behaviors verified from official docs listed in ARCHITECTURE.md sources |
| Pitfalls | HIGH | IEEE 754, cron idempotency, DB transaction isolation, timezone handling are established computer science; not speculative |

**Overall confidence:** MEDIUM — the research gives a clear and actionable picture of what to build and how to build it safely. The uncertainty is in specific library versions and API details, not in the fundamental approach.

### Gaps to Address

- **Drizzle ORM current version and migration API:** Verify `drizzle-orm` and `drizzle-kit` current versions on npmjs.com before writing Phase 1 implementation tasks. The training-data version (~0.30) may be outdated.
- **Clerk current major version and App Router middleware API:** Verify at clerk.com/docs/quickstarts/nextjs. Breaking changes between majors affect how `clerkMiddleware()` is used in `middleware.ts`.
- **@react-pdf/renderer + React 19:** Must test in the actual Next.js 16.2.0 + React 19.2.4 environment before committing to this library for receipts. If incompatible, fallback to PDFKit or a Puppeteer microservice.
- **Business timezone for the client:** The cron and date arithmetic require a `BUSINESS_TIMEZONE` constant. Confirm the client's operating timezone (likely `Africa/Kampala` or similar) during requirements definition.
- **Hosting environment (Vercel vs self-hosted VPS):** Affects rate-limiting strategy (Upstash Redis vs in-memory) and cron scheduling approach. Confirm with client before Phase 1 planning.
- **Creditor interest rate model:** ARCHITECTURE.md and FEATURES.md assume creditor accrual mirrors the borrower engine (reducing balance, daily rate). Confirm with client whether creditors accrue interest on a flat or reducing balance model.

## Sources

### Primary (HIGH confidence)
- `.planning/PROJECT.md` — client requirements document (Money_Lending_App_Requirements.docx v1.0, Feb 16 2026)
- `package.json` — installed packages confirming Next.js 16.2.0, React 19.2.4, TypeScript, Tailwind CSS
- Next.js 16.2.0 official documentation (Route Handlers, Instrumentation, Self-hosting, `after()` function) — verified by ARCHITECTURE.md researcher
- PostgreSQL NUMERIC vs FLOAT specification — standard database documentation

### Secondary (MEDIUM confidence)
- Training data ecosystem knowledge (cutoff August 2025) — Drizzle ORM, Clerk, shadcn/ui, Resend, Vitest patterns
- `.planning/codebase/CONCERNS.md` — existing codebase gap analysis (ORM, validation, testing)
- `.planning/codebase/ARCHITECTURE.md` — App Router pattern confirmed from existing code

### Tertiary (LOW confidence)
- Clerk webhook retry behavior — consistent with standard webhook provider patterns but Clerk-specific retry count not verified
- @react-pdf/renderer React 19 compatibility — unverified; flag for Phase 2 research
- Drizzle ORM 1.0 stable milestone claim — training data only; verify current version before installation

---
*Research completed: 2026-03-19*
*Ready for roadmap: yes*
