# Requirements: Money Lending Management System

**Defined:** 2026-03-23
**Core Value:** A loan officer can register a customer, issue a loan, collect payments, and print a receipt — the lending business is fully operational.

## v1.1 Requirements

Requirements for the Payments milestone. Each maps to roadmap phases.

### Payments List

- [ ] **PAY-01**: User can view a paginated list of all payments across all loans
- [ ] **PAY-02**: User can see customer name, loan reference, amount, date, and allocation breakdown for each payment
- [ ] **PAY-03**: User can filter payments by date range
- [ ] **PAY-04**: User can filter payments by amount range
- [ ] **PAY-05**: User can search payments by customer name
- [ ] **PAY-06**: User can edit a payment directly from the global list (admin+ only)
- [ ] **PAY-07**: User can delete a payment directly from the global list (admin+ only)
- [ ] **PAY-08**: User can export the filtered payment list to CSV

### Daily Collections

- [ ] **COLL-01**: User can view today's total collections amount and count
- [ ] **COLL-02**: User can view per-loan collection breakdown for a given day
- [ ] **COLL-03**: User can pick a date to view that day's collections
- [ ] **COLL-04**: User can see which active loans are due for payment today (30-day cycle indicator)

### Quick Record

- [ ] **QREC-01**: User can record a payment by searching and selecting a loan without leaving the payments page
- [ ] **QREC-02**: User can see a receipt link after successfully recording a payment
- [ ] **QREC-03**: User can see a list of recently-collected loans for quick repeat selection

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
| PAY-01 | — | Pending |
| PAY-02 | — | Pending |
| PAY-03 | — | Pending |
| PAY-04 | — | Pending |
| PAY-05 | — | Pending |
| PAY-06 | — | Pending |
| PAY-07 | — | Pending |
| PAY-08 | — | Pending |
| COLL-01 | — | Pending |
| COLL-02 | — | Pending |
| COLL-03 | — | Pending |
| COLL-04 | — | Pending |
| QREC-01 | — | Pending |
| QREC-02 | — | Pending |
| QREC-03 | — | Pending |

**Coverage:**
- v1.1 requirements: 15 total
- Mapped to phases: 0
- Unmapped: 15

---
*Requirements defined: 2026-03-23*
*Last updated: 2026-03-23 after initial definition*
