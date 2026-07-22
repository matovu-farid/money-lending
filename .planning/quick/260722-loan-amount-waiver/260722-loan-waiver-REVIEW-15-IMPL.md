# Adversarial Review — Round 15 (Post-Fix, Tasks 1–3)

**Reviewed:** 2026-07-22  
**Prior:** [REVIEW-14-IMPL](./260722-loan-waiver-REVIEW-14-IMPL.md) (2 CRITICAL)  
**Scope:** Re-trace after R14-C1/C2 + H1–H3 fixes  
**Unit tests:** 260 passing (`src/lib/interest`, `loan-waiver-allocation.test.ts`)

---

## CRITICAL

**None.** R14-C1 and R14-C2 are addressed in code.

| R14 ID | Fix applied |
|--------|-------------|
| **C1** | `computeLoanBalanceData` / `computeSingleLoanBalanceData` accept `queryDb`; `isLoanEconomicallyFullyPaid` passes `tx` to both ledger and accrual paths |
| **C2** | `allocateLoanSettlementAmount` accepts `queryDb`; `waiveLoanAmount`, `recordPayment`, `editPayment`, `unmarkPaymentWrong` pass `tx` |

---

## HIGH

**None new in Tasks 1–3 scope.** Carry-forward items remain **planned Tasks 4–10** (not regressions):

| ID | Item | Status |
|----|------|--------|
| R14-H4 | `deleteLoan` waiver reversal | Task 4 — not built |
| R14-H5 | Actions / permission gate on service | Task 4 — not built |
| R13-H1 | Accrual cron re-fetch inside lock | Task 7 |
| R13-H2 | Transaction report redaction (product Q) | Task 6 |

### R14-H1 / H2 / H3 — fix verification

| ID | Fix |
|----|-----|
| **H1** | `settlementKind: "waiver"` uses `paymentNumber = max(activePayments.length, 1)` (no schedule advance) |
| **H2** | `clampAllocationToUnpaidInterest` caps engine interest at `info.unpaidInterest`, re-splits remainder to principal |
| **H3** | `unmarkPaymentWrong` promote uses `isLoanEconomicallyFullyPaid(..., tx)` |

---

## MEDIUM

| ID | Finding | Action |
|----|---------|--------|
| **R15-M1** | Integration tests still require migration 0028 + `vitest.integration.config.ts` run | Run before marking Task 3 verified in prod-like env |
| **R15-M2** | `collateral-settlement.service.ts` still payment-only last-date (`computeAccruedInterest`) | Task 7 |
| **R15-M3** | Penalty cron / `shouldResetPenaltyWaiver` + batch settlement events | Task 10 |
| **R15-M4** | No UI, actions, collection, Cypress, dashboard copy | Tasks 4–10 |
| **R15-M5** | Waiver error shapes inconsistent (`ValidationError` class vs plain `{ _tag }`) | Normalize in Task 4 actions layer |

---

## LOW

| ID | Finding |
|----|---------|
| **R15-L1** | Waiver `isLoanEconomicallyFullyPaid` uses raw `waiverDate`; allocation uses `endOfDay(waiverDate)` — harmless in practice (same-day journals) |
| **R15-L2** | `refresh_loan_balance()` SQL `unpaid_interest` from Interest Earned ledger ≠ accrual engine | Reconcile script Task 9 |
| **R15-L3** | `getLastPaymentDate` re-export only — no stray callers remain | OK |

---

## Fix verification checklist

| Check | Result |
|-------|--------|
| Settlement date includes waivers | ✅ |
| Point-in-time `asOf` on ledger reads | ✅ |
| Shared loan-type allocator | ✅ |
| Tx-scoped reads in waiver + payment txs | ✅ |
| Interest cap at accrual unpaid | ✅ |
| Waiver auto-post (Loan Losses, no Cash) | ✅ |
| Journal delete guards | ✅ |
| `loan:waiver` admin-only | ✅ |
| Unit tests green | ✅ 260 |
| Integration tests green | ⏳ needs migrate |

---

## Convergence status

| Round | Focus | CRITICAL | Verdict |
|-------|-------|----------|---------|
| 14 | Implementation (pre-fix) | 2 | Fix required |
| **15** | **Implementation (post-fix)** | **0** | **Tasks 1–3 converged — stop impl review loops** |

**Next:** Execute Task 4 (actions, collection, `deleteLoan` waiver reversal, `previewWaiverAllocationAction`), then Task 5 UI. Re-run implementation review after Task 4 if desired.

---

## Files changed in R14 fix pass

- `src/lib/interest/loanBalanceData.ts` — `queryDb` threading
- `src/lib/interest/engine-server.ts` — `queryDb`, `settlementKind`, interest clamp
- `src/services/payment.service.ts` — `tx` on allocator + economic check
- `src/services/loan-waiver.service.ts` — `tx` + `settlementKind: "waiver"`
- `src/lib/interest/__tests__/loanBalanceData.test.ts` — mock update
