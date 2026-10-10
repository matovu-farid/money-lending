# Historical paid-loan rate repair

**Date:** 2026-10-10
**Status:** Approved in conversation; implementation pending

## Decision and scope

The last authorized interest rate on a loan is a correction effective from its recorded `startDate`, not from the edit timestamp or `createdAt`. This applies to backdated and ordinary loans alike. A loan with a payment, waiver, or rollover remains locked against an ordinary rate edit; its older unmarked rate audits may only be repaired through this separately reviewed maintenance path.

For historical payments, use today's interest-first calculation, including accrual through the payment date before reducing principal. Replay each active payment and waiver in effective-date order. Preserve every receipt's identity, cash amount, payment date, deposit location, and Cash journal. A replay may change its interest, principal, and overpayment allocations and the resulting balance. This is an explicit historical accounting correction, not a new cash movement. The original rate audits and journals stay available for audit.

The initial inventory is six unmarked rate audits on three paid loans. One of these loans is in a rollover chain; that chain and all other unresolved rollover chains remain subject to the existing source-reconciliation gates. The deliberately excluded inverted-date chain remains excluded. Do not silently broaden this repair to every loan on deployment.

## Preview and classification

Build a pure, deterministic planner and a read-only source loader. The loader captures the loan's terms, effective start date, applied rate audit history, every settlement row (including deleted and marked-wrong rows for fingerprinting), all journal legs, account category identities/types, and successor/predecessor links. Verify the complete applied-audit rate sequence and match approved edits to their reviewed requests; the final loan field alone is not proof of authorization. The planner selects that final authorized rate as the corrected rate from `startDate`, and replays active settlements using the same UGX rounding, minimum-period, penalty, and loan-type rules used by current payment/statement readers. A stable order and explicit exception are required for same-instant ambiguous events; never infer order from `createdAt`. Until the statement supports cent-precise balances and start-day settlements, those sources are blocked rather than rounded or skipped.

The preview states, for each settlement, its existing and proposed interest/principal/overpayment portions, the change in principal and accrued interest, and the downstream rollover effect, if any. It verifies that each allocation sums exactly to the unchanged amount; that old allocation legs reconcile to stored journal rows; that journal groups balance; that receipt Cash dates/locations and reversal history match the recorded receipt; and that the proposed balance and statement agree. The server's final settlement split on a corrected loan uses the statement-backed unpaid amount through its interest-first clamp; the replay must be tested against that final server result, not against the raw pre-clamp quote. If an old ledger cannot be reconciled, classify the plan as blocked with a specific reason rather than choose an arbitrary number. No-op, review-needed, and blocked classifications must be distinguishable.

Rollover chains are planned from oldest to newest. A predecessor's corrected closing balance becomes the successor's opening carry only where the existing rollover correction planner has a complete, reconciled source. Existing six unresolved chains must remain blocked until their source evidence has been reviewed. The pure planner is safe to rerun on any eligible loan; an already applied plan must result in a no-op.

## Review and apply gate

The preview has a policy version, source fingerprint, and plan hash. An administrator reviews an exact plan, with a note and a named actor. Store approval separately from application. Before application, require a verified production backup/snapshot reference and re-read the source under transaction/table locks; reject if any plan input, account category, settlement, audit, or journal changed. Applying an unapproved, blocked, or stale plan is impossible. A repeated application of the same plan is idempotent.

Apply only balanced non-cash reclassification journals for allocation deltas, plus the necessary non-cash accrual correction. The accrual journal target is **not** gross cumulative interest: it is the nonnegative remainder after corrected payment and waiver interest already credited to Interest Earned is subtracted from statement accrual. Compare that target with net existing accrual journals, post only the signed difference, and use the same target as the accrual worker so a later worker run is idempotent. This avoids recognizing paid interest twice. Keep original journals and cash rows unchanged. Correct successor carry journals and loan principal only through the reconciled rollover planner, preserving recorded fresh-cash disbursement and every original loan status. Do not mutate or synthesize a payment receipt. Write before/after audit summaries and a durable run record. A failed invariant rolls back the entire transaction.

## Post-apply invariants

Within the same transaction and again in a fresh read-only check, verify: each payment's cash/deposit facts are unchanged; every journal group balances; the receivable equals replayed principal; posted interest/accrual reconciles to the corrected statement; rollover predecessors close and successors open at the corrected carry; statuses are unchanged; and rerunning the planner reports no remaining delta. A failed verification is not a successful repair.

## Verification and rollout

Test the pure replay before implementation with perpetual, fixed-rate, and reducing-balance loans; backdated starts; first-payment minimum versus rollover elapsed days; payment-day accrual; rate increase/decrease; multiple payments; waivers; overpayments; same-day ambiguity; deletions/reversals; and chain propagation. Integration tests use an explicitly isolated test database to prove approval/fingerprint/backup/idempotency gates, balanced non-cash journals, unchanged Cash rows, and transaction rollback. If UI is added, verify it with Cypress rather than a manual visual checkpoint. Track the established 18 unrelated baseline failures separately.

Production rollout is per exact reviewed preview, after a backup and with before/after report. The deployment alone does not write historical loans. A blocked loan remains reported as blocked; neither the final current-rate policy nor a broad previous approval is permission to guess missing source accounting.
