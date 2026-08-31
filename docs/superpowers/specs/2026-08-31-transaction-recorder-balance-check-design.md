# Transaction Recorder Names and Balance Check Design

## Problem

The transaction log renders the `recordedBy` foreign-key-like value directly, so users see an internal actor ID instead of the recorder's name. The balance-sheet warning compares exact decimal values while the UI displays whole UGX values, which can produce a warning whose displayed totals and rounded difference are identical.

## Design

### Transaction recorder display

`listTransactions` will left-join the Better Auth `user` table and return the user's `name` as the display value. A left join preserves historical transaction rows whose actor account was removed. Those rows will display `System` when `recordedBy` is the system sentinel and `Unknown user` for any other unresolved actor; raw IDs will not be exposed by the transaction log or its exports. Existing write paths continue storing the stable actor ID for auditing and authorization.

### Balance-sheet check

The balance check will compare assets and liabilities plus equity after rounding both to the report's visible whole-UGX precision. The server-side diagnostic will use the same rule so cent-level storage precision cannot create a contradictory warning. The returned report values remain two-decimal monetary strings for storage and downstream calculations; only the equality decision and displayed difference use the presentation precision.

## Data flow and error handling

The transaction query remains the single source for the page and transaction exports. User lookup is optional and cannot make a transaction disappear. Missing actor names use the explicit fallbacks above. Balance calculations continue to use `BigNumber`; no floating-point arithmetic is introduced.

## Testing

- Add a transaction-list regression test proving a matching actor returns the actor name and an unresolved system actor returns `System`.
- Add a balance-check regression test proving values that render to the same whole UGX amount do not produce an imbalance, while a one-UGX displayed difference still does.
- Run the focused unit/integration tests, typecheck, and the relevant Cypress specs.
