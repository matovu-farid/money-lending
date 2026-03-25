---
phase: 15
slug: touch-optimization
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-25
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Cypress 15.12.0 |
| **Config file** | `cypress.config.ts` |
| **Quick run command** | `npx cypress run --spec cypress/e2e/touch-optimization.cy.ts` |
| **Full suite command** | `npx cypress run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx cypress run --spec cypress/e2e/touch-optimization.cy.ts`
- **After every plan wave:** Run `npx cypress run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 15-01-01 | 01 | 1 | TOUCH-01 | e2e | `npx cypress run --spec cypress/e2e/touch-optimization.cy.ts` | ❌ W0 | ⬜ pending |
| 15-01-02 | 01 | 1 | TOUCH-01 | e2e | `npx cypress run --spec cypress/e2e/touch-optimization.cy.ts` | ❌ W0 | ⬜ pending |
| 15-02-01 | 02 | 1 | TOUCH-02 | e2e | `npx cypress run --spec cypress/e2e/touch-optimization.cy.ts` | ❌ W0 | ⬜ pending |
| 15-02-02 | 02 | 1 | TOUCH-02 | e2e | `npx cypress run --spec cypress/e2e/touch-optimization.cy.ts` | ❌ W0 | ⬜ pending |
| 15-03-01 | 03 | 2 | TOUCH-03 | e2e | `npx cypress run --spec cypress/e2e/touch-optimization.cy.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `cypress/e2e/touch-optimization.cy.ts` — stubs for TOUCH-01, TOUCH-02, TOUCH-03
- [ ] Existing infrastructure covers test framework (Cypress already installed)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Swiping MoreSheet does not trigger browser back navigation | TOUCH-03 | Browser navigation gestures cannot be asserted in Cypress | Open MoreSheet on physical device, swipe down to dismiss, verify no browser back triggered |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
