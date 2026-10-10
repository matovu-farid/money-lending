# Retroactive loan-rate corrections with event locks

**Date:** 2026-10-10

**Status:** Approved conversational design; awaiting written-spec review

## Goal and policy

An applied rate change is a correction of the loan's contractual monthly rate, not a new rate period. For perpetual, fixed-rate, and reducing-balance loans, the latest authorized correction recalculates interest from that loan's recorded `startDate`, even if the record was entered later or backdated. Neither `createdAt` nor the edit timestamp is an interest-effective date. The correction takes effect as soon as the existing authorization/approval path applies it; there is no new waiting period. Previous values and the actor/time of every correction remain visible in the audit history.

To avoid changing an already crystallized allocation, ordinary rate correction is forbidden once **any** of these events has ever occurred on that loan:

1. A payment was recorded, including one subsequently marked wrong or soft-deleted.
2. A loan waiver was recorded, including one subsequently undone or soft-deleted.
3. The loan was rolled over into a successor, including a successor subsequently soft-deleted. A loan *created as a successor* is still eligible to have its own rate corrected until an event on that successor triggers a lock.

The existing operational-loan and permission checks continue to apply. A historical exception after one of these events is handled through a separately reviewed, audited correction, never by bypassing the ordinary rate-change guard.

## Existing paths and problems

The administrator adjustment, immediate rate-change request, and approved request are separate write paths in `src/services/rate-change-request.service.ts`. The approved-request path does not share the immediate/admin apply function. The direct `updateLoan` service also has a rate write, although its public action is disabled. All write paths must use one eligibility rule and one correction operation; a disabled UI action is not a sufficient safeguard.

Current statement and rollover readers differ in their interpretation of rate history: some use only approved requests, some use the current override, and the rollover rate-history reader treats audit timestamps as effective dates. That is inconsistent with the new correction policy and must be reconciled without silently reinterpreting old, settled loans.

## Components and data flow

### 1. One transactional eligibility and apply boundary

Extract a reusable eligibility check that runs **after locking the loan row** with `FOR UPDATE`. It checks all payment and loan-waiver rows for the loan without active/deleted filters, and checks both `status = rolled_over` and any successor row whose `rolledOverFrom` points to it, without a deletion filter. It returns a specific, user-facing reason (`payment`, `waiver`, or `rollover`), not a generic internal error.

Use the same check for administrator adjustments, immediate changes, pending-request creation, and pending-request approval. Recheck on approval even if the request was eligible when submitted. A failed approval leaves the rate and audit unchanged; the pending request can be explicitly rejected through the existing review flow. Preserve existing role permissions, approval thresholds, self-approval prohibition, and rate validation. The internal direct `updateLoan` rate write must be removed or routed through this same guarded operation so it cannot become a bypass.

Payment recording, waiver recording, and rollover creation already lock the loan row before writing their event. The rate-correction transaction must use that same lock, so the winner commits first and the second transaction sees the event or the corrected rate. Any accrual-writing path that can race a correction must use the same serialization or a verified equivalent. No check-then-write outside the transaction is authoritative.

### 2. Correction semantics and audit

After authorization and eligibility, normalize the requested rate and update the loan's effective rate. In the same transaction, append an applied-rate audit record containing the prior effective rate, corrected rate, actor, application time, and an explicit `effectiveFrom = loan.startDate` / correction-semantics marker. The marker distinguishes new retroactive corrections from legacy audits that recorded a change time but not its intended effective time. No rate-period table or retrospective `createdAt` inference is needed. Reject a no-op or an invalid rate without changing the loan, accrual ledger, request status, or audit.

Use one rate-resolution contract for statements, balance/projection readers, payment and waiver quotes, and rollover quotes: after a new correction, the corrected rate is active from this loan's `startDate` for its entire life; older correction audits remain history, not interest-rate transitions. A later eligible correction supersedes the earlier one over that same interval. The rate-history UI shows *when* each correction was made and *from when* it applies, rather than depicting these audits as successive earning periods.

### 3. Accrual and ledger consistency

An eligible loan can still have posted non-cash interest accruals. At the application timestamp, calculate the corrected accrued-interest amount using the same interest engine and loan terms as the statement, compare it with net posted accrual, and post balanced non-cash adjustment entries for the difference in the same transaction. Preserve the original journal entries and never rewrite a cash receipt. If existing journals cannot be reconciled deterministically, reject the ordinary correction and report the exception for audited repair. After commit, the displayed balance, statement, future settlement/rollover quote, and accrual ledger must agree to the app's UGX rounding precision. Repeating a read or recalculation must not create a second adjustment.

## Existing data and rollout

This change defines the meaning of **newly applied** corrections. Existing rate-change audits lack the correction marker; do not silently treat them as retroactive on loans with payments, waivers, or rollovers. Generate a read-only inventory of legacy rate changes and classify eligible uncrystallized loans separately from locked loans. Any production record repair requires a reviewed plan, backup, named actor, balanced non-cash correction, and before/after verification. It is not an automatic deployment migration. The existing rollover-chain correction inventory remains a separate workflow; this feature does not unlock or silently rewrite its blocked chains.

## Error handling and interface

Return a clear error such as “The rate cannot be changed because a payment has been recorded on this loan,” with equivalent wording for a waiver or rollover. The server enforces the rule; the rate-change controls may be disabled with the same explanation when the eligibility state is known. If a pending request becomes ineligible before review, approving it fails without changing the rate; the reviewer can reject it. Preserve the existing approval routing and refresh affected loan, history, balance, and approval views after a successful correction.

## Verification

- Unit tests: effective rate from recorded `startDate` (including backdated issuance), all three loan types, repeated corrections, no-op/invalid values, legacy versus new audit semantics, and UGX rounding.
- Transaction/integration tests: each write path enforces the shared guard; deleted/marked-wrong payments, undone waivers, and deleted rollover successors still lock; a successor loan itself can be corrected before its own first lock event; pending approval rechecks eligibility; competing payment, waiver, rollover, accrual, and rate-change transactions cannot evade the guard.
- Ledger tests: corrected non-cash accrual entries balance; posted and calculated interest reconcile; original Cash entries, payment and waiver rows, and rollover principal are unchanged; a failed reconciliation rolls back the whole correction.
- Cypress E2E tests: each applicable rate-change/approval UI shows the correct state and error, and an eligible backdated loan's statement and rate history show the corrected rate from its recorded start date. No manual visual-verification checkpoint.

## Out of scope

Changing the loan's recorded start date, silently modifying previously paid/waived/rolled-over loans, changing approval permissions, inventing rate changes from audit timestamps, and deploying or writing to production without a reviewed data-correction plan are outside this design.
