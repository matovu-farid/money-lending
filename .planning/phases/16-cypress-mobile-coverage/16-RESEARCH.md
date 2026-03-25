# Phase 16: Cypress Mobile Coverage - Research

**Researched:** 2026-03-25
**Domain:** Cypress E2E testing — mobile viewport coverage, responsive spec patterns
**Confidence:** HIGH

## Summary

Phase 16 is a pure test-writing phase. No application code changes are expected. All work is confined to `cypress/e2e/*.cy.ts` files. The goal is to bring the test suite to parity with the responsive changes delivered in Phases 12–15: every spec must run at desktop without regressions, and every spec must contain a mobile viewport block (`cy.viewport(390, 844)`) covering at minimum rendering, navigation, and key actions.

The project already has strong working precedents for mobile viewport testing. Four spec files — `mobile-navigation.cy.ts`, `responsive-layouts.cy.ts`, `forms-filters-table-polish.cy.ts`, and `touch-optimization.cy.ts` — provide the exact patterns to replicate across the remaining 25 spec files. The Cypress version is 15.12.0 with `cypress-real-events` 1.15.0.

A second deliverable is a dedicated `tab-bar.cy.ts` spec (TEST-04). The `mobile-navigation.cy.ts` spec already covers the bottom tab bar functionally, but TEST-04 requires a spec focused specifically on tab switching, "More" sheet behavior, active state, and safe-area layout. Because mobile-navigation already covers this, the new spec should restate these tests with sharper focus and scope constraints (no sidebar/hamburger tests — those belong in mobile-navigation).

**Primary recommendation:** Scope work into two plans. Plan 01: add mobile viewport blocks to all existing specs that lack them. Plan 02: write the dedicated `tab-bar.cy.ts` spec and validate the full suite runs at default (desktop) viewport.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TEST-02 | All existing Cypress specs pass at default (desktop) viewport after responsive changes | All 29 spec files identified; desktop default is already cypress.config.ts default — no global viewport change needed |
| TEST-03 | Mobile viewport test blocks added to all existing Cypress spec files | 25 spec files lack `cy.viewport(390, 844)` blocks; 4 already have them (see gap analysis) |
| TEST-04 | New Cypress specs for bottom tab bar and mobile navigation | New `tab-bar.cy.ts` spec needed; testids already exist on BottomTabBar and MoreSheet from Phase 12 |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Cypress | ^15.12.0 | E2E test runner | Already installed — project standard |
| cypress-real-events | ^1.15.0 | Native pointer/touch events | Needed for Base UI Select `.realClick()` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| cypress-real-events `.realClick()` | — | Select dropdown option selection | Any `[data-slot=select-item]` interaction |

**Version verification:** No new installs required. All dependencies are present.

## Architecture Patterns

### Viewport Scoping Convention (HIGH confidence)

The project has a firm convention established in STATE.md decisions:

> "Global Cypress viewport must NOT be changed — mobile tests use scoped `cy.viewport()` in beforeEach"

This means mobile tests are always wrapped in a `context()` block with `cy.viewport(390, 844)` in a `beforeEach`, not set at the top-level describe.

```typescript
// Source: mobile-navigation.cy.ts, responsive-layouts.cy.ts (project patterns)
describe("My Feature", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Test User" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => {
      cy.viewport(390, 844)
    })

    it("renders page heading at mobile", () => {
      cy.visit("/some-page")
      cy.get("h1").should("be.visible")
    })

    it("shows bottom tab bar, not sidebar", () => {
      cy.get("[data-testid='bottom-tab-bar']").should("exist")
      cy.get("[data-testid='sidebar-nav']").should("not.be.visible")
    })
  })
})
```

### ResponsiveTable Visibility Pattern (HIGH confidence)

The dual-DOM pattern (desktop `<tr>` + mobile card `<div>` both share `data-testid="data-row"`) requires the `.filter(":visible")` assertion at mobile viewport. This pattern is mandatory for any spec touching a table page at mobile.

```typescript
// Source: responsive-layouts.cy.ts, touch-optimization.cy.ts (project patterns)
// At mobile viewport — always filter to visible card rows
cy.get("[data-testid='data-row']").filter(":visible").should("have.length.gte", 1)
cy.get("[data-testid='data-row']").filter(":visible").first().should("contain.text", "Customer Name")

// At desktop viewport — no filter needed, table rows are visible
cy.get("[data-testid='data-row']").should("have.length.gte", 1)
```

### Sidebar/TabBar Navigation at Mobile (HIGH confidence)

Standard assertions for any page at mobile viewport:

```typescript
// Source: mobile-navigation.cy.ts (project pattern)
cy.get("[data-testid='bottom-tab-bar']").should("exist").should("have.css", "display", "flex")
cy.get("[data-testid='sidebar-nav']").should("not.be.visible")
```

### DrawerDialog at Mobile (HIGH confidence)

At mobile, `DrawerDialog` renders `Drawer.Popup` with `data-slot="drawer-dialog-content"`. At desktop it renders `data-slot="dialog-content"`. Touch-optimization spec has the complete swipe-dismiss helper.

```typescript
// Source: touch-optimization.cy.ts (project pattern)
// Mobile: drawer
cy.get('[data-slot="drawer-dialog-content"]', { timeout: 5000 }).should("be.visible")
// Desktop: dialog
cy.get('[data-slot="dialog-content"]', { timeout: 5000 }).should("be.visible")
```

### FilterPanel at Mobile (HIGH confidence)

```typescript
// Source: forms-filters-table-polish.cy.ts (project pattern)
// Mobile: toggle button visible, panel hidden by default
cy.get("[aria-label='Toggle filters']").should("be.visible")
cy.get("[data-slot='filter-panel-content']").should("not.be.visible")
cy.get("[aria-label='Toggle filters']").click()
cy.get("[data-slot='filter-panel-content']").should("be.visible")
```

### Anti-Patterns to Avoid

- **Setting viewport globally in cypress.config.ts:** Established project decision — never modify global viewport. Use scoped `cy.viewport()` in context blocks.
- **Asserting `data-row` without filter at mobile:** Dual DOM means both card and table rows share the testid. Always `.filter(":visible")` at 390px.
- **Using `.should("be.visible")` on bottom-tab-bar without CSS check:** The tab bar is `position:fixed` — use `.should("exist").should("have.css", "display", "flex")` as done in mobile-navigation.cy.ts.
- **Asserting `data-slot="table-container"` is visible at mobile:** It is deliberately hidden (`hidden md:block`). Assert `not.be.visible`.

## Spec Gap Analysis

### Already Have Mobile Viewport Blocks (4 files — skip)
- `mobile-navigation.cy.ts` — complete mobile + desktop contexts
- `responsive-layouts.cy.ts` — complete mobile + desktop contexts
- `forms-filters-table-polish.cy.ts` — mobile + desktop contexts for RESP-03/04/05
- `touch-optimization.cy.ts` — mobile contexts for all 3 TOUCH requirements

### Need Mobile Viewport Blocks (25 files)

Grouped by scope of mobile assertions needed:

**Group A: Page rendering + nav + table/card visibility (table pages)**
These pages have `ResponsiveTable` and need the full mobile pattern including `.filter(":visible")`.
- `creditors.cy.ts` — creditors list table
- `loans-list.cy.ts` — loans table
- `payments.cy.ts` — payments on loan detail (table/list)
- `watchlist.cy.ts` — watchlist table
- `notifications.cy.ts` — (no table, but bell button visibility at mobile)
- `customer-search.cy.ts` — customers table with filter panel

**Group B: Page rendering + nav only (no complex table)**
- `dashboard.cy.ts` — KPI cards, activity feed
- `customer-history.cy.ts` — customer detail, loan cards
- `customer-status.cy.ts` — customer detail, status dropdown
- `loan-wizard.cy.ts` — multi-step form
- `repayment-simulator.cy.ts` — loan detail with simulator panel
- `activity-feed.cy.ts` — dashboard activity section
- `homepage-redirect.cy.ts` — redirect behavior (viewport-agnostic but needs a mobile block)

**Group C: CRUD forms that open DrawerDialog at mobile**
- `expenses.cy.ts` — Add Expense sheet opens as drawer at mobile
- `income.cy.ts` — Add Income sheet opens as drawer at mobile

**Group D: Misc/Admin pages (render check + nav)**
- `admin-panel.cy.ts`
- `auth-gate.cy.ts`
- `design-system.cy.ts`
- `daily-collections.cy.ts`
- `quick-record.cy.ts`
- `registration.cy.ts`
- `reports.cy.ts`
- `transactions.cy.ts`
- `customer-crud.cy.ts`
- `payments-list.cy.ts`

### New File Needed (TEST-04)
- `tab-bar.cy.ts` — dedicated bottom tab bar spec

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Native touch/pointer events | Custom JS touch dispatch | `cypress-real-events` `.realClick()` | Already installed; handles browser-level events for Base UI components |
| Touch swipe simulation | New helper | Copy `swipeDownToDismiss` from `touch-optimization.cy.ts` | Already validated against Base UI Drawer.Viewport |
| Viewport switching | Inline `cy.viewport()` in each it() | Scoped `beforeEach(() => cy.viewport(390, 844))` in a `context()` block | Project convention; consistent with all 4 existing mobile specs |

## Common Pitfalls

### Pitfall 1: Asserting element visibility without `:visible` filter on dual-DOM tables
**What goes wrong:** `cy.get("[data-testid='data-row']").should("have.length", 1)` passes at mobile but the element found is the hidden desktop `<tr>`, not the visible mobile card `<div>`.
**Why it happens:** `ResponsiveTable` renders both DOM representations — Cypress finds all matching elements including hidden ones.
**How to avoid:** Always use `.filter(":visible")` at 390px viewport: `cy.get("[data-testid='data-row']").filter(":visible").first()`.
**Warning signs:** Test passes but the assertion is on a hidden element (check with `.should("be.visible")` added).

### Pitfall 2: Table container visible assertion at mobile
**What goes wrong:** `cy.get("[data-slot='table-container']").should("be.visible")` fails at mobile — table is `hidden md:block`.
**Why it happens:** The table container is intentionally hidden at mobile.
**How to avoid:** At mobile, assert `should("not.be.visible")`. At desktop, assert `should("be.visible")`.

### Pitfall 3: Bottom tab bar CSS visibility check
**What goes wrong:** `cy.get("[data-testid='bottom-tab-bar']").should("be.visible")` can fail due to Next.js dev mode overlay elements.
**Why it happens:** Documented in `mobile-navigation.cy.ts` comments.
**How to avoid:** Use `.should("exist").should("have.css", "display", "flex")` pattern from mobile-navigation.cy.ts.

### Pitfall 4: Filter panel not collapsed on mobile if toggle was clicked in a prior test
**What goes wrong:** Filter panel state leaks between tests.
**Why it happens:** Filter panel uses local component state (useState), which persists within the same page visit.
**How to avoid:** Each `it()` that tests filter panel must start with a fresh `cy.visit()`.

### Pitfall 5: DrawerDialog sheet not rendered at mobile if base-ui media query fires asynchronously
**What goes wrong:** Asserting `data-slot="drawer-dialog-content"` immediately after click gives "not found".
**Why it happens:** `useMediaQuery` returns `defaultMatches: true` (desktop) on SSR, then re-evaluates on mount. At mobile viewport, there may be a brief flash.
**How to avoid:** Always use `{ timeout: 5000 }` on the drawer content assertion. Established in touch-optimization.cy.ts.

### Pitfall 6: `cy.viewport()` in afterEach is not needed
**What goes wrong:** Some patterns reset viewport in afterEach — this is unnecessary since each test gets a fresh Cypress context.
**Why it happens:** Misunderstanding Cypress test isolation.
**How to avoid:** Only set viewport in `beforeEach` of the scoped `context()`. No cleanup needed.

## Code Examples

### Mobile context block structure (canonical project pattern)
```typescript
// Source: mobile-navigation.cy.ts, responsive-layouts.cy.ts
describe("Feature Name", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Test User" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => {
      cy.viewport(390, 844)
    })

    it("renders page heading", () => {
      cy.visit("/target-page")
      cy.get("h1").should("be.visible")
    })

    it("shows bottom tab bar, hides sidebar", () => {
      cy.visit("/target-page")
      cy.get("[data-testid='bottom-tab-bar']").should("exist")
        .should("have.css", "display", "flex")
      cy.get("[data-testid='sidebar-nav']").should("not.be.visible")
    })

    it("can navigate via bottom tab bar", () => {
      cy.visit("/target-page")
      cy.get("[data-testid='bottom-tab-dashboard']").click()
      cy.url().should("include", "/dashboard")
    })
  })
})
```

### Table page mobile assertions (canonical project pattern)
```typescript
// Source: responsive-layouts.cy.ts
context("at mobile viewport (390x844)", () => {
  beforeEach(() => cy.viewport(390, 844))

  it("shows card layout, not table", () => {
    cy.visit("/loans")
    cy.get("[data-slot='table-container']").should("not.be.visible")
    cy.get("[data-testid='data-row']").filter(":visible").should("have.length.gte", 1)
    cy.get("[data-testid='data-row']").filter(":visible").first()
      .should("contain.text", "Expected Customer Name")
  })
})
```

### Tab bar dedicated spec structure (for tab-bar.cy.ts)
```typescript
// Source: mobile-navigation.cy.ts (extract and focus)
describe("Bottom Tab Bar", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Tab Bar Tester" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
    cy.viewport(390, 844)
  })

  it("renders 5 primary tabs", () => {
    cy.get("[data-testid='bottom-tab-bar']").should("exist")
      .should("have.css", "display", "flex")
    ;["dashboard", "customers", "payments", "loans", "more"].forEach((tab) => {
      cy.get(`[data-testid='bottom-tab-${tab}']`).should("exist")
    })
  })

  it("switches active tab on navigation", () => {
    cy.get("[data-testid='bottom-tab-customers']").click()
    cy.url().should("include", "/customers")
    cy.get("[data-testid='bottom-tab-customers']").should("have.class", "text-primary")
    cy.get("[data-testid='bottom-tab-dashboard']").should("have.class", "text-muted-foreground")
  })

  it("More tab opens sheet with 5 secondary items", () => {
    cy.get("[data-testid='bottom-tab-more']").click()
    cy.get("[data-testid='more-sheet']").should("be.visible")
    ;["creditors", "expenses", "income", "reports", "watchlist"].forEach((item) => {
      cy.get(`[data-testid='more-item-${item}']`).should("be.visible")
    })
  })

  it("More sheet item navigates and closes sheet", () => {
    cy.get("[data-testid='bottom-tab-more']").click()
    cy.get("[data-testid='more-item-creditors']").click()
    cy.url().should("include", "/creditors")
    cy.get("[data-testid='more-sheet']").should("not.exist")
  })

  it("active indicator renders on current tab", () => {
    cy.get("[data-testid='bottom-tab-dashboard']")
      .find("span.bg-primary")
      .should("have.class", "opacity-100")
  })

  it("tab bar has safe-area-bottom class", () => {
    cy.get("[data-testid='bottom-tab-bar']")
      .should("have.class", "safe-area-bottom")
  })
})
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single viewport tests | Dual `context()` blocks with scoped `cy.viewport()` | Phase 12 | Mobile and desktop are independently verified |
| Raw `data-row` assertions | `.filter(":visible")` at mobile | Phase 13 | Eliminates false positives from dual DOM |
| Hamburger menu navigation | Bottom tab bar / MoreSheet | Phase 12 | All nav specs must test tab bar, not hamburger |
| Dialog-only confirmation modals | DrawerDialog (drawer at mobile, dialog at desktop) | Phase 15 | Specs asserting dialog must account for viewport |

**Deprecated/outdated in this codebase:**
- `button[aria-label='Open navigation menu']` (hamburger): Removed. Tests now assert this does NOT exist.
- `data-slot="dialog-content"` at mobile: Now `data-slot="drawer-dialog-content"` for DrawerDialog components.

## Open Questions

1. **Do admin-panel.cy.ts, design-system.cy.ts, daily-collections.cy.ts, quick-record.cy.ts, reports.cy.ts, transactions.cy.ts, and payments-list.cy.ts have data to render at mobile?**
   - What we know: These specs vary in their data setup complexity.
   - What's unclear: Whether they need seeded data for meaningful mobile card assertions, or if a page-renders check suffices.
   - Recommendation: For specs where seeding is already done in `beforeEach`, add mobile card assertions. For specs with no seeded data, a page-renders + nav check is sufficient and honest.

2. **Does `customer-crud.cy.ts` overlap with `customer-search.cy.ts` for mobile coverage?**
   - What we know: Both cover /customers page.
   - Recommendation: `customer-crud.cy.ts` adds mobile block for the creation form flow; `customer-search.cy.ts` adds mobile block for filter panel behavior.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Cypress 15.12.0 |
| Config file | `cypress.config.ts` |
| Quick run command | `npx cypress run --spec cypress/e2e/tab-bar.cy.ts` |
| Full suite command | `npx cypress run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-02 | All existing specs pass at desktop viewport | e2e | `npx cypress run` | ✅ (all 29 existing specs) |
| TEST-03 | Mobile viewport block in every spec | e2e | `npx cypress run` | ❌ Wave 0 — 25 files need mobile blocks added |
| TEST-04 | Dedicated tab bar spec verifies switching, More sheet, active state, safe-area | e2e | `npx cypress run --spec cypress/e2e/tab-bar.cy.ts` | ❌ Wave 0 — new file |

### Sampling Rate
- **Per task commit:** `npx cypress run --spec cypress/e2e/<modified-spec>.cy.ts`
- **Per wave merge:** `npx cypress run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `cypress/e2e/tab-bar.cy.ts` — covers TEST-04 (new file, does not exist)
- [ ] Mobile viewport `context()` blocks in 25 existing spec files — covers TEST-03

*(No framework install needed — Cypress + cypress-real-events already installed)*

## Sources

### Primary (HIGH confidence)
- `/Users/faridmatovu/projects/money-lending/cypress/e2e/mobile-navigation.cy.ts` — canonical mobile viewport context pattern
- `/Users/faridmatovu/projects/money-lending/cypress/e2e/responsive-layouts.cy.ts` — canonical dual-DOM `.filter(":visible")` pattern
- `/Users/faridmatovu/projects/money-lending/cypress/e2e/touch-optimization.cy.ts` — DrawerDialog mobile assertions, swipe helper
- `/Users/faridmatovu/projects/money-lending/cypress/e2e/forms-filters-table-polish.cy.ts` — FilterPanel mobile pattern
- `/Users/faridmatovu/projects/money-lending/.planning/STATE.md` — Decisions: global viewport must not change, scoped beforeEach convention

### Secondary (MEDIUM confidence)
- All 25 remaining spec files — read to catalog current coverage and identify mobile gaps
- `cypress.config.ts` — confirmed no global viewport override, default is desktop-sized

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new installs, versions confirmed from package.json
- Architecture: HIGH — all patterns directly from existing project spec files
- Pitfalls: HIGH — drawn from STATE.md decisions and direct inspection of dual-DOM pattern
- Gap analysis: HIGH — all 29 spec files directly read; 4 confirmed with mobile blocks, 25 without

**Research date:** 2026-03-25
**Valid until:** 2026-04-25 (stable test infrastructure, no fast-moving dependencies)
