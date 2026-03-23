---
phase: 2
slug: loan-operations
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-20
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.0 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test && pnpm cypress run` |
| **Estimated runtime** | ~30 seconds (unit ~5s, E2E ~25s) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test && pnpm cypress run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | LOAN-06 | unit | `pnpm test src/lib/interest/__tests__/engine.test.ts` | ✅ (extend) | ⬜ pending |
| 02-01-02 | 01 | 1 | LOAN-07 | unit | `pnpm test src/services/__tests__/payment.service.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | LOAN-08 | unit | `pnpm test src/lib/interest/__tests__/engine.test.ts` | ✅ (extend) | ⬜ pending |
| 02-01-04 | 01 | 1 | LOAN-09 | unit | `pnpm test src/lib/interest/__tests__/engine.test.ts` | ✅ (extend) | ⬜ pending |
| 02-02-01 | 02 | 2 | RCPT-01 | E2E | `pnpm cypress run --spec cypress/e2e/receipts.cy.ts` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 2 | RCPT-02 | E2E | `pnpm cypress run --spec cypress/e2e/receipts.cy.ts` | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 2 | RCPT-03 | E2E | `pnpm cypress run --spec cypress/e2e/receipts.cy.ts` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 2 | ALRT-02 | manual | N/A — Resend test mode; verify via console log | N/A | ⬜ pending |
| 02-04-01 | 04 | 3 | INFR-04 | unit | `pnpm test src/app/api/cron/__tests__/overdue.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/services/__tests__/payment.service.test.ts` — stubs for LOAN-07 (soft delete, audit with reason, recalculation cascade)
- [ ] `src/app/api/cron/__tests__/overdue.test.ts` — stubs for INFR-04 (endpoint auth, loan query, flagging logic)
- [ ] `cypress/e2e/receipts.cy.ts` — stubs for RCPT-01, RCPT-02, RCPT-03 (receipt pages render, print button enabled/disabled)
- [ ] Extend `src/lib/interest/__tests__/engine.test.ts` with `allocatePayment()` test stubs for LOAN-08/LOAN-09

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Email sent to Admin on payment CUD and disbursement | ALRT-02 | Resend in test mode — no real delivery; verifying email content requires mock or console inspection | 1. Record a payment 2. Check server console for Resend log output 3. Verify email contains actor, loan ref, amount, timestamp |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
