# Historical rate preview: portfolio repair provenance

## Problem

The paid-rate repair preview recognizes ordinary `interest_accrual` journals but classifies `portfolio_accrual_repair` Interest Receivable journals as unknown. Two previously repaired perpetual loans now produce that exception after separately reviewed portfolio accrual repairs were posted. The preview therefore cannot provide a useful fresh reconciliation, even though the portfolio journal references point to recorded correction runs for the same loans.

## Scope and decision

This is a read-only preview compatibility correction. It does not recalculate or post interest, change a payment, approve a financial plan, alter a fixed-rate loan, or loosen rollover-chain exclusions. The existing strict unknown-source rule remains for all other sources.

Three approaches were considered: (1) whitelist the `portfolio_accrual_repair` label alone; (2) verify the referenced run and loan, then accept the journal; (3) ignore these journals. Choose (2). A label alone is forgeable, and ignoring journal amounts would give an incorrect posted-accrual baseline.

## Design

The historical-rate snapshot loader reads the portfolio accrual repair runs referenced by this loan's Interest Receivable journal rows. A `portfolio_accrual_repair` row is recognized only when its reference ID identifies an existing run whose `loan_id` equals both the requested loan and the journal's `loan_id`. The existing journal-group balance and account-type checks still apply. Missing run, missing reference ID, or cross-loan run remains a blocking exception. The loaded run evidence joins the source digest so an existing exact preview is invalidated if its provenance changes.

Recognized rows remain included in the posted Interest Receivable net at the exact requested as-of instant. Rows dated later than as-of still block. Existing `interest_accrual` and waiver paths are unchanged. Do not infer that accepting provenance means the paid-rate repair has become a no-op: the preview must still calculate and show any real allocation or accrual delta.

## Verification

Add integration tests that first fail under the current loader: a balanced, same-loan, recorded portfolio accrual journal is recognized; a missing-run or cross-loan reference remains blocked; run provenance changes alter the source fingerprint; and a journal after as-of still blocks. Run the focused integration suite and typecheck, then re-preview the two production loans read-only. No financial apply follows automatically from a preview result.
