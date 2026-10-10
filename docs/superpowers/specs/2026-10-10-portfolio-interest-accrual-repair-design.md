# Portfolio interest accrual repair

**Date:** 2026-10-10
**Status:** Approved by the request to implement the recommended all-loan approach.

## Problem and scope

Production has 45 active loans, no `Interest Receivable` account and no loan `interest_accrual` journals. The month-end job has therefore skipped accrual. Its source code currently labels the missing account as `revenue`; posting a debit there and a credit to `Interest Earned` would cancel the period's P&L income while the balance sheet independently adds the receivable to assets. Five months of P&L and balance-sheet snapshots (May–September 2026) exist. The earliest currently active loan's effective `start_date` is 2024-11-26.

The user wants the missing-account correction and catch-up for all affected loans, not merely Daglas. The scope is loans and their financial snapshots. Creditor accrual, loan receipts, cash movements, and unresolved rollover-source repairs are not silently included. Blocked loans are reported with reasons; no guessed interest is posted.

## Accounting policy and compatibility

`Interest Receivable` is an asset account. Loan accrual journals debit that asset and credit `Interest Earned` revenue. Payment journals and their Cash legs are not changed by the portfolio accrual. Update every production code path that locates or posts to the account to use `asset`, including month-end accrual, rate correction, waiver reversal, paid-rate repair, and balance-sheet reading. The P&L then includes the credit to earned interest without offsetting it by an asset debit; the balance sheet includes the receivable once. Do not run the broad default-category seeder: it would also enable unrelated creditor accrual accounts. Install exactly one `Interest Receivable` asset account only after the compatible code is deployed, refusing a pre-existing same-name account of another type.

## Preview and eligibility

Create a read-only, deterministic, per-loan/per-period planner. Use loan `start_date` and settlement effective dates, never `created_at`, and the existing statement and ledger rules for the applicable loan type. Walk month ends chronologically from each loan's effective start through the latest closed month, then one current-period as-of instant. Reconcile all recorded payments, waivers, rollover carries, interest journals, and rate-correction markers at each boundary. The preview shows the interest already earned, existing receivable, proposed balanced non-cash journal delta, resulting receivable, and report impact per loan and period. It distinguishes `ready`, `noop`, and `blocked`, with a source fingerprint and policy version. A loan with an unresolved rate repair, ambiguous rollover source, inconsistent journal group, or statement/ledger mismatch is blocked instead of inferred. Historical status is evaluated at each period; current `active` status alone is not proof that a loan was active in a past period. Loan cash and status remain unchanged.

## Apply, reports, and verification

The operator first takes a verified full-data backup, restores it to an isolated database, and rehearses the exact plan. A named authenticated administrator approves the exact preview totals and exceptions. Apply checks the database identity, backup, source fingerprint, plan hash, and approval; it locks and re-reads sources in a serializable transaction. Each posted journal is balanced, non-cash, dated to its reviewed period boundary, and idempotent by durable run identity. Each loan is re-planned after writing and must become `noop`; unexpected differences abort. Do not overwrite a historical financial snapshot until all sources for that period are reconciled. Rebuild eligible May–September snapshots in chronological order and independently compare P&L, balance sheet, and asset/equity balance. If a period remains incomplete, retain its original snapshot and mark it pending rather than publish a partial restatement.

Daglas's stored approval predates the new category and becomes stale when the category enters the planner fingerprint. Regenerate and approve his exact paid-rate plan before applying it. Lydia and all other paid-rate or rollover corrections retain their own approval/source gates. Portfolio accrual does not weaken those gates.
