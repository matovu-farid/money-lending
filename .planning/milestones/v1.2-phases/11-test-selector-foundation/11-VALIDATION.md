---
phase: 11
slug: test-selector-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-24
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Cypress 14.x (E2E), Vitest (unit) |
| **Config file** | `cypress.config.ts`, `vitest.config.ts` |
| **Quick run command** | `npx cypress run --spec <changed-spec>` |
| **Full suite command** | `npx cypress run` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx cypress run --spec <changed-spec>`
- **After every plan wave:** Run `npx cypress run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | TEST-01 | e2e | `npx cypress run --spec cypress/e2e/payments-list.cy.ts` | ✅ | ⬜ pending |
| 11-01-02 | 01 | 1 | TEST-01 | e2e | `npx cypress run --spec cypress/e2e/admin-panel.cy.ts` | ✅ | ⬜ pending |
| 11-01-03 | 01 | 1 | TEST-01 | e2e | `npx cypress run --spec cypress/e2e/design-system.cy.ts` | ✅ | ⬜ pending |
| 11-02-01 | 02 | 1 | RESP-06 | e2e | `npx cypress run` | ✅ | ⬜ pending |
| 11-03-01 | 03 | 2 | TEST-01, RESP-06 | e2e | `npx cypress run` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test frameworks or stub files needed.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
