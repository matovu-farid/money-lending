# Historical rate preview: portfolio repair provenance

## Problem

The paid-rate repair preview recognizes ordinary `interest_accrual` journals but classifies `portfolio_accrual_repair` Interest Receivable journals as unknown. Two previously repaired perpetual loans now produce that exception after separately reviewed portfolio accrual repairs were posted. The preview therefore cannot provide a useful fresh reconciliation, even though the portfolio journal references point to recorded correction runs for the same loans.

## Scope and decision

This is a read-only preview compatibility correction. It does not recalculate or post interest, change a payment, approve a financial plan, alter a fixed-rate loan, or loosen rollover-chain exclusions. The existing strict unknown-source rule remains for all other sources.

Three approaches were considered: (1) whitelist the `portfolio_accrual_repair` label alone; (2) verify the referenced run and loan, then accept the journal; (3) ignore these journals. Choose (2). A label alone is forgeable, and ignoring journal amounts would give an incorrect posted-accrual baseline.

## Design

The historical-rate snapshot loader reads the portfolio accrual repair runs and agent reviews in the same repeatable-read transaction as this loan's journals. A `portfolio_accrual_repair` row is recognized only when its reference ID identifies one run whose `loan_id` equals both the requested loan and both legs' `loan_id`. For **every** journal group belonging to that run, verify exactly two equal-amount legs: Interest Receivable versus Interest Earned, debit/credit direction according to the signed delta, identical effective dates, run ID and source type, no cash location, and the expected recorded-by agent, description, and creation instant. Compare the sorted multiset of actual `(date, amount, debit account, credit account)` signatures to **all** dated entries in the run's `before_summary`; missing, extra, or altered entries block. Reject a malformed run summary or later-than-as-of entry. Do not trust a matching reference ID by itself.

Verify the associated passing agent review is for this loan and portfolio-accrual kind, binds the run's policy version, plan hash, fingerprint, reviewed checkpoints and evidence hash, has a distinct executor, and was consumed by this exact run. This follows the existing proof checks in `payment-allocation-repair.service.ts`; the historical preview must not lower that standard. Run existence, complete group proof, and review proof are all required. Missing run, missing reference ID, cross-loan run, malformed or mismatched counterpart, or inconsistent review remains a blocking exception. The existing general journal-group balance and account-type checks remain in force.

The loader must select every journal field needed for this proof, including `createdAt`, `recordedBy`, and `description`. It includes the complete matched run and review rows, sorted by ID, in the source digest along with existing journal rows. Repeating an unchanged preview produces the same fingerprint; changing provenance invalidates its exact plan. Because this loader is also used at historical-rate apply time, fail-closed proof is required in both paths.

Recognized rows remain included in the posted Interest Receivable net at the exact requested as-of instant. Rows dated later than as-of still block. Existing `interest_accrual` and waiver paths are unchanged. Do not infer that accepting provenance means the paid-rate repair has become a no-op: the preview must still calculate and show any real allocation or accrual delta.

## Verification

Add integration tests that first fail under the current loader: an exact reviewed same-loan run with balanced dated entries is recognized; missing-run, cross-loan, unmatched counterpart, extra or altered entry, mismatched review, and later-than-as-of journal each block; unchanged evidence keeps its fingerprint and changed run/review provenance alters it. Run the focused integration suite and typecheck, then re-preview the two production loans read-only. No financial apply follows automatically from a preview result.
