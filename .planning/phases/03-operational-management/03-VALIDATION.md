---
phase: 03
slug: operational-management
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-21
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.0 + Cypress 15.12.0 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test && pnpm test:e2e` |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test && pnpm test:e2e`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | CUST-05 | e2e (Cypress) | `pnpm cypress:run --spec "cypress/e2e/customer-search.cy.ts"` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | CUST-06 | e2e (Cypress) | `pnpm cypress:run --spec "cypress/e2e/customer-status.cy.ts"` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | CUST-07 | e2e (Cypress) | `pnpm cypress:run --spec "cypress/e2e/customer-history.cy.ts"` | ❌ W0 | ⬜ pending |
| TBD | 02 | 1 | RISK-01 | unit (Vitest) | `pnpm test -- --grep "calculateDaysOverdue"` | ❌ W0 | ⬜ pending |
| TBD | 02 | 1 | RISK-02 | unit (Vitest) | `pnpm test -- --grep "watchlist"` | ❌ W0 | ⬜ pending |
| TBD | 02 | 1 | RISK-03 | e2e (Cypress) | `pnpm cypress:run --spec "cypress/e2e/repayment-simulator.cy.ts"` | ❌ W0 | ⬜ pending |
| TBD | 02 | 1 | RISK-04 | unit (Vitest) | `pnpm test -- --grep "simulator allocation"` | ❌ W0 | ⬜ pending |
| TBD | 03 | 2 | ALRT-01 | e2e (Cypress) | `pnpm cypress:run --spec "cypress/e2e/notifications.cy.ts"` | ❌ W0 | ⬜ pending |
| TBD | 04 | 2 | RPTS-01 | e2e (Cypress) | `pnpm cypress:run --spec "cypress/e2e/dashboard.cy.ts"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `cypress/e2e/customer-search.cy.ts` — stubs for CUST-05
- [ ] `cypress/e2e/customer-status.cy.ts` — stubs for CUST-06 (status change + blacklist safeguard)
- [ ] `cypress/e2e/customer-history.cy.ts` — stubs for CUST-07
- [ ] `cypress/e2e/repayment-simulator.cy.ts` — stubs for RISK-03
- [ ] `cypress/e2e/notifications.cy.ts` — stubs for ALRT-01
- [ ] `cypress/e2e/dashboard.cy.ts` — stubs for RPTS-01
- [ ] Unit tests for watchlist service (RISK-01, RISK-02) and simulator allocation (RISK-04)

*Existing infrastructure covers test framework setup — no new framework installation needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Bell icon visual unread badge | ALRT-01 | CSS badge rendering | Navigate to any page as Admin, verify bell shows count |
| Color-coded days overdue badge | RISK-01 | Visual color verification | Check green/yellow/red badges on watchlist with known test data |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
