---
phase: 13
slug: responsive-table-primitive-card-layouts
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-25
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Cypress 15.12.0 (E2E) |
| **Config file** | `cypress.config.ts` |
| **Quick run command** | `npx cypress run --spec cypress/e2e/responsive-layouts.cy.ts` |
| **Full suite command** | `npx cypress run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx cypress run --spec cypress/e2e/responsive-layouts.cy.ts`
- **After every plan wave:** Run `npx cypress run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | RESP-02 | E2E | `npx cypress run --spec cypress/e2e/responsive-layouts.cy.ts` | ❌ W0 | ⬜ pending |
| 13-01-02 | 01 | 1 | RESP-07 | E2E | `npx cypress run --spec cypress/e2e/responsive-layouts.cy.ts` | ❌ W0 | ⬜ pending |
| 13-02-01 | 02 | 2 | RESP-01 | E2E | `npx cypress run --spec cypress/e2e/responsive-layouts.cy.ts` | ❌ W0 | ⬜ pending |
| 13-02-02 | 02 | 2 | RESP-07 | E2E | `npx cypress run --spec cypress/e2e/responsive-layouts.cy.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `cypress/e2e/responsive-layouts.cy.ts` — covers RESP-01, RESP-02, RESP-07 (mobile card + desktop table assertions)

*Existing infrastructure covers test framework setup.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
