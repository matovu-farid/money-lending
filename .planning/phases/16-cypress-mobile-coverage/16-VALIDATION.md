---
phase: 16
slug: cypress-mobile-coverage
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-25
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Cypress 15.12.0 |
| **Config file** | `cypress.config.ts` |
| **Quick run command** | `npx cypress run --spec cypress/e2e/<modified-spec>.cy.ts` |
| **Full suite command** | `npx cypress run` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx cypress run --spec cypress/e2e/<modified-spec>.cy.ts`
- **After every plan wave:** Run `npx cypress run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | TEST-04 | e2e | `npx cypress run --spec cypress/e2e/tab-bar.cy.ts` | ❌ W0 | ⬜ pending |
| 16-02-01 | 02 | 1 | TEST-03 | e2e | `npx cypress run --spec cypress/e2e/dashboard.cy.ts` | ✅ | ⬜ pending |
| 16-02-02 | 02 | 1 | TEST-03 | e2e | `npx cypress run --spec cypress/e2e/loans-list.cy.ts` | ✅ | ⬜ pending |
| 16-02-03 | 02 | 1 | TEST-03 | e2e | `npx cypress run --spec cypress/e2e/payments.cy.ts` | ✅ | ⬜ pending |
| 16-03-01 | 03 | 2 | TEST-02 | e2e | `npx cypress run` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `cypress/e2e/tab-bar.cy.ts` — new file covering TEST-04 (tab bar navigation spec)
- [ ] Mobile viewport `context()` blocks in 25 existing spec files — covers TEST-03

*Cypress + cypress-real-events already installed — no framework setup needed.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
