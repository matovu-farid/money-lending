# Requirements: Money Lending Management System

**Defined:** 2026-03-23
**Core Value:** A loan officer can register a customer, issue a loan, collect payments, and print a receipt — the lending business is fully operational.

## v1.1 Requirements

Requirements for the Payments milestone. Each maps to roadmap phases.

### Payments List

- [x] **PAY-01**: User can view a paginated list of all payments across all loans
- [x] **PAY-02**: User can see customer name, loan reference, amount, date, and allocation breakdown for each payment
- [x] **PAY-03**: User can filter payments by date range
- [x] **PAY-04**: User can filter payments by amount range
- [x] **PAY-05**: User can search payments by customer name
- [ ] **PAY-06**: User can edit a payment directly from the global list (admin+ only)
- [ ] **PAY-07**: User can delete a payment directly from the global list (admin+ only)
- [ ] **PAY-08**: User can export the filtered payment list to CSV

### Daily Collections

- [x] **COLL-01**: User can view today's total collections amount and count
- [x] **COLL-02**: User can view per-loan collection breakdown for a given day
- [x] **COLL-03**: User can pick a date to view that day's collections
- [x] **COLL-04**: User can see which active loans are due for payment today (30-day cycle indicator)

### Quick Record

- [x] **QREC-01**: User can record a payment by searching and selecting a loan without leaving the payments page
- [x] **QREC-02**: User can see a receipt link after successfully recording a payment
- [x] **QREC-03**: User can see a list of recently-collected loans for quick repeat selection

### Design System Overhaul

- [x] **DS-01**: App uses Sovereign Ledger oklch color token palette (off-white background, true black primary, Electric Blue accent)
- [x] **DS-02**: All border-radius values use sharp financial terminal feel (0.5rem base)
- [x] **DS-03**: Card components have no ring, rounded-lg corners
- [x] **DS-04**: Button components use rounded-sm with tertiary variant available
- [x] **DS-05**: Table components use ghost borders and label typography headers
- [x] **DS-06**: Dialog and Sheet components use glassmorphism overlay
- [x] **DS-07**: Layout chrome (sidebar, top-bar) uses tonal separation instead of border lines
- [x] **DS-08**: All page headings use tracking-tight letter spacing
- [x] **DS-09**: All page subtitles use label typography (text-xs font-semibold uppercase tracking-wider)
- [x] **DS-10**: All numeric/currency values use font-mono tabular-nums
- [x] **DS-11**: Print media resets tokens for receipt printing
- [x] **DS-12**: Cypress design-system smoke test validates all token assertions

## Future Requirements

### Payments (v2+)

- **PAY-09**: User can bulk-record multiple payments in a single transaction
- **PAY-10**: User can import payments from CSV
- **PAY-11**: User can view a payment reconciliation report (collected vs expected)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Payment scheduling / future payments | Perpetual loan model has no fixed schedule — payments are ad-hoc |
| SMS payment reminders | SMS notifications excluded from project scope |
| Mobile money integration | Platform integrations excluded from project scope |
| Payment method tracking (cash/mobile/bank) | Schema change deferred — not needed for v1.1 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PAY-01 | Phase 6 | Complete |
| PAY-02 | Phase 6 | Complete |
| PAY-03 | Phase 6 | Complete |
| PAY-04 | Phase 6 | Complete |
| PAY-05 | Phase 6 | Complete |
| PAY-06 | Phase 10 | Pending |
| PAY-07 | Phase 10 | Pending |
| PAY-08 | Phase 10 | Pending |
| COLL-01 | Phase 7 | Complete |
| COLL-02 | Phase 7 | Complete |
| COLL-03 | Phase 7 | Complete |
| COLL-04 | Phase 7 | Complete |
| QREC-01 | Phase 8 | Complete |
| QREC-02 | Phase 8 | Complete |
| QREC-03 | Phase 8 | Complete |
| DS-01 | Phase 9 | Complete |
| DS-02 | Phase 9 | Complete |
| DS-03 | Phase 9 | Complete |
| DS-04 | Phase 9 | Complete |
| DS-05 | Phase 9 | Complete |
| DS-06 | Phase 9 | Complete |
| DS-07 | Phase 9 | Complete |
| DS-08 | Phase 9 | Complete |
| DS-09 | Phase 9 | Complete |
| DS-10 | Phase 9 | Complete |
| DS-11 | Phase 9 | Complete |
| DS-12 | Phase 9 | Complete |

**Coverage:**
- v1.1 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0

---
*Requirements defined: 2026-03-23*
*Last updated: 2026-03-23 — traceability complete after roadmap creation*
