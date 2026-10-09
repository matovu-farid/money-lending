# Rollover correction runbook

The historical correction is a per-chain operation, not a portfolio-wide rewrite. The read-only planner is `planRolloverCorrection` in `src/lib/interest/rollover-correction.ts`; the production loader, approval, and applier are in `src/services/rollover-correction*.service.ts`. No public action or bulk apply command is exposed. The maintenance command accepts only one exact plan hash per invocation.

## Before any live write

1. Confirm the connected host, database, current migration level, and actor identity independently. Check that `DATABASE_URL_UNPOOLED` is the direct endpoint for the *same* database endpoint as `DATABASE_URL`; a matching database name alone is not enough. The snapshot and apply commands reject a different endpoint, including an unrelated Neon branch.
2. Before changing the schema, take a recoverable pre-migration backup. `scripts/rollover-correction-snapshot.ts` requires the matching direct endpoint when the application URL is pooled, creates an owner-only custom-format dump directly under `/private/tmp`, checks its restore catalog, and writes a checksum manifest. Restore this backup into an isolated disposable database and verify the loan inventory before proceeding; then remove the disposable copy.
3. Deploy and verify migrations `0030_flawless_stature` and `0031_brown_morbius` on the intended database. Do not run an unrestricted migration command without checking every pending migration first.
4. Take a fresh post-migration backup for the loan correction. Its manifest must say `correctionAuditTablesInDump: true`, derived from the dump's restore catalog; the apply command rejects a pre-migration or older-format manifest. Test-restore it into an isolated disposable database and verify the inventory and audit tables. Preserve both backups and manifests outside the application host under the organization's sensitive-data retention policy. Do not use the correction service as a substitute for a backup.
5. Run `scripts/rollover-correction.ts` with explicit `--expect-host`, `--expect-database`, and a new `--out` path under a restricted temporary directory. This command is read-only and rejects `--apply`. Compute the report's SHA-256 checksum after review; the maintenance command requires that exact checksum.
6. Reconcile the report's live/deleted link count against the database inventory. Review the target chain's dates, fresh cash, source documents, original and proposed carry, settlement reclassifications, status, exceptions, input fingerprint, and plan hash. The default report contains pseudonymous IDs and financial amounts, so treat it as sensitive.
7. A blocked plan is audit-only. A review plan requires an explicit decision on every payment/waiver allocation and on any paid/settled status. A ready plan still needs review of its exact hash. Record a substantive review note and the identified reviewer.

## Apply one reviewed chain

Use `scripts/rollover-correction-apply.ts` first with `--mode=approve`, then as a separate invocation with `--mode=apply`. Both require the explicit database host/name, reviewed report path and SHA-256, recent backup manifest, one plan hash, that plan's input fingerprint, and an existing admin/superAdmin actor ID. Approval additionally requires a substantive `--review-note`. The report is attestation evidence; the command reloads the current plan from the database rather than trusting the JSON for arithmetic. It rejects a changed portfolio, changed chain, tampered backup, missing approval, or blocked plan.

The stored approval binds the plan hash, policy version, and source fingerprint. The applier briefly takes database table locks on loans, payments, waivers, rate changes, journal entries, and categories before reloading the source. This includes counterpart journal legs with no loan ID and prevents new source rows from appearing mid-apply; ordinary reads remain available, but writes to those tables wait. If a lock cannot be acquired within 10 seconds, the transaction aborts without applying anything and the operator must replan before retrying. It also locks chain loan and journal rows, rejects stale or blocked plans, posts balanced non-cash corrections (including reviewed interest/principal/overpayment reclassifications), and records a correction-run ID. It does not alter cash receipts, payment dates, waivers, issuance fees, or loan statuses. A repeated application of the same run hash is a no-op, including when a concurrent retry waited for the first run.

Start with the first reviewed chain and verify its receipt/statement and ledger before another chain. Re-run the full read-only inventory after each apply. A corrected chain should propose zero principal and settlement-allocation deltas. Do not promote a blocked chain into a write path by changing its classification in a report.

## Rollback and exceptions

### Production status after the 2026-10-09 review

- Samuel Lukwago's four-loan August–October chain was corrected in audited run `3b62d49c…`. Its replanned principal deltas are zero.
- Nantale Zaituni's successor `59320d81-0ad1-4f52-bceb-12bc36ba695e` was corrected in audited run `955044f0-2ed8-4f20-8739-dc40ba0c06ea`. Its effective `start_date` is 2026-09-07, although the backdated record was entered 2026-09-08. Opening principal is now UGX 2,018,508; the September 10 and 30 receipts retain their cash amounts but use actual-day, interest-first allocation. The post-apply plan has zero principal delta and the same numeric allocations.
- The portfolio still has 14 links in 10 chains: Brian's chain needs a decision on whether its UGX 2,000,000 August 12 payment was expressly principal-only; seven chains remain blocked on source attribution, contradictory dates, deleted records, or closure evidence. These were not changed. The inverted-date Kavuma chain remains expressly excluded below.

Use each loan's recorded `start_date` as the effective rollover date, including when it was backdated. `created_at` is entry time and must never substitute for the effective date. A successor dated before its predecessor started blocks correction and the predecessor statement.

### Known production exclusion (verified 2026-10-09)

Leave successor loan `a4b67718-a30a-44a8-9cf3-f56cecc553a0` and its predecessor `38ce75a5-b7b5-4099-8683-774a992f9bc9` **out of the correction batch**. The successor's recorded issue date is 2026-04-24, before the predecessor's recorded issue date of 2026-05-18. This was the only inverted link among 14 production rollover links at the time of the check. The planner classifies this chronology as blocked, and the approval/apply path rejects blocked plans; do not bypass that guard. Revisit this chain only after source documents establish the correct effective dates and the resulting carry can be independently reviewed. Do not use either loan's `created_at` as a substitute effective date: it records entry time, and these loans were backdated.

The original journal rows remain intact; corrections are additional entries tied to a run ID. If a correction must be undone, stop further applications, preserve the current database state, and restore the pre-run snapshot to a separate database for comparison. A controlled rollback must check for intervening payments or edits, reverse each correction journal with an equal-and-opposite balanced journal, restore the prior loan principal/rollover fields from the run's before-summary, and write a new audit record. Never delete original or correction journals, and never restore an old whole-database backup over newer production activity without a separate recovery decision.

Late predecessor payments, missing allocations, contradictory dates, deleted successors, and receivable discrepancies require source-document or accounting resolution before replanning. The service intentionally does not guess which loan a late payment belongs to or silently reopen a paid loan.

For a blocked chain, resolve the underlying record before generating a new report:

- A payment dated on or after a successor's effective date needs documentary attribution to the predecessor or successor. A same-day payment also needs event-order evidence; database creation order is not proof of payment order. Do not change a payment date merely to bypass the guard.
- A successor dated before its predecessor's start needs the signed effective dates checked. Do not infer a replacement date from entry timestamps.
- A deleted successor with orphaned payment journals or an unreconciled receivable needs an accounting reconstruction. Do not restore or relink it just to make a chain eligible.
- A paid or collateral-settled successor with a residual corrected balance needs an explicit resolution of its settlement, overpayment, or status. Do not silently reopen it.

For a review chain, compare every proposed interest/principal/overpayment allocation with the receipt and agreed loan terms. Record the approved allocation changes in the review note before approving the exact plan hash. A plan that proposes no change to one payment can still change another payment in the same chain.
