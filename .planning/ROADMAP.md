# Roadmap: Money Lending Management System

## Milestones

- ✅ **v1.0 MVP** — Phases 1-5 (shipped 2026-03-22)
- ✅ **v1.1 Payments** — Phases 6-10 (shipped 2026-03-24)
- 🚧 **v1.2 Responsive** — Phases 11-16 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-5) — SHIPPED 2026-03-22</summary>

- [x] Phase 1: Foundation (7/7 plans) — completed 2026-03-20
- [x] Phase 2: Loan Operations (4/4 plans) — completed 2026-03-20
- [x] Phase 3: Operational Management (4/4 plans) — completed 2026-03-21
- [x] Phase 4: Financial Reporting (8/8 plans) — completed 2026-03-21
- [x] Phase 5: Optimistic Updates & UX (4/4 plans) — completed 2026-03-22

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

<details>
<summary>✅ v1.1 Payments (Phases 6-10) — SHIPPED 2026-03-24</summary>

- [x] Phase 6: Global Payments List (2/2 plans) — completed 2026-03-23
- [x] Phase 7: Daily Collections View (2/2 plans) — completed 2026-03-23
- [x] Phase 8: Quick-Record Workflow (2/2 plans) — completed 2026-03-23
- [x] Phase 9: Design System Overhaul (6/6 plans) — completed 2026-03-23
- [x] Phase 10: Verification & Documentation Cleanup (1/1 plan) — completed 2026-03-24

Full details: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

</details>

### v1.2 Responsive (In Progress)

**Milestone Goal:** Make the entire app usable on mobile, tablet, and desktop — bottom tab bar navigation, responsive card layouts for all list pages, touch-friendly interactions, and full Cypress coverage at mobile viewport.

- [x] **Phase 11: Test Selector Foundation** - Scope data-testid attributes and remove hardcoded padding before any layout changes (completed 2026-03-24)
- [x] **Phase 12: Mobile Navigation** - Bottom tab bar with 5 primary tabs, More sheet, safe-area insets, sidebar hidden on mobile (completed 2026-03-25)
- [x] **Phase 13: Responsive Table Primitive + Card Layouts** - ResponsiveTable component applied to all list pages; dashboard reflowed to single column (completed 2026-03-25)
- [x] **Phase 14: Forms, Filters, and Table Polish** - Single-column forms, collapsible filters, sticky table headers across all pages (completed 2026-03-25)
- [x] **Phase 15: Touch Optimization** - 44px touch targets, DrawerDialog for mobile, swipe gestures (completed 2026-03-25)
- [ ] **Phase 16: Cypress Mobile Coverage** - All existing specs pass at desktop; mobile viewport blocks and tab bar tests added

## Phase Details

### Phase 11: Test Selector Foundation
**Goal**: Cypress selectors are scoped with data-testid and hardcoded padding is replaced before any new nav or layout components enter the DOM
**Depends on**: Phase 10 (v1.1 complete)
**Requirements**: TEST-01, RESP-06
**Success Criteria** (what must be TRUE):
  1. All nav assertions in existing Cypress specs target `[data-testid='sidebar-nav']` — not bare `cy.get('nav')`
  2. All table row assertions use `[data-testid='data-row']` — works regardless of whether a `<tr>` or a card is rendered
  3. Every page component uses `p-4 md:p-6` responsive padding instead of hardcoded `p-6`
  4. All existing Cypress specs still pass after selector changes
**Plans:** 2/2 plans complete
Plans:
- [ ] 11-01-PLAN.md — Add data-testid attributes and migrate Cypress selectors
- [ ] 11-02-PLAN.md — Replace hardcoded p-6 padding with responsive p-4 md:p-6

### Phase 12: Mobile Navigation
**Goal**: Users on mobile can navigate the entire app via a bottom tab bar; sidebar is hidden on mobile and visible on tablet/desktop
**Depends on**: Phase 11
**Requirements**: NAV-01, NAV-02, NAV-03, NAV-04, NAV-05
**Success Criteria** (what must be TRUE):
  1. At mobile viewport (390px), a fixed bottom tab bar shows 5 tabs: Dashboard, Customers, Payments, Loans, More
  2. Tapping "More" opens a bottom sheet listing Creditors, Expenses, Income, Reports, Watchlist
  3. The active tab is visually highlighted with a smooth indicator transition
  4. At tablet/desktop viewport (768px+), the sidebar is visible and the bottom tab bar is absent from the DOM
  5. On iPhone (viewport-fit=cover), the bottom tab bar clears the home indicator via safe-area-inset-bottom padding
**Plans:** 2/2 plans complete
Plans:
- [ ] 12-01-PLAN.md — Build BottomTabBar, MoreSheet, wire into AppShell, clean up TopBar, add viewport export
- [ ] 12-02-PLAN.md — Cypress E2E tests for mobile navigation and full regression check

### Phase 13: Responsive Table Primitive + Card Layouts
**Goal**: All list pages render stacked card layouts on mobile and standard tables on desktop using a single CSS-controlled primitive
**Depends on**: Phase 12
**Requirements**: RESP-01, RESP-02, RESP-07
**Success Criteria** (what must be TRUE):
  1. At mobile viewport, list pages (Customers, Loans, Payments, Creditors, Expenses, Income, Watchlist) show stacked cards instead of horizontal table rows
  2. At desktop viewport, the same pages show the original table layout — no regressions
  3. The Dashboard KPI cards and charts reflow to a single column on mobile
  4. The card/table switch is controlled by CSS breakpoints with no JavaScript viewport detection (no hydration mismatch)
**Plans:** 2/2 plans complete
Plans:
- [ ] 13-01-PLAN.md — Build ResponsiveTable primitive, wire Customers/Creditors/Watchlist, fix Dashboard grid
- [ ] 13-02-PLAN.md — Wire Loans/Payments/Expenses/Income, full Cypress E2E coverage

### Phase 14: Forms, Filters, and Table Polish
**Goal**: All forms render single-column on mobile, filter panels are collapsible, and table headers stick on desktop scroll
**Depends on**: Phase 13
**Requirements**: RESP-03, RESP-04, RESP-05
**Success Criteria** (what must be TRUE):
  1. Multi-column form layouts (loan wizard, customer registration, creditor form) collapse to single column at mobile viewport
  2. Filter panels on list pages (Customers, Loans, Payments, Expenses, Income) are collapsed by default on mobile and expanded by default on desktop
  3. Table headers remain visible when scrolling long lists on desktop
**Plans:** 2/2 plans complete
Plans:
- [ ] 14-01-PLAN.md — Build FilterPanel component, sticky table headers, wire into Customers and Payments
- [ ] 14-02-PLAN.md — Cypress E2E tests for forms, filters, and table polish (RESP-03, RESP-04, RESP-05)

### Phase 15: Touch Optimization
**Goal**: Every interactive element is reachable by thumb, dialogs open as bottom drawers on mobile, and swipe navigation is available where applicable
**Depends on**: Phase 14
**Requirements**: TOUCH-01, TOUCH-02, TOUCH-03
**Success Criteria** (what must be TRUE):
  1. All buttons, links, and action menu triggers have a minimum 44x44px tap target (WCAG 2.5.8)
  2. Edit and delete dialogs open as bottom drawers on mobile and as centered modals on desktop
  3. Mobile navigation supports swipe gestures where applicable without conflicting with browser back gestures
**Plans:** 2/2 plans complete
Plans:
- [ ] 15-01-PLAN.md — Touch targets (button.tsx, DropdownMenuTrigger, FilterPanel) + DrawerDialog component
- [ ] 15-02-PLAN.md — Migrate all Dialog/Sheet call sites to DrawerDialog, MoreSheet drag handle, Cypress E2E

### Phase 16: Cypress Mobile Coverage
**Goal**: All existing Cypress specs pass at desktop viewport and every page has mobile viewport test coverage; tab bar navigation is fully tested
**Depends on**: Phase 15
**Requirements**: TEST-02, TEST-03, TEST-04
**Success Criteria** (what must be TRUE):
  1. All existing Cypress spec files pass when run at default (desktop) viewport after all responsive changes
  2. Every existing spec file contains a mobile viewport block (`cy.viewport(390, 844)`) covering rendering, navigation, and key actions
  3. A dedicated spec for the bottom tab bar verifies tab switching, "More" sheet, active state, and safe-area layout at mobile viewport
**Plans**: TBD

## Progress

**Execution Order:** 11 → 12 → 13 → 14 → 15 → 16

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 7/7 | Complete | 2026-03-20 |
| 2. Loan Operations | v1.0 | 4/4 | Complete | 2026-03-20 |
| 3. Operational Management | v1.0 | 4/4 | Complete | 2026-03-21 |
| 4. Financial Reporting | v1.0 | 8/8 | Complete | 2026-03-21 |
| 5. Optimistic Updates & UX | v1.0 | 4/4 | Complete | 2026-03-22 |
| 6. Global Payments List | v1.1 | 2/2 | Complete | 2026-03-23 |
| 7. Daily Collections View | v1.1 | 2/2 | Complete | 2026-03-23 |
| 8. Quick-Record Workflow | v1.1 | 2/2 | Complete | 2026-03-23 |
| 9. Design System Overhaul | v1.1 | 6/6 | Complete | 2026-03-23 |
| 10. Verification & Doc Cleanup | v1.1 | 1/1 | Complete | 2026-03-24 |
| 11. Test Selector Foundation | v1.2 | 2/2 | Complete | 2026-03-24 |
| 12. Mobile Navigation | v1.2 | 2/2 | Complete | 2026-03-25 |
| 13. Responsive Table + Cards | 2/2 | Complete    | 2026-03-25 | - |
| 14. Forms, Filters & Polish | 2/2 | Complete    | 2026-03-25 | - |
| 15. Touch Optimization | 2/2 | Complete   | 2026-03-25 | - |
| 16. Cypress Mobile Coverage | v1.2 | 0/TBD | Not started | - |
