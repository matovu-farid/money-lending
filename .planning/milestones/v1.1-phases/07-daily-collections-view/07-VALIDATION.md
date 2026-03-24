---
phase: 7
slug: daily-collections-view
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-23
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (unit) + Vitest integration config + Cypress (E2E) |
| **Config file** | `vitest.config.ts` (unit), `vitest.integration.config.ts` (integration), `cypress.config.ts` (E2E) |
| **Quick run command** | `pnpm test src/services/__tests__/daily-collections.service.test.ts` |
| **Full suite command** | `pnpm test && pnpm test:integration` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test src/services/__tests__/daily-collections.service.test.ts`
- **After every plan wave:** Run `pnpm test && pnpm test:integration`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | COLL-01 | unit | `pnpm test src/services/__tests__/daily-collections.service.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 1 | COLL-02 | unit | `pnpm test src/services/__tests__/daily-collections.service.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-03 | 01 | 1 | COLL-04 | unit | `pnpm test src/services/__tests__/daily-collections.service.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-04 | 01 | 1 | COLL-01,COLL-02,COLL-04 | integration | `pnpm test:integration src/services/__integration__/daily-collections.service.test.ts` | ❌ W0 | ⬜ pending |
| 07-02-01 | 02 | 2 | COLL-01 | E2E | `npx cypress run --spec cypress/e2e/daily-collections.cy.ts` | ❌ W0 | ⬜ pending |
| 07-02-02 | 02 | 2 | COLL-02 | E2E | `npx cypress run --spec cypress/e2e/daily-collections.cy.ts` | ❌ W0 | ⬜ pending |
| 07-02-03 | 02 | 2 | COLL-03 | E2E | `npx cypress run --spec cypress/e2e/daily-collections.cy.ts` | ❌ W0 | ⬜ pending |
| 07-02-04 | 02 | 2 | COLL-04 | E2E | `npx cypress run --spec cypress/e2e/daily-collections.cy.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/services/__tests__/daily-collections.service.test.ts` — unit stubs for COLL-01, COLL-02, COLL-04
- [ ] `src/services/__integration__/daily-collections.service.test.ts` — integration stubs for COLL-01, COLL-02, COLL-04 (UTC-noon payment timestamps)
- [ ] `cypress/e2e/daily-collections.cy.ts` — E2E stubs for COLL-01 through COLL-04

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
