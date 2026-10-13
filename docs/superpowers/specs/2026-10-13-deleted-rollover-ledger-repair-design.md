# Deleted rollover ledger repair design

## Purpose and scope

Correct one narrow class of historical accounting error: a rollover successor was soft-deleted and its predecessor was unrolled, leaving the successor's ledger at zero; a later deletion of the predecessor then posted a second reversal of the same carried interest against that already-deleted successor. This is a non-cash journal correction, not a revival of either loan or a reinterpretation of any receipt. The operator may be reused only when another chain satisfies every identical source invariant. It must never serve as a general-purpose balance plug.

The known production case is predecessor `13acf40f-e93a-406e-8895-b0b465520e4d` and successor `ffabf86d-5f8e-4051-8678-5b83d72107df`. The successor deletion and predecessor unroll occurred on 2026-08-03; the predecessor deletion occurred on 2026-08-04. Immediately before the latter deletion, all three successor account balances—Cash, Loans Receivable and Interest Earned—were zero. The later two-leg group `1dd6afad-e61c-48eb-81c6-d770d117d9be` credited Loans Receivable and debited Interest Earned by UGX 3,636,606.34 each, effective 2025-02-21. Cash remained zero. The proposed correction is a new group debiting Loans Receivable and crediting Interest Earned by exactly UGX 3,636,606.34, effective on the same recorded journal date. It does not delete or edit any old row.

## Approaches considered

1. **Recommended: exact compensating journal.** Preserve the two original legs and post two opposite non-cash legs tied to their group ID, with a plan hash, backup proof, independent agent review, and audit record. This retains an intelligible historical trail.
2. Edit or delete the erroneous legs. This would erase evidence of how the residual arose and make prior reports irreproducible; reject.
3. Post an aggregate adjustment to make the current balance zero. This could conceal incomplete receipts or other defects and could be applied to unrelated chains; reject.

## Pure planner and independent verifier

The read-only loader retrieves both loan rows (including soft-deleted), all their payments, waivers, rate and penalty changes, all relevant journal groups and counterpart legs, and loan creation/rollover/unroll/deletion audits. The pure planner checks:

- The exact predecessor→successor relationship; both loans are soft-deleted; successor deletion and predecessor unroll precede predecessor deletion; no later settlement or correction has changed the source.
- Every journal group used in the proof is balanced, categorized correctly, and fully attributed. All loan-linked Cash net is zero after both deletions. The predecessor's Loans Receivable and Interest Earned nets are zero.
- The successor's Cash, Loans Receivable and Interest Earned nets were each zero immediately after successor deletion and before predecessor deletion, using journal `created_at` for posting sequence, not `transaction_date` or loan `created_at` as the event time.
- Exactly one later balanced, non-cash, two-leg `loan_deletion_reversal` group references the predecessor but belongs to the successor. Its date equals the original rollover's effective date; its amount equals the originally carried interest; its two legs alone explain the successor's current nonzero account nets. No other post-deletion group can be silently ignored.
- Every payment row on the deleted loans is inactive and no new Cash receipt or waiver is invented. An individual legacy payment reference may have been reversed by a loan-deletion group rather than by a payment-specific group. That reference remains an explicit historical exception, but does not invalidate this *separate* two-leg proof if the complete loan-level journal nets before the predecessor deletion are zero. The operator must not label those references individually repaired.

The plan lists the exact source group, two opposite proposed legs, before and projected after account nets, source-row fingerprint, policy version, and plan hash. Any missing or contradictory fact yields `blocked` with reasons and no legs. An independent verifier reconstructs the before/after account arithmetic from the raw journal rows without trusting the planner's proposed deltas; it binds its passing evidence to the exact plan in `financial_correction_agent_reviews` under a distinct kind. Reviewer and executor agent identities differ.

## Apply and recovery

The maintenance entry point has separate read-only preview, agent-review, isolated-restore rehearsal, and apply modes; it is not exposed as a customer or manual admin action. Before live apply, take a fresh full-data backup from the matching production endpoint and verify restoration into a separate database. The rehearsal must produce a proof binding backup hash, source fingerprint, plan hash, original journal group, proposed legs, and restored post-apply nets. Apply reloads the source under a serializable transaction and write-blocking locks for the affected financial tables, rechecks the independent review and backup/rehearsal proof, then inserts only one balanced two-leg group. The new group's reference ID is the correction audit ID; its reference type identifies this repair policy. The audit record stores the exact source group, dates, amount, plan hash, backup hash, review ID, and new group ID. It atomically consumes the passing review. Repeating the same plan is a verified no-op; source drift aborts without posting.

After apply, the successor's Cash, Loans Receivable and Interest Earned nets and the predecessor's corresponding nets must all be zero; all journal groups remain balanced. Full-table hashes of loan rows, payment rows, Cash legs, and saved financial snapshots must match the pre-apply restore. The original 2025-02-21 effective date affects historical accounting presentation; saved snapshots are not rewritten while other portfolio exceptions remain unresolved. If post-apply verification fails, stop further corrections and use the untouched pre-run backup to diagnose; reverse with an audited compensating journal rather than deleting entries or restoring an old whole database over newer activity.

## Test and rollout gates

Unit tests cover the exact known sequence, duplicate/nonmatching groups, nonzero Cash, missing unroll/deletion audit, legacy payment references reversed at loan level, source drift, and repeated application. Integration tests on an isolated database prove independent review attribution, balanced non-cash posting, idempotency, and unchanged cash/receipt/loan/snapshot rows. A fresh production preview must reproduce the same UGX 3,636,606.34 proposal and independent review before any production write. The existing 14-link rollover inventory and remaining portfolio exception scan run again afterward; this repair must not relabel unrelated blocked chains as corrected.
