# Rollover-chain correction design

**Date:** 2026-10-09

**Status:** Proposed for written review

## Goal and evidence

Use one repeatable calculation and correction workflow for every loan rollover, beginning with Lukwago Samuel's chain. A read-only inventory of the configured database found 13 non-deleted successor links across eight customers and one deleted successor link. Ten live links involve a payment or waiver on either side of the link; two successor loans are fully paid or settled with collateral. The deleted link is included in the audit but is not revived.

Samuel's Aug 28 → Sep 18 → Oct 1 → Oct 8 chain reproduces two defects: the carried balance was quoted as of entry time rather than the successor's effective `start_date`, and interest previously capitalized into successor principal was treated as if it were a cash interest payment. The earlier statement/balance display correction is uncommitted local work and does not alter persisted principal, `rollover_amount`, or journal entries.

## Contractual calculation policy

- The recorded loan `start_date` is the effective rollover date. A disputed date is an exception for review, not a guessed correction.
- Evaluate predecessor principal and **unpaid** interest immediately before that date, using its recorded rate history, payments, waivers, and penalty terms. The first non-rollover loan keeps its contractual minimum interest period; rolled-over successors accrue for actual elapsed days. Apply the existing UGX rounding rule at each rollover, not only at the end of a chain.
- `newPrincipal = freshCash + carriedPrincipal + carriedInterest`. Capitalized interest is **not** a payment. The issuance fee is accounted for separately and is not silently rolled into principal.
- Stop predecessor accrual on its rollover date. A historical statement must not present subsequent accrual as collectible on a closed predecessor.
- Cash payment amounts and dates remain historical facts. Replaying a chain may change the split between interest and principal; it must not invent, delete, or alter cash receipts.

## Components and data flow

### 1. Authoritative future rollover quote

The new-loan form may display a preview, but the server must recalculate carried principal and interest inside the same transaction that locks the active predecessor and creates the successor. It uses the submitted effective `startDate`, not `new Date()` or a client-supplied carry. If payments, waivers, rate changes, or other balance-changing events occur **after** that effective date on the predecessor, reject the backdated rollover for manual resolution rather than stranding those events on a closed loan. The server returns the authoritative breakdown for the receipt/audit log.

### 2. Pure chain planner

`planRolloverCorrection(snapshot, policyVersion)` is a deterministic, read-only calculation. A snapshot contains one customer's complete predecessor-to-successor chain, original loan terms and dates, approved rate history, all real payments and waivers, relevant ledger allocations and rollover journals, loan statuses, and deletion markers. Walk the chain chronologically, recalculating each closing balance and propagating its corrected successor principal into subsequent accrual and payment allocations. Do not apply a correction to a single link without propagating downstream.

The output is a versioned `CorrectionPlan`: immutable input fingerprint, each loan's original and proposed principal/rollover amount, fresh cash, carried principal/interest, affected payment allocations, proposed balanced journal reversals and replacements, status, confidence classification, and reasoned exceptions. A dry-run renderer exports a per-chain and portfolio summary without personally identifying details by default. Running the planner twice on the same snapshot yields the same plan; running it on an already-corrected snapshot yields zero change.

Classification:

- **Ready:** all source events and journals reconcile; the successor chain remains operational and no contractual ambiguity exists.
- **Review:** payments, waivers, closure, rate changes, or source-document discrepancies require an explicit check of the replay and proposed accounting. A review case is not silently skipped from the portfolio report.
- **Blocked:** missing or contradictory events, orphaned journals, deleted successors, or failed ledger invariants. A blocked case is audit-only until resolved.

Payments/waivers and closed status alone do not make a chain permanently uncorrectable: the same planner calculates it, but the apply step requires approval of its specific plan. The deleted successor is always audit-only unless a separate restoration decision is made.

### 3. Transactional, idempotent applier

`applyRolloverCorrection(planId, actorId)` accepts a previously reviewed plan. Within one database transaction, lock the chain and relevant journals, verify the stored fingerprint still matches, and reject a stale or blocked plan. Update the affected loan principal and `rollover_amount` fields, write balanced compensating/replacement journal entries for rollover interest, principal transfer, and changed payment allocation, and record a durable correction-run ID plus before/after audit values. Never rewrite or delete original cash receipts or original journal rows; preserve them for traceability. Never change `fully_paid`, `settled_with_collateral`, `rolled_over`, or deleted status as a side effect. A unique correction-run key makes a repeated apply a no-op; a new input fingerprint requires a new dry run and review.

The application exposes no bulk live-write switch until the planner and applier pass tests. Samuel's plan is applied and verified first; the same function then processes the remaining **reviewed** plans. Each chain is its own transaction, so one failure cannot partially alter another customer's chain.

## Invariants and safety gates

Before and after each apply, verify:

1. The chain has one chronological predecessor path and no missing live successor.
2. Each successor's corrected principal equals fresh cash plus corrected carried principal and interest.
3. Every posted journal group balances; a rolled-over predecessor's receivable is closed and the successor's receivable matches corrected principal less actual principal repayments/waivers.
4. Total cash received, cash disbursed, issuance fees, payment dates, and loan statuses are unchanged.
5. A second run proposes no further adjustment and creates no duplicate journals.

Failed checks roll back that entire chain and report the exact exception. Production application requires a database snapshot, a reviewed dry-run report, an identified actor, and a rollback procedure based on compensating entries. The database identity must be verified before either dry run or apply; test and production URLs must never be interchangeable by default.

## Verification and rollout

1. Add failing unit tests for effective-date quotes, minimum period, capitalized-interest isolation, multi-hop propagation, rounding, payments, waivers, rate changes, closed and deleted loans, stale-plan rejection, and idempotence.
2. Add integration tests against isolated PostgreSQL for balanced journal correction, unchanged cash, payment allocation, status preservation, atomic rollback, and rerun behavior. Add Cypress coverage for the new-loan preview/authoritative result and the Samuel-style backdated rollover; no manual visual checkpoint.
3. Produce and review the dry-run for Samuel. Compare its proposed Oct 8 principal against the conditional UGX 33,363,461 calculation from recorded dates and terms; investigate any difference rather than hard-coding that number.
4. Produce a portfolio dry-run covering all 13 live links and the deleted link, reporting every ready, review, and blocked case. Reconcile counts and ledger totals against the pre-run snapshot.
5. Apply Samuel, verify ledger and UI, then apply each remaining approved plan. Re-run the inventory and planner to confirm no unapplied ready correction remains. Review cases remain visible until explicitly resolved; no blanket rewrite of paid or settled debt.

## Out of scope

Changing the contractual interest rate or effective date without documentary review, reopening paid/settled loans automatically, recreating deleted loans, changing creditor data, and deploying or writing to production before dry-run review are outside this design.
