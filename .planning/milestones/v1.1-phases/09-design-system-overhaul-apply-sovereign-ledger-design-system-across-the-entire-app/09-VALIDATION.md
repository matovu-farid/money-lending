---
phase: 9
slug: design-system-overhaul-apply-sovereign-ledger-design-system-across-the-entire-app
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-23
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Cypress 14.x (E2E) + Vitest (unit) |
| **Config file** | `cypress.config.ts`, `vitest.config.ts` |
| **Quick run command** | `npx cypress run --spec cypress/e2e/design-system.cy.ts` |
| **Full suite command** | `npx cypress run` |
| **Estimated runtime** | ~60 seconds (design-system spec), ~300 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx cypress run --spec cypress/e2e/design-system.cy.ts`
- **After every plan wave:** Run `npx cypress run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | Design tokens | E2E | `npx cypress run --spec cypress/e2e/design-system.cy.ts` | ❌ W0 | ⬜ pending |
| 09-02-01 | 02 | 2 | Card/Button primitives | E2E | `npx cypress run --spec cypress/e2e/design-system.cy.ts` | ❌ W0 | ⬜ pending |
| 09-03-01 | 03 | 3 | Page layouts | E2E | `npx cypress run` | ✅ | ⬜ pending |
| 09-04-01 | 04 | 4 | Full verification | E2E | `npx cypress run` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `cypress/e2e/design-system.cy.ts` — smoke test for CSS custom properties (token values)
- [ ] Verify `globals.css` token layer structure before modifications

*Existing Cypress infrastructure covers all page-level requirements.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification via Cypress computed style assertions.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
