---
phase: 8
slug: quick-record-workflow
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-23
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (unit/integration), cypress (E2E) |
| **Config file** | `vitest.config.ts`, `vitest.integration.config.ts`, `cypress.config.ts` |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run && npx cypress run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run && npx cypress run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | QREC-01 | unit | `npx vitest run src/services/__tests__/payment.service.test.ts` | ⬜ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | QREC-03 | unit | `npx vitest run src/services/__tests__/payment.service.test.ts` | ⬜ W0 | ⬜ pending |
| 08-01-03 | 01 | 1 | QREC-02 | unit | `npx vitest run src/services/__tests__/payment.service.test.ts` | ⬜ W0 | ⬜ pending |
| 08-02-01 | 02 | 2 | QREC-01 | e2e | `npx cypress run --spec cypress/e2e/quick-record.cy.ts` | ❌ W0 | ⬜ pending |
| 08-02-02 | 02 | 2 | QREC-02 | e2e | `npx cypress run --spec cypress/e2e/quick-record.cy.ts` | ❌ W0 | ⬜ pending |
| 08-02-03 | 02 | 2 | QREC-03 | e2e | `npx cypress run --spec cypress/e2e/quick-record.cy.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `cypress/e2e/quick-record.cy.ts` — E2E test stubs for QREC-01, QREC-02, QREC-03

*Existing test infrastructure (vitest, cypress) covers all framework requirements.*

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
