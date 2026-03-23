---
phase: 4
slug: financial-reporting
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-21
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.0 + Cypress |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test && pnpm cypress:run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test && pnpm cypress:run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 4-01-01 | 01 | 1 | CRED-01 | unit | `pnpm test src/services/__tests__/creditor.service.test.ts` | W0 | pending |
| 4-01-02 | 01 | 1 | CRED-04 | unit | `pnpm test src/services/__tests__/creditor.service.test.ts` | W0 | pending |
| 4-01-03 | 01 | 1 | FINC-01 | unit | `pnpm test src/services/__tests__/payment.service.test.ts` | extend | pending |
| 4-02-01 | 02 | 2 | CRED-03 | unit | `pnpm test src/services/__tests__/creditor.service.test.ts` | W0 | pending |
| 4-02-02 | 02 | 2 | CRED-04 | unit | `pnpm test src/services/__tests__/creditor.service.test.ts` | W0 | pending |
| 4-03-01 | 03 | 2 | FINC-02 | unit | `pnpm test src/services/__tests__/transaction.service.test.ts` | W0 | pending |
| 4-04-01 | 04 | 3 | CRED-01,02 | tsc | `npx tsc --noEmit` | N/A | pending |
| 4-04-02 | 04 | 3 | CRED-04,05 | tsc | `npx tsc --noEmit` | N/A | pending |
| 4-04-03 | 04 | 3 | CRED-01 | e2e | `pnpm cypress:run --spec cypress/e2e/creditors.cy.ts` | W0 (created in Task 3) | pending |
| 4-05-01 | 05 | 3 | FINC-01,02 | tsc | `npx tsc --noEmit` | N/A | pending |
| 4-06-01 | 06 | 3 | RPTS-02,03,04 | unit | `pnpm test src/services/__tests__/report.service.test.ts` | W0 | pending |
| 4-07-01 | 07 | 4 | RPTS-02,03,04,05 | tsc | `npx tsc --noEmit` | N/A | pending |
| 4-07-02 | 07 | 4 | RPTS-05 | integration | Route Handler export test | W0 | pending |
| 4-08-01 | 08 | 5 | CRED-06 | tsc | `npx tsc --noEmit` | N/A | pending |
| 4-08-02 | 08 | 5 | full | checkpoint | Human verification | N/A | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `src/services/__tests__/creditor.service.test.ts` — stubs for CRED-03, CRED-04, creditor repayment allocation
- [ ] `src/services/__tests__/report.service.test.ts` — stubs for RPTS-03 P&L math, RPTS-04 balance sheet identity
- [ ] `cypress/e2e/creditors.cy.ts` — smoke test for creditor registration and dashboard (created in Plan 04, Task 3)
- [ ] Extend `src/services/__tests__/payment.service.test.ts` — add test for auto-posting to transaction log (FINC-01)

*Existing test infrastructure covers the interest engine and core services — only creditor/report/transaction tests are new gaps.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PDF opens/prints correctly | RPTS-05 | Visual formatting check | Download PDF, open in viewer, verify layout |
| Excel formatting intact | RPTS-05 | Visual formatting check | Download Excel, open in Excel/LibreOffice, verify columns/styles |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
