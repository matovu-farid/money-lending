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

## Milestone: v1.2 — Responsive

**Shipped:** 2026-03-26
**Phases:** 6 | **Plans:** 12 | **Files changed:** 122

### What Was Built
- Test selector foundation: data-testid on sidebar nav and all data table rows, responsive padding across 22 pages
- Mobile bottom tab bar with 5 tabs + More sheet, CSS-only show/hide, safe-area inset padding
- ResponsiveTable<T> generic primitive with CSS-only card/table switch for all 7 list pages
- FilterPanel collapsible component for mobile, sticky table headers for desktop scroll
- 44px WCAG touch targets on all interactive elements, DrawerDialog (desktop modal / mobile drawer)
- Full Cypress mobile viewport coverage across 29+ spec files with dedicated tab-bar spec

### What Worked
- CSS-only responsive pattern (flex md:hidden) consistently avoided hydration mismatch across all 6 phases
- Phasing test selectors (Phase 11) before layout changes prevented cascading Cypress breakage
- Single ResponsiveTable primitive + Column<T> config eliminated per-page card layout code
- DrawerDialog abstraction cleanly encapsulated desktop/mobile dialog split — 9 call sites migrated in one plan
- All 19/19 requirements shipped without gaps

### What Was Inefficient
- Tailwind v4 @source scanning picked up env() arbitrary values from .planning/ markdown files — required @source exclusions discovery mid-phase
- base-ui Collapsible.Panel uses hidden HTML attribute which blocks CSS !important overrides — had to replace with plain CSS in Phase 14
- PGLite/Next.js test server infrastructure failure blocked Phase 16 Task 3 (integration test suite)
- Phase 16 plans had 26 spec files across 2 plans — could have been parallelized better

### Patterns Established
- CSS-only responsive: flex md:hidden / hidden md:flex for all mobile/desktop switches
- ResponsiveTable<T> Column<T> config with primary, hideInCard, cardLabel for card rendering
- DrawerDialog pattern: useMediaQuery → Dialog (md+) or Drawer.Root (mobile)
- FilterPanel: plain CSS block/hidden toggle with md:!block for desktop-always-visible
- Cypress mobile viewport: context('at mobile viewport') block inside describe(), after all it() blocks
- Cypress force:true for tab bar clicks to bypass Next.js dev-mode overlays
- Cypress h1 selector for page heading assertions at mobile (avoids matching hidden sidebar links)

### Key Lessons
1. Tailwind v4 scans all project files by default — markdown with CSS-like strings will generate junk utilities; @source exclusions are essential
2. base-ui Collapsible uses hidden HTML attribute — incompatible with CSS !important overrides; use plain CSS for hybrid server/client toggle patterns
3. CSS-only responsive patterns are consistently safer than JS-based viewport detection for SSR apps
4. Test selector scoping BEFORE layout changes is load-bearing — prevents N×M selector breakage across all specs
5. filter(':visible') in Cypress is required when CSS-only show/hide creates dual DOM elements for same data

### Cost Observations
- Model mix: primarily opus for planning/execution
- Sessions: ~8 across 7 days
- Notable: 6 phases shipped in one week with full Cypress coverage at both viewports

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Commits | Phases | Key Change |
|-----------|---------|--------|------------|
| v1.0 | 175 | 5 | Initial build — established all patterns |
| v1.1 | ~96 | 5 | Payments first-class page + design system overhaul |
| v1.2 | ~24 | 6 | Full responsive mobile support + Cypress mobile coverage |

### Top Lessons (Verified Across Milestones)

1. TDD for financial calculation engines prevents downstream bugs across all consuming phases
2. Plain async (not Effect) for side effects inside Drizzle transactions
3. Server Actions + useTransition is the right default; TanStack Query only for optimistic list mutations
4. Data-layer-first per phase (service → action → tests → UI) produces clean contracts for dependent phases
5. Milestone audit before archival catches documentation gaps that would otherwise ship as tech debt
6. Design system changes are best done as a dedicated phase, not incrementally
7. CSS-only responsive patterns avoid hydration mismatch in SSR apps — consistently safer than JS viewport detection
8. Test selector scoping before layout changes prevents cascading spec breakage
