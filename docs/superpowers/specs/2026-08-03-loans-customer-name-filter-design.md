# Loans Customer-Name Filter Design

## Goal

Add a customer-name filter to `/loans` that behaves like the Customers page search: users can type a customer name, matching is case-insensitive and substring-based, and the visible loan portfolio updates without a page reload.

## Current Context

`src/app/(app)/loans/page.tsx` reads the uncapped operational loan collection through `useOperationalLoansWithBalances()`. Each `LoanListEntry` already contains `customerName`, so this feature does not need a server query or schema change. The Customers page uses the shared `FilterPanel`, a 300 ms debounced input, and a clear action.

## Design

- Add a controlled-by-applied-query `LoanSearchBar` component under `src/components/loans/`; the component may keep a local draft for debouncing, but it must resync its visible input whenever the page clears the applied query.
- Render it below the Loans header and above the risk cards. On desktop its content is visible; on mobile the existing `FilterPanel` toggle reveals it.
- Use the placeholder and accessible label `Search by customer name...`.
- Debounce input changes by 300 ms, then pass the trimmed query to the page.
- Match `customerName.toLowerCase().includes(query.toLowerCase())`; an empty or whitespace-only query returns every operational loan.
- Apply the name filter before sorting and risk categorization. Therefore risk-card counts/balances, the selected risk category, the table, Print, and Export all describe the same filtered set. Extend the export action input with the normalized customer-name query so the server-generated workbook applies the same filter.
- Keep the selected risk category independent from the name query. Clearing the name query leaves the selected category active.
- When the name query produces no rows, show `No loans match your search.` and a `Clear filters` action. When both name and risk filters produce no rows, show `No loans match your filters.` with `Clear filters` clearing the name query and `Show all loans` clearing both the name query and risk category.
- Preserve the current no-loans and category-empty states when no name filter is active.

## Testing

- Add pure unit coverage for matching names, case-insensitive matching, substring matching, whitespace/empty queries, and non-matching queries.
- Extend `cypress/e2e/loans-list.cy.ts` to cover rendering, matching one customer while hiding another, no-match empty state, clearing the search, mobile filter-panel reveal, composition with the existing risk-category filter, and the print document’s filtered rows. Add an action/service contract test or equivalent focused assertion for passing the customer query to Excel export.
- Run the focused Vitest and Cypress specs, then `pnpm typecheck`, `pnpm lint`, and `pnpm exec next build`.

## Out of Scope

- URL query-parameter persistence or server-side pagination changes.
- Filtering by contact, NIN, loan type, amount, or status.
- Changes to the loan collection, database schema, export action contract, or customer page.
