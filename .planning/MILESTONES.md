# Milestones

## v1.2 Responsive (Shipped: 2026-03-26)

**Phases completed:** 6 phases, 12 plans

**Key accomplishments:**

1. Test Selector Foundation — Scoped data-testid selectors on sidebar nav and all data table rows; responsive p-4 md:p-6 padding across 22 pages
2. Mobile Navigation — Bottom tab bar with 5 primary tabs + More sheet, CSS-only show/hide, safe-area inset padding for iPhone
3. ResponsiveTable Primitive — Generic CSS-only card/table component wired to all 7 list pages; Dashboard KPI grid breakpoints
4. Forms, Filters & Polish — FilterPanel collapsible wrapper, sticky table headers, single-column form layouts on mobile
5. Touch Optimization — 44px WCAG touch targets, DrawerDialog (modal on desktop, bottom drawer on mobile), swipe-to-dismiss
6. Cypress Mobile Coverage — Mobile viewport blocks in all 29+ spec files, dedicated tab-bar spec, full desktop regression

**Stats:**

- Files modified: 122
- Lines: +13,150 / -904
- Timeline: 7 days (2026-03-19 → 2026-03-26)
- Git range: feat(11-01) → feat(16-02)

---

## v1.1 Payments (Shipped: 2026-03-24)

**Phases completed:** 5 phases, 13 plans

**Key accomplishments:**

1. Global Payments List — Paginated, searchable, filterable payments table across all loans with edit, delete, and CSV export
2. Daily Collections View — Date-navigable daily summary with timezone-aware aggregation (Africa/Kampala) and due-today loan list
3. Quick-Record Workflow — Inline payment recording from the Payments page with loan search combobox, recently-collected chips, and receipt link
4. Sovereign Ledger Design System — Full OKLCH token rewrite, glassmorphism overlays, monochromatic surface hierarchy, font-mono tabular-nums across every page
5. Verification & Documentation Cleanup — All 27 requirements formally verified, all audit gaps closed

**Stats:**

- Files modified: 114
- Lines: +15,478 / -662
- Timeline: 2 days (2026-03-23 → 2026-03-24)
- Commits: ~96

---

## v1.0 MVP (Shipped: 2026-03-23)

**Phases completed:** 5 phases, 27 plans, 10 tasks

**Key accomplishments:**

1. Database schema, Better Auth RBAC with 3-tier role hierarchy, and reducing-balance Interest Engine with BigNumber precision
2. Payment processing with interest-first allocation, edit/delete with full audit trail, and printable disbursement/repayment receipts
3. Executive dashboard with live KPIs, customer search/filter/pagination, borrower watchlist, and repayment simulator
4. Creditor capital tracking, expense/income ledger with categories, P&L and Balance Sheet with PDF/Excel export
5. Optimistic UI updates with TanStack Query, React 19 useTransition loading states across all forms

**Known Gaps:**

- INFR-01: PostgreSQL schema exists with NUMERIC(15,2) columns and audit log — functionally complete, never formally checked off
- INFR-05: BigNumber used throughout monetary arithmetic — functionally complete, never formally checked off
- INFR-06: Effect.js used in service layer with typed errors — full Layer/Context.Tag DI deferred (services close over module-scope db)

**Stats:**

- Files modified: 300
- Lines of code: ~52,000 TypeScript
- Timeline: 4 days (2026-03-19 → 2026-03-22)

---
