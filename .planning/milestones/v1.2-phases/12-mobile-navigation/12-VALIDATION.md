---
phase: 12
slug: mobile-navigation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-25
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Cypress 15.12.0 (E2E) + Vitest 4.1.0 (unit) |
| **Config file** | `cypress.config.ts` |
| **Quick run command** | `npx cypress run --spec cypress/e2e/mobile-navigation.cy.ts` |
| **Full suite command** | `npx cypress run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx cypress run --spec cypress/e2e/mobile-navigation.cy.ts`
- **After every plan wave:** Run `npx cypress run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | NAV-01 | E2E | `npx cypress run --spec cypress/e2e/mobile-navigation.cy.ts` | ❌ W0 | ⬜ pending |
| 12-01-02 | 01 | 1 | NAV-02 | E2E | `npx cypress run --spec cypress/e2e/mobile-navigation.cy.ts` | ❌ W0 | ⬜ pending |
| 12-01-03 | 01 | 1 | NAV-03 | E2E | `npx cypress run --spec cypress/e2e/mobile-navigation.cy.ts` | ❌ W0 | ⬜ pending |
| 12-01-04 | 01 | 1 | NAV-04 | E2E | `npx cypress run --spec cypress/e2e/mobile-navigation.cy.ts` | ❌ W0 | ⬜ pending |
| 12-01-05 | 01 | 1 | NAV-05 | E2E | `npx cypress run --spec cypress/e2e/mobile-navigation.cy.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `cypress/e2e/mobile-navigation.cy.ts` — stubs for NAV-01 through NAV-05

*Existing Cypress infrastructure covers framework needs. Only the spec file is missing.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| iPhone notch/home indicator clearance | NAV-05 | `env(safe-area-inset-bottom)` resolves to 0 in headless browsers; real device needed for visual confirmation | Open on iPhone Safari, verify tab bar content doesn't overlap home indicator |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
