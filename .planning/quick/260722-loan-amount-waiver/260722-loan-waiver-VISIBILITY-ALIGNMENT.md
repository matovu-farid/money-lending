# Visibility Alignment — Loan Amount Waiver Plan

**Date:** 2026-07-22  
**Visibility branch:** `feat/rolled-over-loan-visibility` (shipped)  
**Plan:** `260722-loan-waiver-PLAN.md`

---

## Summary

Rolled-over loan visibility is now implemented. The waiver plan **depends on it** and must reuse its shared helpers — not re-implement raw status checks.

---

## Shipped primitives (use these)

| Helper | Location | Waiver usage |
|--------|----------|--------------|
| `assertLoanOperational` | `src/lib/loan-visibility.ts` | Entry guard in `waiveLoanAmount` |
| `isLoanReadOnly` | `src/lib/loan-visibility.ts` | UI gate: `!readOnly && has("loan:waiver")` |
| `isOperationalLoan` | `src/lib/loan-visibility.ts` | Already in `computeLoanBalanceData` — historical loans zeroed |
| `maybeUpdateLoanStatusAfterPayment` | `src/services/payment.service.ts` | Full economic payoff → `fully_paid` + cancel rate-change requests |
| `operationalLoanCollection` | `src/collections/operational-loans.ts` | Watchlist/pickers; subscribe to `loan_waivers` changes |
| `invalidateLendingProjections` | `src/lib/cache-invalidation.ts` | Already invalidates `loans.operational` |

---

## Plan patches applied

1. Migration **`0028_loan_waivers.sql`** (0027 taken by `loans_rolled_over_from_idx`)
2. Design decision **#9** — visibility integration contract
3. Task 3 — explicit imports + integration tests for terminal-status rejection and rate-change cancel
4. Task 4 — `operational-loans.ts` table subscriptions for `loan_waivers`
5. Task 5 — `!readOnly && has("loan:waiver")` instead of `status === "active"`
6. Task 10 — `LoanSearchCombobox` already on `useOperationalLoansWithBalances`; fix `outstandingBalance` display
7. Success criteria — visibility helpers **required**, not optional

---

## Behavioral expectations after waiver

- **Partial waiver on active loan:** stays operational; balances refresh via settlement date + ledger
- **Full waiver → fully_paid:** loan drops from operational watchlist/pickers (same as payment closure)
- **Attempt on rolled_over / settled_collateral / fully_paid:** `ValidationError` from `assertLoanOperational`
- **No backdating:** waiver always posts at submit time; visibility does not change this

---

## Errata

**REVIEW-3-FINAL** stated "No waiver interaction" with visibility plan — **superseded**. Waiver must integrate with visibility helpers (R11-2, R19-1, R21-1 from visibility plan).
