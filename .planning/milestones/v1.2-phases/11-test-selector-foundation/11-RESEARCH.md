# Phase 11: Test Selector Foundation - Research

**Researched:** 2026-03-24
**Domain:** Cypress selector hygiene, Tailwind responsive padding, data-testid attribute placement
**Confidence:** HIGH

---

## Summary

Phase 11 is a preparatory hardening phase. Its only purpose is to make the existing Cypress test suite resilient to the structural DOM changes coming in Phases 12–16 (BottomTabBar, responsive card layouts, etc.). There are two independent workstreams: (1) replace fragile structural selectors with stable `data-testid` attributes, and (2) replace every hardcoded `p-6` on page containers with `p-4 md:p-6`.

The codebase audit found exactly **one** bare `cy.get("nav")` call (in `payments-list.cy.ts`) and **three** bare `cy.get("table tbody tr")` / `cy.get("[data-slot=table] tbody tr")` call sites (in `admin-panel.cy.ts`, `payments-list.cy.ts`, and `design-system.cy.ts`). The source-side changes are narrow: add `data-testid="sidebar-nav"` to the `<nav>` in `sidebar.tsx`, and add `data-testid="data-row"` to data `<TableRow>` elements (not header rows). The padding change affects approximately 24 page-level wrapper divs across 14 files.

No new libraries are needed. This phase is pure attribute additions and class string replacements.

**Primary recommendation:** Make the two source changes first (`sidebar.tsx` nav attribute, `TableRow` data-testid props), update the three Cypress call sites, then sweep all page-level `p-6` → `p-4 md:p-6`. Verify the full Cypress suite passes before closing.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TEST-01 | Add `data-testid` attributes to nav elements and table rows before layout changes | Sidebar `<nav>` at line 129 of `sidebar.tsx` needs `data-testid="sidebar-nav"`; data `<TableRow>` components need `data-testid="data-row"` prop |
| RESP-06 | Remove hardcoded `p-6` padding — use responsive `p-4 md:p-6` | 24 occurrences across 14 page files; `app-shell.tsx` main already uses `p-4 md:p-6` as the pattern to follow |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Cypress | ^15.12.0 | E2E test runner | Project's only E2E framework; all specs in `cypress/e2e/` |
| Tailwind CSS | ^4 | Utility-first styling | Project-wide CSS framework |
| React / Next.js | — | Component rendering | All page components are TSX |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | ^4.1.0 | Unit/integration tests | Not relevant to this phase; no unit tests needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `data-testid` | `aria-label`, `role` selectors | ARIA selectors are semantically richer but more brittle when markup changes; `data-testid` is the Cypress-recommended approach for test-specific handles |
| `p-4 md:p-6` | CSS custom property | CSS vars would centralise the value but require a new abstraction; Tailwind responsive prefix is already used in `app-shell.tsx` — stay consistent |

**Installation:** No new packages needed.

---

## Architecture Patterns

### Existing Structure Relevant to This Phase

```
src/
├── components/
│   └── layout/
│       ├── sidebar.tsx          # Add data-testid="sidebar-nav" to <nav>
│       └── app-shell.tsx        # Already has p-4 md:p-6 on <main> — the template
├── app/(app)/
│   ├── customers/               # page.tsx, [id]/page.tsx, new/page.tsx — p-6 to fix
│   ├── loans/                   # page.tsx, [loanId]/loan-detail-client.tsx, new/page.tsx
│   ├── payments/                # page.tsx, PaymentsClient.tsx
│   ├── expenses/                # page.tsx
│   ├── income/                  # page.tsx
│   ├── admin/                   # page.tsx
│   ├── transactions/            # page.tsx
│   ├── creditors/               # page.tsx, [id]/page.tsx, new/page.tsx
│   ├── reports/                 # page.tsx, pnl/page.tsx, portfolio/page.tsx, balance-sheet/page.tsx
│   └── loading.tsx              # p-6 present
└── components/ui/table.tsx      # TableRow — add data-testid="data-row" default
cypress/
└── e2e/
    ├── payments-list.cy.ts      # cy.get("nav") AND cy.get("table tbody tr") — two fixes needed
    ├── admin-panel.cy.ts        # cy.get("table tbody tr") — one fix needed
    └── design-system.cy.ts      # cy.get("[data-slot=table] tbody tr") — one fix needed
```

### Pattern 1: Adding data-testid to the Sidebar Nav

The `<nav>` element in `sidebar.tsx` (line 129) is the target. It currently renders as:

```tsx
<nav className="flex-1 overflow-y-auto py-3 space-y-4">
```

The fix adds a single attribute:

```tsx
<nav data-testid="sidebar-nav" className="flex-1 overflow-y-auto py-3 space-y-4">
```

The Cypress side changes from:

```typescript
cy.get("nav").contains("a", "Payments").click()
```

to:

```typescript
cy.get("[data-testid='sidebar-nav']").contains("a", "Payments").click()
```

### Pattern 2: Adding data-testid to Data TableRows

`TableRow` in `src/components/ui/table.tsx` already spreads `...props` onto `<tr>`. Data rows (not header rows) across page files use `<TableRow key={item.id}>`. The cleanest approach is to add `data-testid="data-row"` directly to each data `<TableRow>` call site (not the component default, since header rows also use `<TableRow>`).

```tsx
// Before
<TableRow key={loan.id}>

// After
<TableRow key={loan.id} data-testid="data-row">
```

The Cypress side changes:

```typescript
// Before
cy.get("table tbody tr").should("have.length.at.least", 1)

// After
cy.get("[data-testid='data-row']").should("have.length.at.least", 1)
```

For `design-system.cy.ts` which uses `[data-slot=table] tbody tr`:

```typescript
// Before
cy.get("[data-slot=table] tbody tr")

// After
cy.get("[data-testid='data-row']")
```

### Pattern 3: Responsive Padding Replacement

The model is already established in `app-shell.tsx`:

```tsx
<main className="flex-1 overflow-auto bg-background p-4 md:p-6">
```

For page-level wrapper divs, the replacement is a mechanical string substitution:

```tsx
// Before
<div className="p-6 space-y-4">

// After
<div className="p-4 md:p-6 space-y-4">
```

**Scope exceptions:** Receipt pages (`receipts/disbursement/`, `receipts/repayment/`) use `container max-w-2xl mx-auto p-6` — these are print-optimised pages that are unlikely to be viewed on mobile. However, RESP-06 does not carve out exceptions, so they should also be updated to `p-4 md:p-6`.

**Non-candidate `p-6` usages to leave alone:**
- `gap-6`, `space-y-6`, `mb-6`, `mt-6`, `py-6`, `px-6`, `pl-6`, `pr-6` — directional utilities, not the same as padding shorthand
- `border-b ... p-6` inside card content (e.g. `rounded-lg border border-border bg-card p-6` in `loan-detail-client.tsx` line 284) — this is card interior padding, not page-level padding. Leave as-is unless the success criteria explicitly requires it. (The success criteria says "every page component" — card interior padding is a component concern, not a page wrapper concern.)

### Anti-Patterns to Avoid

- **Changing `TableRow` component default to add `data-testid`:** Header rows also render as `<TableRow>` — a blanket default would pollute header rows. Add the attribute only on data row call sites.
- **Using `:first`, `:eq`, or index-based Cypress selectors:** These break when DOM order changes. `data-testid` is stable.
- **Replacing `p-6` inside `print:p-0` blocks:** Receipt pages already strip padding for print via `print:p-0`. Safe to update the screen padding to `p-4 md:p-6` without affecting print.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Selector abstraction layer | Custom `cy.getNav()` command | Direct `cy.get("[data-testid='sidebar-nav']")` | `data-testid` IS the abstraction; custom commands add indirection without benefit |
| Padding utility component | `<PageContainer>` wrapper component | Direct Tailwind class on existing div | A new component is overkill for this phase; the pattern is two classes |
| Automated codemods | Custom AST transform | Direct search-and-replace | Scope is small enough for targeted file edits |

---

## Common Pitfalls

### Pitfall 1: Updating the `<Sheet>` Mobile Sidebar Nav Too

**What goes wrong:** The mobile sheet in `app-shell.tsx` renders a `<Sidebar>` inside a `<SheetContent>`. That `<Sidebar>` also contains the `<nav>`. When the `<Sheet>` is open, there are TWO `<nav data-testid="sidebar-nav">` elements in the DOM simultaneously.

**Why it happens:** `Sidebar` is reused in both the desktop sidebar and the mobile Sheet.

**How to avoid:** The Cypress tests currently run at desktop viewport (Cypress default is 1280x720 per config — confirmed no global `viewportWidth` override). The Sheet is closed by default on desktop, so only one `data-testid="sidebar-nav"` is in the DOM during tests. This is safe. **Do not** try to differentiate the two sidebar instances in this phase — that is a Phase 12 concern.

**Warning signs:** `cy.get("[data-testid='sidebar-nav']")` returns length > 1 in a test — means the Sheet was opened during the test.

### Pitfall 2: Header Rows Getting data-testid="data-row"

**What goes wrong:** Some tables render a header `<TableRow>` inside `<TableHeader>`. If data-testid is added to both header and data rows, `cy.get("[data-testid='data-row']")` picks up header rows and the count assertions break.

**Why it happens:** The `TableRow` component is used for both header and body rows — it is just a styled `<tr>`.

**How to avoid:** Only add `data-testid="data-row"` to `<TableRow>` elements that are inside `<TableBody>` (i.e., data rows). Do not add it to `<TableRow>` elements inside `<TableHeader>`.

**Warning signs:** `cy.get("[data-testid='data-row']").should("have.length", N)` fails because N+1 rows are found (the header row plus N data rows).

### Pitfall 3: Missing p-6 Occurrences

**What goes wrong:** Some `p-6` instances are in interpolated strings, conditional class expressions (`cn(... ? "p-6" : ...)`), or inside loading skeleton divs. A plain string replace misses these.

**Why it happens:** Class names are sometimes constructed dynamically.

**How to avoid:** After the mechanical replacement, grep for remaining `p-6` in page files and manually review each hit. The `loading.tsx` file at `src/app/(app)/loading.tsx` has `p-6` in a skeleton.

**Warning signs:** After the sweep, `grep -r " p-6" src/app` still returns hits in page wrapper divs.

### Pitfall 4: Breaking design-system.cy.ts Table Assertions

**What goes wrong:** `design-system.cy.ts` uses `cy.get("[data-slot=table] tbody tr")` which relies on DOM structure. The replacement to `cy.get("[data-testid='data-row']")` must account for how that test seeds data.

**Why it happens:** The design-system test may not use `db:reset` + data seeding — it may check an empty table or rely on existing test data.

**How to avoid:** Read the specific test context in `design-system.cy.ts` before updating. If the test asserts on empty state, `cy.get("[data-testid='data-row']")` should still work (length 0 assertions pass).

---

## Code Examples

### Adding data-testid to the Nav Element

```tsx
// src/components/layout/sidebar.tsx — line 129
// Before
<nav className="flex-1 overflow-y-auto py-3 space-y-4">

// After
<nav data-testid="sidebar-nav" className="flex-1 overflow-y-auto py-3 space-y-4">
```

### Adding data-testid to Data TableRows (example: payments)

```tsx
// src/app/(app)/payments/PaymentsClient.tsx
// Before
<TableRow key={row.id}>

// After
<TableRow key={row.id} data-testid="data-row">
```

### Cypress Selector Updates

```typescript
// payments-list.cy.ts — nav assertion
// Before
cy.get("nav").contains("a", "Payments").click()
// After
cy.get("[data-testid='sidebar-nav']").contains("a", "Payments").click()

// payments-list.cy.ts — table row assertion
// Before
cy.get("table tbody tr").should("have.length.at.least", 1)
// After
cy.get("[data-testid='data-row']").should("have.length.at.least", 1)

// admin-panel.cy.ts — table row assertion
// Before
cy.get("table tbody tr").first().find("td").last()...
// After
cy.get("[data-testid='data-row']").first().find("td").last()...

// design-system.cy.ts — table row assertions (3 occurrences)
// Before
cy.get("[data-slot=table] tbody tr", { timeout: 10000 })
// After
cy.get("[data-testid='data-row']", { timeout: 10000 })
```

### Responsive Padding Replacement Pattern

```tsx
// All page-level wrapper divs — mechanical replacement
// Before
<div className="p-6 space-y-4">
// After
<div className="p-4 md:p-6 space-y-4">

// Before
<div className="p-6">
// After
<div className="p-4 md:p-6">

// Before
<div className="p-6 max-w-lg">
// After
<div className="p-4 md:p-6 max-w-lg">

// Before
<div className="container max-w-2xl mx-auto p-6">
// After
<div className="container max-w-2xl mx-auto p-4 md:p-6">
```

---

## Audit: Files Requiring Changes

### Cypress Specs (3 files, 5 selector call sites)

| File | Change | Line (approx) |
|------|--------|---------------|
| `cypress/e2e/payments-list.cy.ts` | `cy.get("nav")` → `cy.get("[data-testid='sidebar-nav']")` | ~379 |
| `cypress/e2e/payments-list.cy.ts` | `cy.get("table tbody tr")` → `cy.get("[data-testid='data-row']")` | ~60 |
| `cypress/e2e/admin-panel.cy.ts` | `cy.get("table tbody tr")` → `cy.get("[data-testid='data-row']")` | ~37 |
| `cypress/e2e/design-system.cy.ts` | `cy.get("[data-slot=table] tbody tr")` → `cy.get("[data-testid='data-row']")` | ~242, ~248, ~258 |

### Source Files: data-testid (2 files)

| File | Change |
|------|--------|
| `src/components/layout/sidebar.tsx` | Add `data-testid="sidebar-nav"` to `<nav>` (line 129) |
| `src/app/(app)/customers/page.tsx` | Add `data-testid="data-row"` to data `<TableRow>` (~line 112) |
| `src/app/(app)/loans/page.tsx` | Add `data-testid="data-row"` to data `<TableRow>` (~line 158) |
| `src/app/(app)/payments/PaymentsClient.tsx` | Add `data-testid="data-row"` to data `<TableRow>` (~line 458) |
| `src/app/(app)/admin/page.tsx` | Add `data-testid="data-row"` to data `<TableRow>` (in user list) |

### Source Files: p-6 → p-4 md:p-6 (14 page files)

| File | Occurrences |
|------|------------|
| `src/app/(app)/customers/page.tsx` | 2 |
| `src/app/(app)/customers/[id]/page.tsx` | 3 |
| `src/app/(app)/customers/new/page.tsx` | 1 |
| `src/app/(app)/loans/page.tsx` | 3 |
| `src/app/(app)/loans/[loanId]/loan-detail-client.tsx` | 2 (outer wrapper; card interior is optional) |
| `src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx` | 1 |
| `src/app/(app)/loans/new/page.tsx` | 2 |
| `src/app/(app)/payments/page.tsx` | 1 |
| `src/app/(app)/expenses/page.tsx` | 1 |
| `src/app/(app)/income/page.tsx` | 1 |
| `src/app/(app)/admin/page.tsx` | 3 |
| `src/app/(app)/transactions/page.tsx` | 1 |
| `src/app/(app)/creditors/page.tsx` | 1 |
| `src/app/(app)/creditors/[id]/page.tsx` | 1 |
| `src/app/(app)/creditors/new/page.tsx` | 1 |
| `src/app/(app)/reports/page.tsx` | 1 |
| `src/app/(app)/reports/pnl/page.tsx` | 1 |
| `src/app/(app)/reports/portfolio/page.tsx` | 1 |
| `src/app/(app)/reports/balance-sheet/page.tsx` | 1 |
| `src/app/(app)/receipts/disbursement/[loanId]/page.tsx` | 2 |
| `src/app/(app)/receipts/repayment/[paymentId]/page.tsx` | 3 |
| `src/app/(app)/loading.tsx` | 1 |

**Note:** `src/components/loans/simulator-panel.tsx` has `gap-6` (not `p-6`) — leave untouched.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Cypress ^15.12.0 |
| Config file | `cypress.config.ts` |
| Quick run command | `npx cypress run --spec cypress/e2e/payments-list.cy.ts` |
| Full suite command | `npx cypress run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-01 | `[data-testid='sidebar-nav']` targets correct nav | E2E | `npx cypress run --spec cypress/e2e/payments-list.cy.ts` | Already exists — updating selector |
| TEST-01 | `[data-testid='data-row']` targets data rows only | E2E | `npx cypress run --spec cypress/e2e/payments-list.cy.ts,cypress/e2e/admin-panel.cy.ts,cypress/e2e/design-system.cy.ts` | Already exists — updating selectors |
| RESP-06 | All page containers have `p-4 md:p-6` not `p-6` | Static (grep assertion in Cypress) | Post-implementation grep: `grep -rn " p-6" src/app | grep "\.tsx:"` — should return only non-container hits | N/A — enforced by code change |

### Sampling Rate

- **Per task commit:** `npx cypress run --spec cypress/e2e/payments-list.cy.ts`
- **Per wave merge:** `npx cypress run`
- **Phase gate:** Full Cypress suite green before `/gsd:verify-work`

### Wave 0 Gaps

None — existing test infrastructure covers all phase requirements. No new test files need to be created. The spec files being modified already exist.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `cy.get("nav")` | `cy.get("[data-testid='sidebar-nav']")` | Phase 11 | Survives Phase 12 BottomTabBar adding a second `<nav>` |
| `cy.get("table tbody tr")` | `cy.get("[data-testid='data-row']")` | Phase 11 | Survives Phase 13 replacing `<tr>` with card divs on mobile |
| `p-6` hardcoded | `p-4 md:p-6` responsive | Phase 11 | Reduces content cramping on mobile |

---

## Open Questions

1. **card interior padding in loan-detail-client.tsx (line 284)**
   - What we know: `rounded-lg border border-border bg-card p-6` — this is card padding, not page wrapper padding
   - What's unclear: Does RESP-06 ("every page component") include card interior padding, or only top-level page wrappers?
   - Recommendation: Treat card interior `p-6` as out of scope for RESP-06. Only page-level wrapper divs (the outermost container div rendered by a page component) should use `p-4 md:p-6`. Card interior padding is a RESP-07/Phase 13 concern.

2. **Reports sub-pages (pnl, portfolio, balance-sheet)**
   - What we know: Each has one `p-6` on the page wrapper
   - What's unclear: Are these pages reachable in the Cypress test suite, and do any specs assert on their padding?
   - Recommendation: Apply the replacement regardless — it cannot break tests since no spec currently asserts on padding values.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase audit — `sidebar.tsx`, `table.tsx`, `app-shell.tsx` read in full
- Direct Cypress spec audit — all 25 spec files surveyed for selector patterns
- Direct page file audit — all 14 affected page files identified via grep

### Secondary (MEDIUM confidence)
- STATE.md decision log: "data-testid scoping must happen before any second `<nav>` element enters the DOM" — confirms the timing requirement for this phase

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified from package.json and config files
- Architecture: HIGH — based on direct source code audit; all affected files identified
- Pitfalls: HIGH — derived from actual DOM structure found in sidebar.tsx and table.tsx

**Research date:** 2026-03-24
**Valid until:** 2026-04-24 (stable domain — no library churn expected)
