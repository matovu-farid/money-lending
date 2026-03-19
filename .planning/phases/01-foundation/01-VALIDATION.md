---
phase: 1
slug: foundation
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-19
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (Wave 0 installs) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 0 | INFR-01 | infra | `npx drizzle-kit generate --check` | W0 | pending |
| 1-01-02 | 03 | 2 | AUTH-01 | unit | `npx vitest run src/proxy.ts` | W0 | pending |
| 1-01-03 | 03 | 2 | AUTH-02 | unit | `npx vitest run src/lib/auth.ts` | W0 | pending |
| 1-01-04 | 03 | 2 | AUTH-03 | unit | `npx vitest run src/lib/permissions.ts` | W0 | pending |
| 1-01-05 | 03 | 2 | AUTH-04 | unit | `npx tsc --noEmit` | W0 | pending |
| 1-01-06 | 03 | 2 | AUTH-05 | unit | `npx vitest run src/app/api/users` | W0 | pending |
| 1-02-01 | 04 | 3 | CUST-01 | unit | `npx vitest run src/services/__tests__/customer.service.test.ts` | W0 | pending |
| 1-02-02 | 04 | 3 | CUST-02 | unit | `npx vitest run src/services/__tests__/customer.service.test.ts` | W0 | pending |
| 1-02-03 | 05 | 3 | CUST-03 | unit | `npx vitest run src/services/__tests__/loan.service.test.ts` | W0 | pending |
| 1-02-04 | 05 | 3 | CUST-04 | unit | `npx vitest run src/services/__tests__/loan.service.test.ts` | W0 | pending |
| 1-03-01 | 05 | 3 | LOAN-01 | unit | `npx vitest run src/services/__tests__/loan.service.test.ts` | W0 | pending |
| 1-03-02 | 05 | 3 | LOAN-02 | unit | `npx vitest run src/services/__tests__/loan.service.test.ts` | W0 | pending |
| 1-03-03 | 02 | 2 | LOAN-03 | unit | `npx vitest run src/lib/interest/__tests__/engine.test.ts` | W0 | pending |
| 1-03-04 | 02 | 2 | LOAN-04 | unit | `npx vitest run src/lib/interest/__tests__/engine.test.ts` | W0 | pending |
| 1-03-05 | 05 | 3 | LOAN-05 | unit | `npx vitest run src/services/__tests__/loan.service.test.ts` | W0 | pending |
| 1-03-06 | 02 | 2 | LOAN-10 | unit | `npx vitest run src/lib/interest/__tests__/engine.test.ts` | W0 | pending |
| 1-03-07 | 05 | 3 | LOAN-11 | unit | `npx vitest run src/app/api/settings` | W0 | pending |
| 1-04-01 | 04 | 3 | INFR-02 | unit | `npx vitest run src/services/__tests__/customer.service.test.ts` | W0 | pending |
| 1-04-02 | 01 | 1 | INFR-05 | unit | `npx tsc --noEmit` | W0 | pending |
| 1-04-03 | 01 | 1 | INFR-06 | unit | `npx tsc --noEmit` | W0 | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — vitest configuration with path aliases matching tsconfig
- [ ] `src/lib/interest/__tests__/engine.test.ts` — stubs for LOAN-03, LOAN-04, LOAN-10, LOAN-11
- [ ] `src/services/__tests__/customer.service.test.ts` — stubs for CUST-01, CUST-02
- [ ] `src/services/__tests__/loan.service.test.ts` — stubs for LOAN-01, CUST-03, CUST-04, INFR-01

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Role promotion enforced without page refresh | AUTH-03 | Requires live browser session + WS invalidation | Login as Loan Officer, open two tabs; in a second session promote the user; confirm the first tab's next API call returns 401 or restricted response |
| Better Auth RBAC blocks upward self-promotion | AUTH-05 | Requires live HTTP call with session token | Use curl with a Loan Officer session token to call the role-assign endpoint promoting themselves to Admin; confirm 403 |
| Login activity visible in admin panel | AUTH-04 | Requires live admin UI + session table data | Login as Admin, navigate to /admin, confirm "Last Active" column shows session-based dates for each user |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
