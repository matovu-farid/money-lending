# Roadmap: Money Lending Management System

## Milestones

- ✅ **v1.0 MVP** — Phases 1-5 (shipped 2026-03-22)
- 🚧 **v1.1 Payments** — Phases 6-8 (in progress)

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

### 🚧 v1.1 Payments (In Progress)

**Milestone Goal:** Build out the Payments section as a first-class page — global payments list, daily collections view, and quick-record workflow so a loan officer never has to navigate to an individual loan page to collect a payment.

- [x] **Phase 6: Global Payments List** - Paginated, searchable, filterable payments table across all loans with edit, delete, and CSV export (completed 2026-03-23)
- [x] **Phase 7: Daily Collections View** - Date-navigable daily summary showing total collected, payment count, and active loans due for payment today (completed 2026-03-23)
- [x] **Phase 8: Quick-Record Workflow** - Inline payment recording from the Payments page without navigating to a loan (completed 2026-03-23)

## Phase Details

### Phase 6: Global Payments List
**Goal**: Loan officers and admins can view, search, filter, and manage the full payment history across all loans from a single page
**Depends on**: Phase 5 (v1.0 complete)
**Requirements**: PAY-01, PAY-02, PAY-03, PAY-04, PAY-05, PAY-06, PAY-07, PAY-08
**Success Criteria** (what must be TRUE):
  1. User can open /payments and see a paginated list of all payments across all loans (25 per page)
  2. User can see customer name, loan reference, total received, interest portion, principal portion, and balance after for each payment row
  3. User can filter the list by date range, amount range, and search by customer name — results update without full page reload
  4. Admin can edit or delete any payment directly from the list without navigating to the loan page
  5. User can export the currently-filtered payment list to a CSV file
**Plans:** 2/2 plans complete

Plans:
- [x] 06-01-PLAN.md — Data layer: types, listPayments service (JOIN query), Server Action, integration tests, partial index
- [x] 06-02-PLAN.md — UI: PaymentsClient with filter bar, table, pagination, edit/delete actions, CSV export, sidebar unlock

### Phase 7: Daily Collections View
**Goal**: Loan officers can see a date-navigable summary of what was collected on any given day and which active loans are due for payment today
**Depends on**: Phase 6
**Requirements**: COLL-01, COLL-02, COLL-03, COLL-04
**Success Criteria** (what must be TRUE):
  1. User can see today's total collections amount (UGX) and payment count in a summary header on the Daily tab
  2. User can see the per-loan breakdown of payments recorded for the selected day
  3. User can pick any date using a date picker and the summary and breakdown update to reflect that day
  4. User can see a list of active loans that have not received a payment in 30 or more days, indicating they are due today
**Plans:** 2/2 plans complete

Plans:
- [ ] 07-01-PLAN.md — Data layer: types, daily-collections service (timezone-aware), server actions, TanStack Query hooks, unit + integration tests
- [ ] 07-02-PLAN.md — UI: Tab integration in PaymentsClient, DailyCollectionsTab with date picker, summary cards, breakdown table, due-today list, Cypress E2E tests

### Phase 8: Quick-Record Workflow
**Goal**: Loan officers can record a payment for any active loan directly from the Payments page without leaving it, and receive a receipt link immediately after success
**Depends on**: Phase 6
**Requirements**: QREC-01, QREC-02, QREC-03
**Success Criteria** (what must be TRUE):
  1. User can search for an active loan by typing a customer name in an inline combobox and select it without navigating away from /payments
  2. User can submit the payment form in a modal and the payments list refreshes automatically to include the new payment
  3. User sees a receipt link in the success state immediately after recording the payment
  4. User can see a list of recently-collected loans for quick repeat selection, reducing keystrokes for bulk collection days
**Plans:** 2/2 plans complete

Plans:
- [ ] 08-01-PLAN.md — Data layer: types, searchActiveLoans + getRecentlyCollectedLoans services, server actions, revalidatePath("/payments"), unit + integration tests
- [ ] 08-02-PLAN.md — UI: LoanSearchCombobox, QuickRecordDialog with recently-collected chips + success state + receipt link, Cypress E2E tests

### Phase 9: Design System Overhaul — Apply Sovereign Ledger design system across the entire app

**Goal:** Every page in the application renders with the Sovereign Ledger design system — monochromatic surface hierarchy, Electric Blue accent, Geist Mono for all numeric values, sharp corners, no border separators, glassmorphism floating elements
**Requirements**: DS-01, DS-02, DS-03, DS-04, DS-05, DS-06, DS-07, DS-08, DS-09, DS-10, DS-11, DS-12
**Depends on:** Phase 8
**Success Criteria** (what must be TRUE):
  1. globals.css uses Sovereign Ledger OKLCH color tokens with surface hierarchy
  2. All Card components use tonal depth (no ring, no shadow)
  3. All Button components use sharp corners (rounded-sm) and tertiary Electric Blue variant exists
  4. All Dialog/Sheet overlays use glassmorphism (backdrop-blur-24px, bg-white/85)
  5. Sidebar and TopBar have no visible borders (tonal separation only)
  6. Every currency, percentage, count, and timestamp value in the app uses font-mono tabular-nums
  7. Every page heading uses tracking-tight with a label-style subtitle
  8. Full Cypress E2E suite passes with zero failures
**Plans:** 2/6 plans executed

Plans:
- [ ] 09-01-PLAN.md — Design token smoke test + globals.css Sovereign Ledger token rewrite
- [ ] 09-02-PLAN.md — Primitive UI components: card, button, badge, input, table, dialog, sheet
- [ ] 09-03-PLAN.md — Layout components: sidebar, top-bar, app-shell border removal
- [ ] 09-04-PLAN.md — Core page typography: dashboard, customers, loans, payments, watchlist, form pages, loan detail
- [ ] 09-05-PLAN.md — Secondary pages: creditors, expenses, income, transactions, admin
- [ ] 09-06-PLAN.md — Reports, receipts, design-system test enablement, full regression pass

## Progress

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
| 9. Design System Overhaul | 2/6 | In Progress|  | - |
