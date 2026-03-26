# Phase 13: Responsive Table Primitive + Card Layouts - Research

**Researched:** 2026-03-25
**Domain:** Tailwind CSS v4 responsive classes, CSS show/hide primitives, Next.js 16.2 / React 19
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RESP-01 | Dashboard KPI cards and charts reflow to single column on mobile | Dashboard already uses `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` — only the breakpoints need tightening. Activity feed section needs no grid changes. |
| RESP-02 | Data tables switch to stacked card layout on mobile (CSS show/hide, no JS) | Core of this phase: a `ResponsiveTable` primitive renders both a `<table>` (hidden on mobile) and a card list (hidden on desktop) from the same data props. Toggle is `hidden md:block` / `md:hidden`. |
| RESP-07 | Responsive card layouts for: Customers, Loans, Payments, Creditors, Expenses, Income, Watchlist | Each of the 7 list pages wires its data through `ResponsiveTable`. Card field mapping is defined per-page via a `columns` prop. |
</phase_requirements>

---

## Summary

Phase 13 implements CSS-only responsive switching between table and card views across all 7 list pages. The key constraint from STATE.md is "no JavaScript viewport detection" — all switching must be done with Tailwind CSS breakpoint classes to avoid hydration mismatch on the server-rendered pages.

The approach is a single shared primitive component `ResponsiveTable` that accepts column definitions and row data. It renders both a `<Table>` (standard shadcn/ui) and a list of stacked card `<div>`s from the same props. Visibility is toggled purely via CSS: `hidden md:table` on the `<table>` and `md:hidden` on the card list. No `useMediaQuery`, no `window.innerWidth`.

The dashboard grid (RESP-01) is already mostly correct — `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` — but `sm:` (640px) is too wide for the `md:` (768px) mobile breakpoint defined in project conventions. The Creditors KPI grid uses `sm:grid-cols-2 lg:grid-cols-4`. Both need the `sm:` breakpoint verified or adjusted so a single-column layout holds at `< 768px` (the `md` Tailwind default).

**Primary recommendation:** Build `ResponsiveTable` as a new primitive in `src/components/ui/responsive-table.tsx`. Wire all 7 list pages to use it. Drive visibility with `hidden md:table` / `md:hidden`. Write a single Cypress spec covering mobile (390px) and desktop (1280px) layouts for all pages.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Tailwind CSS | 4.x (installed) | Breakpoint classes for CSS-only show/hide | Already in project; `md:` = 768px default; no JS needed |
| shadcn/ui `Table` | installed | Existing table rendered on desktop | Already in project; no change to its API needed |
| shadcn/ui `Card` | installed | Card shell for mobile stacked layout | `<Card>`, `<CardContent>` already used throughout the project |
| `cn` (clsx + tailwind-merge) | installed | Class name merging | Standard project utility at `@/lib/utils` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lucide-react` | ^0.577.0 | Icons within card layout (optional per-column) | Only if card rows need icon decoration |
| Cypress | 15.12.0 | E2E tests verifying mobile/desktop rendering | Per-spec viewport scoping with `cy.viewport()` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CSS `hidden md:table` | JS `useMediaQuery` hook | STATE.md explicitly locks CSS-only — no JS viewport detection |
| Shared `ResponsiveTable` primitive | Duplicate card markup inside each page | Hand-rolling per-page leads to 7x divergent maintenance surfaces |
| `display: table` on `<table>` | Leaving as `block` | `<table>` elements must use `table` not `block`; Tailwind's `hidden md:table` correctly produces `display: table` on md+ |

**Installation:** No new packages required. All dependencies already installed.

---

## Architecture Patterns

### Recommended Project Structure
```
src/components/ui/
├── table.tsx                    # UNCHANGED — existing shadcn table
├── responsive-table.tsx         # NEW — the shared primitive
src/app/(app)/
├── customers/page.tsx           # MODIFY — use ResponsiveTable
├── loans/page.tsx               # MODIFY — use ResponsiveTable
├── payments/PaymentsClient.tsx  # MODIFY — use ResponsiveTable
├── creditors/page.tsx           # MODIFY — use ResponsiveTable + KPI grid fix
├── expenses/ExpenseListClient.tsx # MODIFY — use ResponsiveTable
├── income/IncomeListClient.tsx  # MODIFY — use ResponsiveTable
├── watchlist/page.tsx           # MODIFY — use ResponsiveTable
├── dashboard/page.tsx           # MODIFY — RESP-01 KPI grid breakpoint fix
cypress/e2e/
├── responsive-layouts.cy.ts     # NEW — covers RESP-01, RESP-02, RESP-07
```

### Pattern 1: ResponsiveTable Primitive
**What:** A single component that renders both a `<Table>` and card list from the same data. CSS toggling between them.
**When to use:** Every list page in the app. Pages do NOT manage two separate rendering branches.

```tsx
// src/components/ui/responsive-table.tsx
// CSS-only; no JS viewport detection (STATE.md constraint)

type Column<T> = {
  key: string
  header: string
  // Renders the value for both table cell and card field
  render: (row: T) => React.ReactNode
  // Optional: mark as the "primary" field — rendered larger in card header
  primary?: boolean
  // Optional: hide this field on card view (e.g. slug/id columns)
  hideInCard?: boolean
  // Optional: align right (amount columns)
  align?: "left" | "right"
  // Optional: for the card layout, use a shorter label
  cardLabel?: string
}

type ResponsiveTableProps<T> = {
  columns: Column<T>[]
  rows: T[]
  getRowKey: (row: T) => string
  // Forwarded to each <tr> and card wrapper — preserves data-testid="data-row"
  getRowProps?: (row: T) => React.HTMLAttributes<HTMLElement>
  // Empty state rendered when rows is empty
  emptyState?: React.ReactNode
}

export function ResponsiveTable<T>({
  columns, rows, getRowKey, getRowProps, emptyState
}: ResponsiveTableProps<T>) {
  if (rows.length === 0 && emptyState) return <>{emptyState}</>

  return (
    <>
      {/* Desktop: standard table — hidden below md breakpoint */}
      {/* NOTE: <table> needs display:table not display:block — use `hidden md:table` NOT `hidden md:block` */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.key} className={col.align === "right" ? "text-right" : undefined}>
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const rowProps = getRowProps?.(row) ?? {}
              return (
                <TableRow key={getRowKey(row)} {...rowProps}>
                  {columns.map((col) => (
                    <TableCell key={col.key} className={col.align === "right" ? "text-right" : undefined}>
                      {col.render(row)}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: stacked cards — hidden at md+ breakpoint */}
      <div className="md:hidden space-y-3">
        {rows.map((row) => {
          const rowProps = getRowProps?.(row) ?? {}
          const primaryCol = columns.find((c) => c.primary) ?? columns[0]
          const detailCols = columns.filter((c) => !c.hideInCard && c !== primaryCol)
          return (
            <div
              key={getRowKey(row)}
              data-testid="data-row"
              className="rounded-lg border bg-card p-4 space-y-2"
              // Forward click handlers etc from getRowProps — strip unsupported HTML attrs
              onClick={(rowProps as React.HTMLAttributes<HTMLDivElement>).onClick}
              role={(rowProps as React.HTMLAttributes<HTMLDivElement>).role}
              aria-label={(rowProps as React.HTMLAttributes<HTMLDivElement>)["aria-label"]}
              style={{ cursor: (rowProps as React.HTMLAttributes<HTMLDivElement>).style?.cursor }}
            >
              {/* Primary field — prominent */}
              <div className="font-medium">{primaryCol.render(row)}</div>

              {/* Detail fields — label + value grid */}
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                {detailCols.map((col) => (
                  <React.Fragment key={col.key}>
                    <dt className="text-muted-foreground">{col.cardLabel ?? col.header}</dt>
                    <dd className={col.align === "right" ? "text-right font-mono tabular-nums" : undefined}>
                      {col.render(row)}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            </div>
          )
        })}
      </div>
    </>
  )
}
```

### Pattern 2: Wiring a page to ResponsiveTable
**What:** Pages define their `columns` array, pass `rows` and `getRowKey`. All logic (filtering, pagination) remains in the page component unchanged.
**When to use:** All 7 list pages.

```tsx
// Example: customers/page.tsx
// Before: <Table><TableHeader>...<TableBody>...
// After:

const columns: Column<Customer>[] = [
  {
    key: "fullName",
    header: "Name",
    primary: true,
    render: (c) => <span className="font-medium">{c.fullName}</span>,
  },
  {
    key: "contact",
    header: "Contact",
    render: (c) => c.contact,
  },
  {
    key: "status",
    header: "Status",
    render: (c) => <Badge variant={statusVariant(c.status)}>{statusLabel(c.status)}</Badge>,
  },
]

// Inside JSX (replaces the <Table> block):
<ResponsiveTable
  columns={columns}
  rows={customers}
  getRowKey={(c) => c.id}
  getRowProps={(c) => ({
    "data-testid": "data-row",
    className: "cursor-pointer",
    onClick: () => router.push(`/customers/${c.id}`),
  })}
  emptyState={<EmptyState ... />}
/>
```

### Pattern 3: Pages with Actions Column
**What:** Loans and Payments have a DropdownMenu actions column. On mobile cards, the DropdownMenu is included as a full-width row at the bottom of the card, or kept as a floating button in the card header.
**When to use:** Any page with a DropdownMenu / actions button per row.

```tsx
// Actions are still defined as a column, but get special treatment on mobile cards:
{
  key: "actions",
  header: "",
  hideInCard: false,      // show in card
  render: (loan) => (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Loan actions" className="...">
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">...</DropdownMenuContent>
    </DropdownMenu>
  ),
}
// In the card, the actions column renders inline at the end of the dl grid.
// Alternatively: put actions in the card's primary row as a trailing element.
```

### Pattern 4: Dashboard KPI Grid (RESP-01)
**What:** The dashboard KPI grid already has `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`. The `sm:` breakpoint is 640px — narrower than the mobile bottom bar cutoff of `md:` (768px). This means at exactly 640–767px the grid shows 2 columns. This is acceptable and correct behavior (tablets get 2-col). No change needed unless the success criterion demands single-column specifically at 390px.

At 390px (the test viewport), `grid-cols-1` applies correctly. The dashboard KPI grid is already responsive. RESP-01 is satisfied as-is for the KPI cards.

The activity feed uses a simple `<div>` list with no grid — it already stacks. No change needed.

The Creditors page KPI row uses `grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4` — same pattern, already single-column at mobile.

**Conclusion for RESP-01:** Minimal or no change to dashboard layout. Verify at 390px viewport in Cypress test.

### Pattern 5: Tailwind v4 `hidden md:table` vs `hidden md:block`
**What:** When hiding/showing `<table>` elements, the revealed display value must be `table`, not `block`. Tailwind v4 provides `hidden` (= `display: none`) and `md:table` (= `display: table` at md+). Wrapping in a `<div className="hidden md:block">` avoids this issue entirely — the `<div>` is `block`, and the `<table>` inside uses its default `display: table`.
**When to use:** Always use the wrapper div pattern. Do NOT put `hidden md:table` directly on the `<table>` element.

```tsx
// CORRECT: wrap table in a div, toggle visibility on the wrapper
<div className="hidden md:block">
  <Table>...</Table>
</div>
<div className="md:hidden space-y-3">
  {/* card list */}
</div>

// WRONG: toggles display on the <table> element itself
<Table className="hidden md:table">...</Table>
```

### Anti-Patterns to Avoid
- **JS `useMediaQuery` for table/card switch:** Explicitly forbidden by STATE.md. Causes hydration mismatch on server components. Use CSS classes only.
- **`window.innerWidth` checks:** Same reason — do not use.
- **Duplicating row data logic:** The `columns` array drives both views. Do not write separate render logic for table cells vs card fields.
- **Putting `data-testid="data-row"` only on `<tr>`:** The card `<div>` also needs `data-testid="data-row"` so existing Cypress tests continue to work. The `getRowProps` pattern handles this — but the card renderer must forward it.
- **`display: none` via `visibility: hidden` or `opacity: 0`:** These leave elements in layout flow. Use `hidden` (`display: none`) and `md:block` / `md:hidden` for full removal from layout.
- **`overflow-x-auto` on the card list container:** The card list must not scroll horizontally. Only the table wrapper needs overflow-x handling. The existing `<Table>` component already wraps in `overflow-x-auto`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Viewport detection for table/card switch | Custom JS hook reading `window.innerWidth` | Tailwind `hidden md:block` / `md:hidden` CSS classes | Avoids hydration mismatch; works on server components |
| Responsive breakpoints | Custom CSS media queries in a `.css` file | Tailwind `md:` prefix | Already configured in globals.css; project convention |
| Card UI shell | Custom `<div>` with manual border/padding | shadcn `Card` / `CardContent` (or plain `rounded-lg border bg-card p-4` if Card adds too much nesting) | `bg-card` token ensures correct surface color in dark/light mode |
| Column definition duplication | Separate table column spec + card field spec | Single `Column<T>` with `hideInCard` flag | One source of truth for label, render fn, alignment |

**Key insight:** The existing `<Table>` component (`src/components/ui/table.tsx`) is a pure presentation wrapper with no responsive logic. The responsive primitive is additive: it wraps `<Table>` for desktop and adds a card list for mobile. The existing `<Table>` source is NOT modified.

---

## Common Pitfalls

### Pitfall 1: `data-testid="data-row"` only on `<tr>`, breaking existing Cypress tests
**What goes wrong:** After the refactor, mobile card `<div>`s don't have `data-testid="data-row"`, so Cypress selectors like `cy.get("[data-testid='data-row']")` match 0 rows at mobile viewport.
**Why it happens:** `getRowProps` is forwarded to `<tr>`, but the card renderer constructs its own `<div>` without the testid.
**How to avoid:** In `ResponsiveTable`, the card `<div>` MUST receive `data-testid="data-row"` from `getRowProps`. Pass all relevant HTML attributes to both the `<tr>` and the card `<div>`. Use a typed forwarding pattern.
**Warning signs:** Cypress `cy.get("[data-testid='data-row']").should("have.length", N)` fails at mobile viewport.

### Pitfall 2: `display: table` vs `display: block` on `<table>` element
**What goes wrong:** Using `<Table className="hidden md:block">` causes the browser to render the `<table>` as a `block` element at md+, breaking internal table layout (colspans, cell alignment).
**Why it happens:** `md:block` sets `display: block`, overriding the browser's default `display: table`.
**How to avoid:** Wrap in a `<div className="hidden md:block">`. The div becomes block; the table inside stays `display: table` (browser default).
**Warning signs:** Table column widths collapse or rows misalign on desktop after the change.

### Pitfall 3: Cards not rendering for Server Components pages
**What goes wrong:** `ResponsiveTable` is a `"use client"` component. Server component pages (Creditors, Watchlist) that inline it must either become client components or accept the boundary.
**Why it happens:** `ResponsiveTable` uses `React.Fragment` and dynamic render functions (passed as `columns[].render`) — these are fine in both client and server trees as long as the primitive itself is client.
**How to avoid:** Mark `responsive-table.tsx` as `"use client"`. Import it into server pages; Next.js automatically creates a client boundary at the import. No page needs to change to `"use client"` solely for this.
**Warning signs:** TypeScript error: "Event handler cannot be passed to Client Component from Server Component."

### Pitfall 4: Tailwind v4 scan exclusion missing the new component file
**What goes wrong:** New class names in `responsive-table.tsx` are purged from the CSS bundle because of the `@source not` directives in `globals.css`.
**Why it happens:** The `@source not` rules target `.planning/`, `cypress/`, and `*.md`. Source files in `src/` are always included by default in Tailwind v4.
**How to avoid:** No action needed. The file lives in `src/components/ui/` which is included by default. This pitfall is NOT a risk.
**Warning signs:** If it somehow happened: classes like `rounded-lg` stop working only on the new component.

### Pitfall 5: Actions column breaking the card grid layout
**What goes wrong:** Actions `<DropdownMenu>` column placed in the `<dl>` grid spans unexpectedly or creates visual misalignment on cards with an odd number of fields.
**Why it happens:** `<dl>` with `grid-cols-2` expects dt+dd pairs. An actions column doesn't have a natural "dt" label.
**How to avoid:** Render the actions column outside the `<dl>` grid — as a trailing `<div className="flex justify-end pt-2">` at the bottom of the card, or as a small button in the card's primary row using flex layout.
**Warning signs:** Card layout looks misaligned or broken on pages with DropdownMenu actions.

### Pitfall 6: `grid-cols-1 sm:grid-cols-2` on Creditors KPI showing 2 columns at ~640px
**What goes wrong:** At 641–767px (large phones in landscape, small tablets), the Creditors KPI shows 2 columns. This may be fine per design, but if single-column is required below `md`, change `sm:grid-cols-2` to `md:grid-cols-2`.
**Why it happens:** Tailwind `sm` = 640px, `md` = 768px. The project uses `md` as the mobile/desktop breakpoint.
**How to avoid:** If the success criterion requires single column below 768px, change `sm:grid-cols-2` to `md:grid-cols-2` in the dashboard and creditors pages.
**Warning signs:** Cypress test at 390px finds 2-column KPI layout when 1-column was expected.

---

## Code Examples

### ResponsiveTable generic signature (canonical reference)
```tsx
// Source: derived from src/components/ui/table.tsx + project column patterns
export function ResponsiveTable<T>({
  columns,
  rows,
  getRowKey,
  getRowProps,
  emptyState,
}: ResponsiveTableProps<T>): React.ReactElement | null
```

### Tailwind CSS-only show/hide (pattern from Phase 12 — confirmed working)
```tsx
// Source: STATE.md + Phase 12 RESEARCH.md — CSS-only show/hide mandate
// Desktop: visible at md+
<div className="hidden md:block">...</div>
// Mobile: visible below md
<div className="md:hidden">...</div>
```

### Card layout structure (design token alignment)
```tsx
// Source: project design system — bg-card, border, rounded-lg match existing Card component usage
<div
  key={getRowKey(row)}
  data-testid="data-row"
  className="rounded-lg border bg-card p-4 space-y-2 cursor-pointer hover:bg-muted/50 transition-colors"
>
  <div className="font-medium text-sm">{primaryValue}</div>
  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
    <dt className="text-muted-foreground">Label</dt>
    <dd>Value</dd>
  </dl>
</div>
```

### Cypress viewport scoping (confirmed pattern from mobile-navigation.cy.ts)
```typescript
// Source: cypress/e2e/mobile-navigation.cy.ts — scoped cy.viewport(), not global
context("at mobile viewport (390px)", () => {
  beforeEach(() => cy.viewport(390, 844))

  it("shows card layout instead of table rows", () => {
    cy.visit("/customers")
    // Card wrappers visible at mobile
    cy.get("[data-testid='data-row']").first().should("have.css", "display", "block")
    // Table container hidden at mobile
    cy.get("[data-slot='table-container']").should("not.be.visible")
  })
})

context("at desktop viewport (1280px)", () => {
  beforeEach(() => cy.viewport(1280, 800))

  it("shows table layout, not cards", () => {
    cy.visit("/customers")
    cy.get("[data-slot='table-container']").should("be.visible")
  })
})
```

---

## Per-Page Column Inventory

Understanding the existing columns to map to `ResponsiveTable`:

| Page | Primary Field | Detail Fields | Actions? |
|------|--------------|---------------|----------|
| Customers | fullName | contact, status | No (row click to detail) |
| Loans | customerName | id/slug, principalAmount, interestRate, status, startDate | Yes (admin only: View, Edit, Delete) |
| Payments (list) | customerName | loanRef, paymentDate, amount, interestPortion, principalPortion | Yes (admin only: Edit, Delete) |
| Creditors | name | contact, address, createdAt | View button (ButtonLink) |
| Expenses | categoryName + date | amount, notes | Delete button |
| Income | categoryName + date | amount, notes | Delete button |
| Watchlist | customerName | loanAmount, outstandingBalance, daysOverdue, dailyRate, lastPayment | No (row click to customer) |

Note: Expenses and Income have delete buttons inline in the row — these become part of the card layout. The delete button can be placed at the bottom of the card as a full-width or trailing element.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate mobile/desktop component trees | Single `ResponsiveTable` with CSS-toggled dual rendering | This phase (Phase 13) | One data path, no duplication, no hydration risk |
| `useMediaQuery` hook for layout switching | Tailwind `hidden md:block` classes | STATE.md decision (pre-Phase 13) | SSR-safe; works on server components |
| Hardcoded `sm:grid-cols-2` on KPI grids | `md:grid-cols-2` aligned to project breakpoint | This phase (minor cleanup) | Consistent with `md` = mobile/desktop split across the app |

**Deprecated/outdated:**
- `<Table>` used directly in list pages without responsive wrapping: replaced by `ResponsiveTable` wrapper in all 7 pages.

---

## Open Questions

1. **Actions column position within mobile card**
   - What we know: DropdownMenu trigger is a small icon button. In a card's `<dl>` grid it creates misalignment.
   - What's unclear: Should actions go in the card's primary row (flex with trailing button) or at the card's bottom (below the detail grid)?
   - Recommendation: Put actions as a trailing element in the primary row using `flex justify-between` on the card header div. This mirrors the iOS card pattern. Planner should pick one and stay consistent.

2. **Payments: two tabs (List and Daily Collections)**
   - What we know: `PaymentsClient` has a `Tabs` wrapper with "Payments List" and "Daily Collections" tabs. Only the list tab has a `<Table>`.
   - What's unclear: Does Daily Collections also need card layout?
   - Recommendation: Phase 13 scope is RESP-07 (the 7 specified pages). Apply `ResponsiveTable` to the Payments list tab only. Daily Collections is a summary view without a standard row table — leave it unchanged.

3. **Watchlist: border-wrapped table variant**
   - What we know: `watchlist/page.tsx` wraps its `<Table>` in `<div className="border rounded-md">`. This is slightly different from other pages.
   - What's unclear: Should the border wrapper be preserved on the desktop table but not on the mobile card list?
   - Recommendation: Keep the `border rounded-md` wrapper around the desktop `<div className="hidden md:block">` only. Cards already have per-card borders.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Cypress 15.12.0 (E2E) |
| Config file | `cypress.config.ts` |
| Quick run command | `npx cypress run --spec cypress/e2e/responsive-layouts.cy.ts` |
| Full suite command | `npx cypress run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RESP-01 | Dashboard KPI grid is single-column at 390px | E2E (mobile viewport) | `npx cypress run --spec cypress/e2e/responsive-layouts.cy.ts` | Wave 0 |
| RESP-02 | Table container hidden, card list visible at 390px on customers page | E2E (mobile viewport) | `npx cypress run --spec cypress/e2e/responsive-layouts.cy.ts` | Wave 0 |
| RESP-02 | Table container visible, card list hidden at 1280px | E2E (desktop viewport) | `npx cypress run --spec cypress/e2e/responsive-layouts.cy.ts` | Wave 0 |
| RESP-07 | All 7 list pages show card layout at 390px with data-testid="data-row" present | E2E (mobile viewport, each page) | `npx cypress run --spec cypress/e2e/responsive-layouts.cy.ts` | Wave 0 |
| RESP-07 | All 7 list pages show table layout at 1280px (no regressions) | E2E (desktop viewport) | `npx cypress run --spec cypress/e2e/responsive-layouts.cy.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx cypress run --spec cypress/e2e/responsive-layouts.cy.ts`
- **Per wave merge:** `npx cypress run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `cypress/e2e/responsive-layouts.cy.ts` — covers RESP-01, RESP-02, RESP-07

**Suggested test structure for `responsive-layouts.cy.ts`:**
```typescript
describe("Responsive Layouts", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin()
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  context("at mobile viewport (390px)", () => {
    beforeEach(() => cy.viewport(390, 844))

    // RESP-01
    it("dashboard KPI grid is single column")

    // RESP-02 + RESP-07 per page:
    it("customers page shows card layout")
    it("loans page shows card layout")
    it("payments page shows card layout")
    it("creditors page shows card layout")
    it("expenses page shows card layout")
    it("income page shows card layout")
    it("watchlist page shows card layout")
  })

  context("at desktop viewport (1280px)", () => {
    beforeEach(() => cy.viewport(1280, 800))

    // RESP-02 no regressions
    it("customers page shows table layout")
    it("loans page shows table layout")
    // ... all 7 pages
  })
})
```

Note: Per STATE.md, global Cypress viewport must NOT be changed. Use scoped `cy.viewport()` in `beforeEach` within each `context` block only.

---

## Sources

### Primary (HIGH confidence)
- `src/components/ui/table.tsx` — existing Table component API; data-slot attributes confirm selector strategy
- `src/app/(app)/customers/page.tsx` — current table structure, row props, pagination
- `src/app/(app)/loans/page.tsx` — current table with DropdownMenu actions
- `src/app/(app)/payments/PaymentsClient.tsx` — tabbed payments list
- `src/app/(app)/creditors/page.tsx` — server component with KPI grid
- `src/app/(app)/expenses/ExpenseListClient.tsx` — client component with optimistic updates
- `src/app/(app)/income/IncomeListClient.tsx` — mirrors expenses structure
- `src/app/(app)/watchlist/page.tsx` — border-wrapped table variant
- `src/app/(app)/dashboard/page.tsx` — KPI grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
- `src/app/globals.css` — Tailwind v4 config, `@source not` exclusions confirmed
- `.planning/STATE.md` — CSS-only viewport detection mandate, md breakpoint convention
- `cypress/e2e/mobile-navigation.cy.ts` — confirmed scoped `cy.viewport()` pattern
- `cypress.config.ts` — no global viewport set (default 1000x660)
- `.planning/config.json` — `nyquist_validation: true` confirmed

### Secondary (MEDIUM confidence)
- `package.json` — confirmed: tailwindcss 4.x, shadcn 4.1.0, cypress 15.12.0

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed installed; no new dependencies needed
- Architecture: HIGH — ResponsiveTable pattern derived directly from existing codebase code (table.tsx, page structures) and STATE.md constraints
- Per-page column inventory: HIGH — read actual source of all 7 pages
- Pitfalls: HIGH — derived from codebase structure analysis and Phase 12 learnings
- Dashboard RESP-01: HIGH — grid already uses `grid-cols-1` at xs, satisfies success criterion

**Research date:** 2026-03-25
**Valid until:** 2026-04-25 (all dependencies stable; Tailwind v4 API is stable at these versions)
