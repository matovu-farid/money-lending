# Requirements: Money Lending Management System

**Defined:** 2026-03-24
**Core Value:** A loan officer can register a customer, issue a loan, collect payments, and print a receipt — the lending business is fully operational.

## v1.2 Requirements

Requirements for responsive mobile + desktop milestone. Each maps to roadmap phases.

### Navigation

- [x] **NAV-01**: Mobile bottom tab bar with 5 primary tabs (Dashboard, Customers, Payments, Loans, More)
- [x] **NAV-02**: "More" sheet showing remaining nav items (Creditors, Expenses, Income, Reports, Watchlist)
- [x] **NAV-03**: Sidebar hidden on mobile, visible on desktop (md+ breakpoint)
- [x] **NAV-04**: Active tab state indicator with smooth transitions
- [x] **NAV-05**: Safe-area inset padding for iPhone home indicator

### Responsive Layouts

- [x] **RESP-01**: Dashboard KPI cards and charts reflow to single column on mobile
- [x] **RESP-02**: Data tables switch to stacked card layout on mobile (CSS show/hide, no JS)
- [x] **RESP-03**: All forms render single-column on mobile
- [x] **RESP-04**: Collapsible filter panels on mobile (expanded by default on desktop)
- [x] **RESP-05**: Sticky table headers on scroll (desktop)
- [x] **RESP-06**: Remove hardcoded `p-6` padding — use responsive `p-4 md:p-6`
- [x] **RESP-07**: Responsive card layouts for: Customers, Loans, Payments, Creditors, Expenses, Income, Watchlist

### Touch Optimization

- [x] **TOUCH-01**: All interactive elements meet 44px minimum touch target (WCAG 2.5.8)
- [x] **TOUCH-02**: DrawerDialog component — dialog on desktop, bottom drawer on mobile
- [x] **TOUCH-03**: Swipe gestures for mobile navigation where applicable

### Test Compatibility

- [x] **TEST-01**: Add `data-testid` attributes to nav elements and table rows before layout changes
- [ ] **TEST-02**: All existing Cypress specs pass at default (desktop) viewport after responsive changes
- [x] **TEST-03**: Mobile viewport test blocks added to all existing Cypress spec files
- [x] **TEST-04**: New Cypress specs for bottom tab bar and mobile navigation

## Future Requirements

### Advanced Mobile

- **MOB-01**: Offline mode with service worker caching
- **MOB-02**: Pull-to-refresh on list pages
- **MOB-03**: Push notifications via PWA

## Out of Scope

| Feature | Reason |
|---------|--------|
| Native mobile app (iOS/Android) | Web responsive is sufficient for lending staff |
| PWA install prompt | Deferred — evaluate after responsive launch |
| Offline mode | Not required per project constraints |
| Biometric authentication | Beyond current auth scope |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TEST-01 | Phase 11 | Complete |
| RESP-06 | Phase 11 | Complete |
| NAV-01 | Phase 12 | Complete |
| NAV-02 | Phase 12 | Complete |
| NAV-03 | Phase 12 | Complete |
| NAV-04 | Phase 12 | Complete |
| NAV-05 | Phase 12 | Complete |
| RESP-01 | Phase 13 | Complete |
| RESP-02 | Phase 13 | Complete |
| RESP-07 | Phase 13 | Complete |
| RESP-03 | Phase 14 | Complete |
| RESP-04 | Phase 14 | Complete |
| RESP-05 | Phase 14 | Complete |
| TOUCH-01 | Phase 15 | Complete |
| TOUCH-02 | Phase 15 | Complete |
| TOUCH-03 | Phase 15 | Complete |
| TEST-02 | Phase 16 | Pending |
| TEST-03 | Phase 16 | Complete |
| TEST-04 | Phase 16 | Complete |

**Coverage:**
- v1.2 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-24*
*Last updated: 2026-03-24 — traceability mapped after roadmap creation*
