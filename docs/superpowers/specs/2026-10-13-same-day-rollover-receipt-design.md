# Same-day predecessor receipt at a date-only rollover

## Decision

A receipt recorded against the predecessor loan remains that loan's receipt. When both the predecessor and successor have UTC-midnight effective start dates, a predecessor receipt dated later on the successor's UTC calendar date is included in the predecessor's final interest-first settlement and rollover carry. Midnight is a date-only convention here, not evidence that the rollover preceded the receipt. This policy applies only when the payment row and its journal legs are verified as belonging to the predecessor. A receipt on a later date, or one paired with a non-midnight loan start, remains blocked for explicit review. This does not reassign a payment to the successor or change its cash amount or date.

## Boundaries

- The effective rollover date is always the successor loan's `start_date`, never `created_at`.
- The accrued-day count remains the count at the successor's midnight start. With both loans starting at UTC midnight, an end-of-date read of same-day settlements does not add an elapsed day. Non-midnight cases cannot use this exception.
- Only same-day predecessor payments receive the inclusive cutoff. Waivers, rate changes, and penalty-waiver history on or after successor start retain their existing stop conditions. Fixed-rate loans and inverted-date chains remain out of scope.
- The source loader and independent verifier check that the payment row and dated journal legs are predecessor-owned, cash and allocation journals reconcile, and the original/corrected predecessor receivable closes. No implicit loan reassignment is allowed.

## Implementation surfaces

1. A shared, pure UTC date-only cutoff/eligibility helper controls the inclusion boundary. The live quote uses it for payment validation, statement input, and its ledger-principal as-of query. The live quote is only for an active predecessor before an outgoing rollover and explicitly rejects an already-posted outgoing transfer before using the later ledger cutoff.
2. The historical planner includes eligible same-day receipts in `replaySettlements`, quotes after those receipts, and keeps later or ambiguous events blocked. Bump the correction policy version so old plan hashes and reviews cannot authorize new calculations.
3. The independent agent verifier reconstructs the same arithmetic independently, verifies payment/journal ownership, and checks the proposed balanced non-cash settlement and carry deltas. The existing applier posts only correction pairs against net original/prior-correction journals, then checks predecessor closure, successor receivable, carried interest, and zero-delta replanning. Do not move the historical ledger boundary to end-of-day or count the rollover transfer twice.

## Verification and rollout

Test first. Reproduce the July 20 receipt in focused tests and confirm they fail before implementation. Cover same-day receipt inclusion exactly once, unchanged elapsed interest days, next-day and non-midnight exclusions, same-day waiver/rate exclusions, journal ownership rejection, correction balance, replan no-op, and immutable cash/payment loan attribution. Run focused unit, independent verifier, integration, and type checks; record unrelated baseline failures separately. Regenerate a read-only production inventory, and compare the exact affected chains with prior reports. A production correction, if any plan is nonblocked and nonzero, requires a fresh backup, isolated restore rehearsal, independently attributed Sol-agent review, exact-plan apply, and post-apply ledger/no-op checks. Leave other blocked chains and deferred fixed-rate loans unchanged.
