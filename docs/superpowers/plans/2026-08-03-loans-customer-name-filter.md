# Loans Customer-Name Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a debounced customer-name filter to the operational loans page that composes with risk categories and keeps all displayed/exported/printed data consistent.

**Architecture:** Keep the on-screen filtering client-side because `useOperationalLoansWithBalances()` already provides the uncapped active loan set with `customerName`. Extract the case-insensitive matching predicate into a pure helper for deterministic unit coverage, and keep input/debounce/panel behavior in a controlled `LoanSearchBar` component modeled on the Customers page. Pass the same query to the server-side Excel export so generated files cannot diverge from the table.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, TanStack DB live collections, Vitest, Cypress, existing `FilterPanel`/`Input`/`Button` components.

---

### Task 1: Add the tested loan-name matching helper

**Files:**
- Create: `src/lib/loan-filters.ts`
- Create: `src/lib/__tests__/loan-filters.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest"
import { filterLoansByCustomerName } from "@/lib/loan-filters"

const loans = [
  { customerName: "Alice Nakato" },
  { customerName: "Bob Ssemakula" },
  { customerName: "ALICE KATO" },
]

describe("filterLoansByCustomerName", () => {
  it("matches case-insensitive customer-name substrings", () => {
    expect(filterLoansByCustomerName(loans, "lic")).toEqual([loans[0], loans[2]])
  })

  it("trims the query and returns all loans for whitespace or empty input", () => {
    expect(filterLoansByCustomerName(loans, "  ")).toEqual(loans)
    expect(filterLoansByCustomerName(loans, "")).toEqual(loans)
  })

  it("returns an empty list when no customer name matches", () => {
    expect(filterLoansByCustomerName(loans, "carol")).toEqual([])
  })
})
```

- [ ] **Step 2: Run the focused test and confirm the expected RED failure**

Run: `pnpm vitest run src/lib/__tests__/loan-filters.test.ts`

Expected: FAIL because `@/lib/loan-filters` does not exist yet.

- [ ] **Step 3: Add the minimal implementation**

```ts
export function filterLoansByCustomerName<T extends { customerName: string }>(
  loans: readonly T[],
  query: string,
): T[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return [...loans]
  return loans.filter((loan) => loan.customerName.toLowerCase().includes(normalizedQuery))
}
```

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `pnpm vitest run src/lib/__tests__/loan-filters.test.ts`

Expected: 3 tests pass with zero failures.

### Task 2: Add the debounced filter UI

**Files:**
- Create: `src/components/loans/loan-search-bar.tsx`
- Test: `cypress/e2e/loans-list.cy.ts`

- [ ] **Step 1: Write the component test scenario in the Cypress spec before production wiring**

Add a `Loans customer-name filter` context to `cypress/e2e/loans-list.cy.ts` that will later assert the input, its mobile toggle, and clear behavior. The first test must assert the input is visible on desktop and contains the exact placeholder `Search by customer name...`.

- [ ] **Step 2: Run the new Cypress test and confirm RED**

Run: `pnpm cypress run --spec cypress/e2e/loans-list.cy.ts`.

Expected: FAIL because the new input assertion is not rendered yet. Existing loans-list tests may pass; the newly added filter assertion must fail for the missing placeholder.

- [ ] **Step 3: Implement the focused search bar**

Create a client component with this implementation:

```tsx
"use client"

import { useEffect, useRef } from "react"
import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Input } from "@/components/ui/input"

interface LoanSearchBarProps {
  value: string
  onChange: (value: string) => void
  onSearch: (query: string) => void
}

export function LoanSearchBar({ value, onChange, onSearch }: LoanSearchBarProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const scheduleSearch = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onSearch(value.trim()), 300)
  }

  const handleChange = (value: string) => {
    onChange(value)
    scheduleSearch(value)
  }

  const handleClear = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    onChange("")
    onSearch("")
  }

  return (
    <FilterPanel label="Filters" activeCount={value.trim() ? 1 : 0}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full md:w-[320px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="Search by customer name..."
            className="pl-9"
            placeholder="Search by customer name..."
            value={value}
            onChange={(event) => handleChange(event.target.value)}
          />
        </div>
        {value && (
          <Button variant="ghost" size="sm" onClick={handleClear}>
            <X className="h-4 w-4" />
            Clear filters
          </Button>
        )}
      </div>
    </FilterPanel>
  )
}
```

The input must be inside `data-slot="filter-panel-content"` via `FilterPanel`, so its mobile visibility follows the existing Customers behavior.

- [ ] **Step 4: Run the Cypress rendering test and confirm GREEN for the component surface**

Run: `pnpm cypress run --spec cypress/e2e/loans-list.cy.ts`.

Expected: the new input-rendering assertion passes. Full filtering behavior is verified after the callback wiring in Task 3.

### Task 3: Compose the name filter with the loans page

**Files:**
- Modify: `src/app/(app)/loans/page.tsx`
- Modify: `src/services/loan.service.ts`
- Modify: `src/actions/loan.actions.ts`
- Test: `src/actions/__tests__/loan.actions.test.ts`

- [ ] **Step 1: Wire the name query and filtered source list**

Import `LoanSearchBar` and `filterLoansByCustomerName`, add `const [customerNameQuery, setCustomerNameQuery] = useState("")`, and replace the current `sortedEntries` source with a memoized `nameFilteredEntries` followed by sorting:

```tsx
const nameFilteredEntries = useMemo(
  () => filterLoansByCustomerName(entries, customerNameQuery),
  [entries, customerNameQuery],
)

const sortedEntries = useMemo(() => {
  return [...nameFilteredEntries].sort((a, b) => {
    const rankDiff = criticalityRank(a) - criticalityRank(b)
    if (rankDiff !== 0) return rankDiff
    return b.daysOverdue - a.daysOverdue
  })
}, [nameFilteredEntries])
```

Render `<LoanSearchBar value={customerNameQuery} onSearch={setCustomerNameQuery} />` immediately below the header and before the loading/empty/data branches. Keep the existing no-loans branch keyed to `entries.length === 0` so an empty search never changes the first-use CTA.

- [ ] **Step 2: Make empty-state branching explicit**

Define `hasNameFilter = customerNameQuery.trim().length > 0` and retain the existing category empty state for category-only filtering. Inside the existing non-empty data branch, replace the current category-only conditional with this explicit JSX branching before the table:

```tsx
const hasCategoryFilter = activeFilter !== "all"
const hasCombinedFilter = hasNameFilter && hasCategoryFilter

{filteredEntries.length === 0 && hasNameFilter ? (
    <div className="py-12 text-center">
      <h2 className="text-lg font-semibold">
        {hasCombinedFilter ? "No loans match your filters." : "No loans match your search."}
      </h2>
      <p className="text-sm text-muted-foreground mt-2">
        Try adjusting your customer name or risk category.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <Button variant="outline" onClick={() => setCustomerNameQuery("")}>Clear filters</Button>
        {hasCombinedFilter && (
          <Button variant="outline" onClick={() => setActiveFilter("all")}>Show all loans</Button>
        )}
      </div>
  </div>
  ) : filteredEntries.length === 0 && hasCategoryFilter ? (
    <div className="py-12 text-center">
      <h2 className="text-lg font-semibold">No loans in this category.</h2>
      <p className="text-sm text-muted-foreground mt-2">
        No loans match the selected filter. Try a different category.
      </p>
      <Button variant="outline" className="mt-4" onClick={() => setActiveFilter("all")}>
        Show all loans
      </Button>
    </div>
  ) : (
    <ResponsiveTable
      columns={columns}
      rows={filteredEntries}
      getRowKey={(entry) => entry.id}
    />
  )}
```

Keep the existing `getRowProps` row-navigation callback on the final `ResponsiveTable`; only the surrounding empty-state condition changes.

The final UI must offer a usable way back to rows for name-only, category-only, and combined no-match cases without altering the existing empty portfolio state.

- [ ] **Step 3: Verify the page behavior with focused Cypress scenarios**

Add tests that create two customers with loans and verify:

1. typing `Alice` leaves Alice’s row and hides Bob’s row;
2. typing an unmatched value shows `No loans match your search.`;
3. clicking `Clear filters` restores both rows and clears the input;
4. selecting a risk category still narrows the search result, and clearing the name filter leaves that category selected;
5. on a 390 px viewport the filter content is hidden until `Toggle filters` is clicked;
6. clicking Print after filtering creates a print iframe whose document contains the matching customer and not the excluded customer.

Before running the spec, update the existing loans-list expectations to the current UI labels (`At Risk (25-29 days)`, `Early (0-24 days)`, `All Loans`, and `Issue Loan`). Then run: `pnpm cypress run --spec cypress/e2e/loans-list.cy.ts`

Expected: the full loans-list Cypress spec passes.

The page’s export callback must call the updated action as:

```tsx
await exportLoansExcelAction({
  filter: activeFilter,
  customerName: customerNameQuery,
})
```

Update the action/service contract to accept `{ filter?: LoanExportFilter; customerName?: string }`, apply the shared `filterLoansForExport(entries, options)` helper after computing overdue entries and before returning them, and preserve the existing risk-bucket behavior. Add a focused test proving the object input composes customer-name and risk filtering, plus the action-forwarding assertion.

### Task 4: Final adversarial review and verification

**Files:**
- Review: `docs/superpowers/specs/2026-08-03-loans-customer-name-filter-design.md`
- Review: `docs/superpowers/plans/2026-08-03-loans-customer-name-filter.md`
- Review: `src/lib/loan-filters.ts`
- Review: `src/lib/__tests__/loan-filters.test.ts`
- Review: `src/components/loans/loan-search-bar.tsx`
- Review: `src/app/(app)/loans/page.tsx`
- Review: `src/services/loan.service.ts`
- Review: `src/actions/loan.actions.ts`
- Review: `src/actions/__tests__/loan.actions.test.ts`
- Review: `cypress/e2e/loans-list.cy.ts`

- [ ] **Step 1: Run the independent adversarial review loop**

Review the final diff against the design and plan, specifically looking for: filtering capped data instead of the operational collection, category counts/table divergence, Print/Export using unfiltered rows, page-clear/input desynchronization, debounce cleanup bugs, mobile filter-panel regressions, stale empty-state branches, accidental changes to the no-loans CTA, stale baseline Cypress assertions, accessibility regressions, and tests that pass without proving rows were actually filtered. Record findings and fix every Critical/Important issue before completion.

- [ ] **Step 2: Run fresh verification**

Run:

```bash
pnpm vitest run src/lib/__tests__/loan-filters.test.ts
pnpm typecheck
pnpm lint
pnpm cypress run --spec cypress/e2e/loans-list.cy.ts
pnpm exec next build
```

Expected: every command exits 0; the Cypress spec reports zero failing tests and Next production compilation succeeds.
