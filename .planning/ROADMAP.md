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

- [ ] **Phase 6: Global Payments List** - Paginated, searchable, filterable payments table across all loans with edit, delete, and CSV export
- [ ] **Phase 7: Daily Collections View** - Date-navigable daily summary showing total collected, payment count, and active loans due for payment today
- [ ] **Phase 8: Quick-Record Workflow** - Inline payment recording from the Payments page without navigating to a loan

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
**Plans:** 1/2 plans executed

Plans:
- [ ] 06-01-PLAN.md — Data layer: types, listPayments service (JOIN query), Server Action, integration tests, partial index
- [ ] 06-02-PLAN.md — UI: PaymentsClient with filter bar, table, pagination, edit/delete actions, CSV export, sidebar unlock

### Phase 7: Daily Collections View
**Goal**: Loan officers can see a date-navigable summary of what was collected on any given day and which active loans are due for payment today
**Depends on**: Phase 6
**Requirements**: COLL-01, COLL-02, COLL-03, COLL-04
**Success Criteria** (what must be TRUE):
  1. User can see today's total collections amount (UGX) and payment count in a summary header on the Daily tab
  2. User can see the per-loan breakdown of payments recorded for the selected day
  3. User can pick any date using a date picker and the summary and breakdown update to reflect that day
  4. User can see a list of active loans that have not received a payment in 30 or more days, indicating they are due today
**Plans**: TBD

Plans:
- [ ] 07-01: Data layer — DailyCollectionsSummary type, getDailyCollections service (timezone-aware), getDailyCollectionsAction, use-daily-collections hook
- [ ] 07-02: UI — DailyCollectionsTab with date picker, summary stats, due-today list with days-since-last-payment column

### Phase 8: Quick-Record Workflow
**Goal**: Loan officers can record a payment for any active loan directly from the Payments page without leaving it, and receive a receipt link immediately after success
**Depends on**: Phase 6
**Requirements**: QREC-01, QREC-02, QREC-03
**Success Criteria** (what must be TRUE):
  1. User can search for an active loan by typing a customer name in an inline combobox and select it without navigating away from /payments
  2. User can submit the payment form in a modal and the payments list refreshes automatically to include the new payment
  3. User sees a receipt link in the success state immediately after recording the payment
  4. User can see a list of recently-collected loans for quick repeat selection, reducing keystrokes for bulk collection days
**Plans**: TBD

Plans:
- [ ] 08-01: Data layer and action updates — searchActiveLoansAction, extend recordPaymentAction to revalidate /payments, active-loan guard
- [ ] 08-02: UI — LoanSearchCombobox primitive, QuickRecordDialog with success state and receipt link, recently-collected list

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 7/7 | Complete | 2026-03-20 |
| 2. Loan Operations | v1.0 | 4/4 | Complete | 2026-03-20 |
| 3. Operational Management | v1.0 | 4/4 | Complete | 2026-03-21 |
| 4. Financial Reporting | v1.0 | 8/8 | Complete | 2026-03-21 |
| 5. Optimistic Updates & UX | v1.0 | 4/4 | Complete | 2026-03-22 |
| 6. Global Payments List | 1/2 | In Progress|  | - |
| 7. Daily Collections View | v1.1 | 0/2 | Not started | - |
| 8. Quick-Record Workflow | v1.1 | 0/2 | Not started | - |
