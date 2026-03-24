---
phase: 6
slug: global-payments-list
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-23
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (unit) + Vitest integration (PGlite) + Cypress (E2E) |
| **Config file** | `vitest.config.ts` (unit), `vitest.integration.config.ts` (integration) |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test && pnpm test:integration` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test && pnpm test:integration`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | PAY-01 | integration | `pnpm test:integration -- --reporter=verbose -t "listPayments"` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | PAY-02 | integration | same suite | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 1 | PAY-03 | integration | same suite | ❌ W0 | ⬜ pending |
| 06-01-04 | 01 | 1 | PAY-04 | integration | same suite | ❌ W0 | ⬜ pending |
| 06-01-05 | 01 | 1 | PAY-05 | integration | same suite | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 2 | PAY-06 | unit (mock) | `pnpm test -- --reporter=verbose -t "editPayment"` | ✅ existing | ⬜ pending |
| 06-02-02 | 02 | 2 | PAY-07 | unit (mock) | `pnpm test -- --reporter=verbose -t "deletePayment"` | ✅ existing | ⬜ pending |
| 06-02-03 | 02 | 2 | PAY-08 | manual | n/a — browser-only DOM API | manual-only | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/services/__integration__/payment.service.test.ts` — extend with `listPayments` suite covering PAY-01 through PAY-05
- [ ] `src/services/__tests__/payment.service.test.ts` — add mock-based unit test for listPayments filter logic

*Existing infrastructure covers PAY-06 and PAY-07 via existing editPayment/deletePayment tests.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CSV export downloads file with correct name and columns | PAY-08 | Uses browser DOM APIs (`URL.createObjectURL`, `document.createElement("a").click()`) not available in Vitest node environment | 1. Open /payments, 2. Apply a date filter, 3. Click Export CSV, 4. Verify file name is `payments-YYYY-MM-DD.csv`, 5. Open file and verify columns: date, customer name, loan reference, amount, interest portion, principal portion, balance after |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
