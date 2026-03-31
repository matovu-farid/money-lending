# Roadmap: Money Lending Management System

## Milestones

- ✅ **v1.0 MVP** — Phases 1-5 (shipped 2026-03-22)
- ✅ **v1.1 Payments** — Phases 6-10 (shipped 2026-03-24)
- ✅ **v1.2 Responsive** — Phases 11-16 (shipped 2026-03-26)

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

<details>
<summary>✅ v1.2 Responsive (Phases 11-16) — SHIPPED 2026-03-26</summary>

- [x] Phase 11: Test Selector Foundation (2/2 plans) — completed 2026-03-24
- [x] Phase 12: Mobile Navigation (2/2 plans) — completed 2026-03-25
- [x] Phase 13: Responsive Table Primitive + Card Layouts (2/2 plans) — completed 2026-03-25
- [x] Phase 14: Forms, Filters, and Table Polish (2/2 plans) — completed 2026-03-25
- [x] Phase 15: Touch Optimization (2/2 plans) — completed 2026-03-25
- [x] Phase 16: Cypress Mobile Coverage (2/2 plans) — completed 2026-03-26

Full details: [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | 1/2 | In Progress|  | 2026-03-20 |
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
| 13. Responsive Table + Cards | v1.2 | 2/2 | Complete | 2026-03-25 |
| 14. Forms, Filters & Polish | v1.2 | 2/2 | Complete | 2026-03-25 |
| 15. Touch Optimization | v1.2 | 2/2 | Complete | 2026-03-25 |
| 16. Cypress Mobile Coverage | v1.2 | 2/2 | Complete | 2026-03-26 |

### Phase 1: Unify Loans and Watchlist Pages

**Goal:** Merge /loans and /watchlist into a single /loans page with stat cards, filter tabs, criticality sort, print support, and all watchlist risk columns — then delete the /watchlist route entirely.
**Requirements**: UNIFY-DATA, UNIFY-NAV, UNIFY-UI, UNIFY-E2E
**Depends on:** None (standalone)
**Plans:** 1/2 plans executed

Plans:
- [ ] 01-01-PLAN.md — Data layer extension, useLoans hook, navigation cleanup, watchlist file deletion
- [ ] 01-02-PLAN.md — Unified /loans page UI with stat cards, filters, table, print, and Cypress E2E tests
