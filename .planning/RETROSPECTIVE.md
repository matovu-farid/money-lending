# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-03-22
**Phases:** 5 | **Plans:** 27 | **Commits:** 175

### What Was Built
- Full loan lifecycle: customer onboarding → loan issuance → payment recording → receipt printing
- Reducing-balance Interest Engine with BigNumber precision and 30-day minimum period enforcement
- Better Auth RBAC with 3-tier role hierarchy (Super Admin → Admin → Loan Officer)
- Executive dashboard, borrower watchlist, repayment simulator, in-app notifications
- Creditor capital tracking with same engine as borrower loans
- Expense/income ledger, transaction log, P&L and Balance Sheet with PDF/Excel export
- Optimistic UI with TanStack Query and React 19 useTransition loading states

### What Worked
- Phased dependency graph: each phase built on proven infrastructure from the previous one
- Interest Engine TDD in Phase 1 paid off — zero calculation bugs through Phases 2-5
- Server Actions over Route Handlers eliminated fetch boilerplate and kept code simple
- BigNumber-only policy for monetary arithmetic prevented all float-precision issues
- writeAuditLog as plain async (not Effect) inside Drizzle transactions avoided runtime errors
- 4-day build timeline from zero to complete MVP

### What Was Inefficient
- INFR-01/05/06 requirements never formally checked off despite being functionally complete
- Phase 5 UX requirements plan checkboxes in ROADMAP left unchecked (cosmetic, not functional)
- base-ui API surprises (no asChild, render prop pattern) required multiple mid-phase discoveries
- Better Auth type complexity required several `as any` casts

### Patterns Established
- Server Actions return void / throw on error — no error-in-result pattern
- writeAuditLog as plain async inside db.transaction (not Effect.runPromise — Pitfall 7)
- Fire-and-forget email notifications (never await, never block)
- Server Component + client island pattern: page.tsx fetches via Effect.runPromise, passes props
- buttonVariants + Link for link-styled buttons (base-ui Button has no asChild)
- PopoverTrigger/TooltipTrigger render prop pattern (base-ui, not Radix)

### Key Lessons
1. Effect.runPromise inside Drizzle tx callbacks causes runtime errors — always use plain async for in-transaction side effects
2. Better Auth RBAC plugin API differs from docs — verify against installed package, not training data
3. base-ui primitives (shadcn@latest) have different APIs than Radix — no asChild, render prop required
4. Perpetual loans (no maturity) simplify the model significantly — payment table is the sole source of truth
5. TanStack Query is overkill for most forms — useTransition handles 90% of loading state needs

### Cost Observations
- Model mix: primarily opus for planning/execution
- Sessions: ~10 across 4 days
- Notable: parallel agent execution for plan steps significantly reduced wall-clock time

---

## Milestone: v1.1 — Payments

**Shipped:** 2026-03-24
**Phases:** 5 | **Plans:** 13 | **Commits:** ~96

### What Was Built
- Global Payments List with paginated, searchable, filterable table across all loans (edit, delete, CSV export)
- Daily Collections View with timezone-aware aggregation (Africa/Kampala), per-loan breakdown, due-today list
- Quick-Record Workflow with loan search combobox, recently-collected chips, inline recording with receipt link
- Sovereign Ledger Design System across the entire app — OKLCH tokens, glassmorphism, tonal hierarchy, font-mono tabular-nums
- Full verification and documentation cleanup — 27/27 requirements formally verified

### What Worked
- Phase 6 data-layer-first pattern (service → action → integration tests → UI) established clean contract for Phases 7-8
- TanStack Query with initialData hydration pattern avoided loading flashes while enabling optimistic mutations
- Sovereign Ledger design system as a dedicated phase (vs incremental) was the right call — consistent result across all pages
- Milestone audit before completion caught 3 documentation gaps that Phase 10 closed
- No new npm packages needed — entire v1.1 built with existing stack

### What Was Inefficient
- Some SUMMARY.md files had empty requirements-completed fields despite requirements being verified in VERIFICATION.md
- ROADMAP.md plan checkboxes for Phases 7-10 left unchecked in roadmap (cosmetic)
- 6 pre-existing Cypress test failures in payments-list.cy.ts (timing/assertion issues) — non-blocking but noisy
- Phase 9 verification became stale after late plan changes, requiring Phase 10 refresh

### Patterns Established
- URL-synced filter bar with 300ms debounce (reusable pattern from TransactionLogClient)
- `DATE(col AT TIME ZONE 'Africa/Kampala')` for all timezone-aware date grouping queries
- Plain div dropdown over base-ui Popover for comboboxes (PopoverTrigger intercepts onChange in headless)
- Canvas pixel-read for Cypress color assertions (OKLCH/lab computed colors → sRGB comparison)
- Design system as standalone phase with dedicated Cypress smoke tests per plan

### Key Lessons
1. base-ui PopoverTrigger render prop intercepts input events — use plain div dropdowns for comboboxes
2. Drizzle postgres-js `db.execute` returns RowList directly — `Array.from(rows)`, not `result.rows`
3. Cypress URL assertions need `cy.visit()` approach, not router.push from nested components
4. Design system overhaul benefits from exhaustive per-page plan breakdown — prevents drift
5. Milestone audit is load-bearing — it caught documentation gaps that would have shipped as tech debt

### Cost Observations
- Model mix: primarily opus for planning/execution
- Sessions: ~5 across 2 days
- Notable: 2-day timeline for 5 phases including full design system rewrite

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Commits | Phases | Key Change |
|-----------|---------|--------|------------|
| v1.0 | 175 | 5 | Initial build — established all patterns |
| v1.1 | ~96 | 5 | Payments first-class page + design system overhaul |

### Top Lessons (Verified Across Milestones)

1. TDD for financial calculation engines prevents downstream bugs across all consuming phases
2. Plain async (not Effect) for side effects inside Drizzle transactions
3. Server Actions + useTransition is the right default; TanStack Query only for optimistic list mutations
4. Data-layer-first per phase (service → action → tests → UI) produces clean contracts for dependent phases
5. Milestone audit before archival catches documentation gaps that would otherwise ship as tech debt
6. Design system changes are best done as a dedicated phase, not incrementally
