# Pitfalls Research

**Domain:** Responsive mobile/desktop layout — adding bottom tab bar and mobile-adaptive data tables to an existing desktop-first Next.js financial lending app
**Researched:** 2026-03-24
**Milestone context:** v1.2 — making the shipped app responsive across mobile, tablet, and desktop
**Confidence:** HIGH (codebase directly inspected; Cypress test corpus analysed; patterns verified against official sources)

---

## Critical Pitfalls

### Pitfall 1: Cypress Navigation Tests Target `nav` Selectors That Are Hidden on Mobile

**What goes wrong:**
The existing `payments-list.cy.ts` (line 379) contains `cy.get("nav").contains("a", "Payments").click()`. The current sidebar renders as `hidden md:flex` — visible at desktop viewports, absent at mobile viewports. After adding a bottom tab bar, there will be two navigation surfaces in the DOM simultaneously. On a mobile-sized viewport, the sidebar `<nav>` is hidden; on a desktop viewport, the bottom tab bar `<nav>` is hidden. An unscoped `cy.get("nav").contains("a", ...)` will find whichever element Cypress encounters first — which may be the wrong one, or a visually hidden one — producing "element is not visible" errors or silently clicking the wrong link.

**Why it happens:**
Tests were written for a single-nav desktop layout. Adding a second nav element to the DOM without updating selectors creates ambiguity. This is not caught by TypeScript or lint.

**How to avoid:**
- Before adding the bottom tab bar to the DOM, audit every Cypress spec for unscoped navigation assertions. Grep for `cy.get("nav")`, `cy.contains("a",` and `cy.get("nav").contains`. There are at least 2 instances across the corpus.
- Add `data-testid="sidebar-nav"` to the sidebar `<nav>` element and `data-testid="bottom-tab-bar"` to the mobile nav element.
- Scope all existing navigation assertions: `cy.get("[data-testid='sidebar-nav']").contains("a", "Payments").click()`.
- Mobile-specific nav tests target `[data-testid='bottom-tab-bar']` and run with `cy.viewport("iphone-se2")` in their own `beforeEach`.

**Warning signs:**
- Any `cy.get("nav").contains(...)` or unscoped `cy.contains("a", ...)` in a test that does not start with `cy.viewport(...)`.
- CI failures that only reproduce when test order changes (caused by leftover viewport state).

**Phase to address:**
Phase 1 (Bottom Tab Bar) — update selectors before adding the second nav element to the DOM. This is a prerequisite, not a follow-up.

---

### Pitfall 2: Existing Table Tests Break When Tables Become Card Stacks

**What goes wrong:**
Multiple tests assert `cy.get("table tbody tr").should("have.length.at.least", 1)` and `cy.contains("th", "Customer")` (e.g., `payments-list.cy.ts` lines 59–60, 66–73; `loans-list.cy.ts` lines 50–52). When the responsive rewrite conditionally renders `<table>` only on `md:` and above, these selectors find zero matching elements on a mobile viewport. If the test is running at a mobile viewport — either explicitly or because the global viewport was changed — it fails with a misleading "expected to exist" error.

**Why it happens:**
The most common responsive table pattern replaces `<table>` with conditional rendering: `<div className="hidden md:block"><table>...</table></div>` plus `<div className="md:hidden">{rows.map(row => <Card />)}</div>`. The `<table>` still exists in the DOM but is not visible. Cypress finds the hidden table but `tbody tr` is empty because only the card markup has been rendered.

**How to avoid:**
- Add `data-testid="data-row"` to both `<tr>` elements (desktop table) and mobile `<div>` cards. Assertions become `cy.get("[data-testid='data-row']").should("have.length.at.least", 1)` — viewport-agnostic.
- Assertions about column headers (`cy.contains("th", ...)`) should only appear in tests that explicitly call `cy.viewport(1280, 800)` first.
- Add this `data-testid` attribute to BOTH the table row AND the card markup before changing any layout — do this as a prerequisite task in Phase 2.

**Warning signs:**
- `cy.get("table tbody tr")` without a preceding `cy.viewport(1280, 800)` call.
- `cy.contains("th", ...)` in a test that may run at a narrow viewport.
- A test that passes at the default 1000px viewport but fails when run with `--config viewportWidth=375`.

**Phase to address:**
Phase 2 (Data Tables — Payments, Loans, Customers) — add `data-testid="data-row"` before modifying any table markup.

---

### Pitfall 3: Bottom Tab Bar Clipped by iOS Safe Area / Home Indicator

**What goes wrong:**
A `position: fixed; bottom: 0` bottom bar sits directly over the iOS home indicator strip (34px on iPhone X+) unless `env(safe-area-inset-bottom)` padding is applied. On iOS Safari in PWA mode, the home indicator is always visible. The bar is partially obscured and tapping near the bottom may activate the wrong tab or fail to tap at all.

A secondary failure: Next.js route transitions can reset `env(safe-area-inset-bottom)` to `0px` mid-session (documented in vercel/next.js discussion #81264). If the safe-area value is read only at mount time and stored in state, it becomes stale after navigation.

**Why it happens:**
CSS `env()` variables referencing safe area insets are not standard CSS; they are injected by the browser's layout engine. Route transitions in Next.js App Router can cause re-layout events where the variable temporarily reports `0`. Using a hardcoded pixel height for the bottom bar is the common shortcut that avoids this — but it does not work on iPhones.

**How to avoid:**
- Set `viewport-fit=cover` in the viewport meta tag in `src/app/layout.tsx`.
- Bottom bar CSS: `padding-bottom: env(safe-area-inset-bottom)` applied directly in the CSS/Tailwind class, not stored in JavaScript state. Use `pb-[env(safe-area-inset-bottom)]` or a CSS variable.
- The bar's container height: `h-[calc(3.5rem+env(safe-area-inset-bottom))]` (fixed nav height + dynamic safe area).
- The `<main>` element in `AppShell` must add a bottom padding equal to the total bar height so content is not occluded: `pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0`.
- Use `dvh` instead of `vh` for full-height containers to handle the dynamic viewport change when the iOS keyboard appears.

**Warning signs:**
- Bottom bar height defined as `h-14` with no safe-area modifier.
- `min-h-screen` or `h-screen` used on page wrappers without a `dvh` fallback.
- Testing only on Chrome DevTools mobile emulation — it does not simulate the iOS safe area notch.

**Phase to address:**
Phase 1 (Bottom Tab Bar) — must be solved at creation time, not retrofitted after.

---

### Pitfall 4: Tailwind Mobile-First Direction — `sm:hidden` Does Not Mean "Hidden on Mobile"

**What goes wrong:**
A developer writes `sm:hidden` intending "hide this on small (mobile) screens." In Tailwind CSS, `sm:hidden` means "hidden at 640px and above." The element remains fully visible on 375px mobile screens. This is the most common Tailwind responsive mistake and produces no warnings — the CSS compiles correctly; it just does the opposite of what was intended.

**Why it happens:**
Tailwind is mobile-first. Breakpoint prefixes (`sm:`, `md:`, `lg:`) activate at that width and all widths above. There is no built-in max-width prefix. Developers coming from Bootstrap (`d-sm-none` = "hidden on small screens") invert this constantly.

**The correct idioms:**
- **Hide on mobile, show on desktop:** `hidden md:flex` (or `hidden md:block`) — already used correctly in the existing sidebar.
- **Show on mobile, hide on desktop:** `md:hidden` — use this for the bottom tab bar.

**How to avoid:**
- Establish these two idioms as a code-review checklist item at the start of Phase 1.
- A project-level grep for `sm:hidden` or `sm:block` in responsive layout code is a mandatory PR step.

**Warning signs:**
- Any `sm:hidden`, `sm:block`, or `sm:flex` used for mobile visibility control (as opposed to `md:` or `lg:`).
- A component that looks wrong on mobile after a breakpoint class was recently added.

**Phase to address:**
Phase 1 (Foundation/App Shell) — establish the convention before touching any page.

---

### Pitfall 5: Two Navigation Elements in the DOM Create Ambiguous `cy.contains("a", ...)` Matches

**What goes wrong:**
After adding the bottom tab bar, both the sidebar `<nav>` (desktop) and the bottom tab `<nav>` (mobile) exist in the DOM simultaneously at all viewports — one is `md:hidden`, the other is `hidden md:flex`. Cypress by default can find elements that are `display: none`. An unscoped `cy.contains("a", "Payments")` or `cy.contains("Payments")` will return the first DOM match, which may be the hidden tab bar link — causing incorrect navigation or test flakiness that is very hard to debug.

**Why it happens:**
`cy.contains("a", text)` traverses the entire DOM depth-first. Two `<a>` elements with the same text means the first encountered wins, which is DOM-order dependent and layout-dependent.

**How to avoid:**
- Scope every sidebar navigation assertion to `[data-testid='sidebar-nav']` before adding the second nav.
- Bottom tab bar links use `data-testid="tab-{name}"` (e.g., `data-testid="tab-payments"`).
- Run `grep -r "cy.contains(\"a\"" cypress/e2e/` to find all unscoped link assertions and fix them as a prerequisite task.

**Warning signs:**
- Any `cy.contains("a", ...)` not preceded by `.within(...)` or `.get("[data-testid=...]").contains(...)`.
- Tests that were deterministic but become flaky after adding the bottom tab bar.

**Phase to address:**
Phase 1 (Bottom Tab Bar) — fix before adding the bar.

---

### Pitfall 6: Changing the Global Viewport in `cypress.config.ts` Breaks All 25 Existing Tests

**What goes wrong:**
Adding `viewportWidth: 375` to the global `cypress.config.ts` e2e block (to "default to mobile") silently breaks every existing desktop test. The sidebar is hidden at 375px. Tests that click sidebar links, assert table column headers, or navigate via `cy.get("nav")` will fail. This would break all 25 existing spec files simultaneously.

**Why it happens:**
The natural impulse when writing mobile tests is to "set the default to mobile." But the current test corpus was written for the Cypress default of 1000×660px and is not viewport-aware.

**How to avoid:**
- Never change the global `viewportWidth` in `cypress.config.ts`. Leave the default at 1000px (add a comment documenting this intention).
- Mobile viewport tests live in dedicated spec files that call `cy.viewport("iphone-se2")` or `cy.viewport(375, 812)` in `beforeEach`.
- Alternatively, use a scoped `describe` block with its own `beforeEach(() => cy.viewport("iphone-se2"))`.

**Warning signs:**
- `viewportWidth` or `viewportHeight` appearing in the root `e2e: {}` block of `cypress.config.ts`.
- A mass failure of existing tests with "element is not visible" errors after a config change.

**Phase to address:**
Phase 1 — establish this rule before writing the first mobile-specific Cypress test.

---

### Pitfall 7: Touch Tap Targets Below 44×44px Cause `cypress-real-events` Failures

**What goes wrong:**
The existing `cy.selectOption()` command uses `cypress-real-events` `.realClick()`, which dispatches pointer events at the element's computed bounding box center. If an interactive element (bottom tab icon, row action button) is smaller than 44×44px, a 1px positioning error from scroll offset or CSS transform can miss the target — producing intermittent test failures that do not reproduce consistently and are hard to debug.

**Why it happens:**
Small elements have a small target area. `cypress-real-events` uses actual pixel coordinates, not DOM-level click simulation. The `button[aria-label='Payment actions']` row buttons in the payments tests (`payments-list.cy.ts` line 205) are already at risk — they are icon-only buttons. At a narrower viewport where layout is denser, hit testing becomes less reliable.

**How to avoid:**
- Minimum touch target: 44×44px (`min-w-[44px] min-h-[44px]`) on all interactive elements in the bottom tab bar and row action menus. Use negative margin or padding to expand the tap area without changing visual size.
- In Cypress tests, use `.scrollIntoView()` before `.realClick()` at mobile viewports — this eliminates scroll-offset positioning errors.
- Do not use `{ force: true }` to paper over layout-related click failures. If `{ force: true }` is needed, the layout has a bug.

**Warning signs:**
- Bottom tab icons with `h-6 w-6` (24px) and no surrounding padding that increases the tap area.
- Intermittent `cypress-real-events` failures that pass on retry.

**Phase to address:**
Phase 1 (Bottom Tab Bar); Phase 2+ for any interactive control that may shrink at mobile viewports.

---

### Pitfall 8: Active Tab State Not Reflecting Nested Routes

**What goes wrong:**
The bottom tab bar shows "Loans" as active when on `/loans`. It must also show "Loans" as active on `/loans/new`, `/loans/{id}`, `/loans/{id}/payments/new`, etc. If the active check uses `pathname === item.href` (exact match), the active indicator disappears the moment the user navigates to a sub-route — causing confusing visual feedback.

**Why it happens:**
Exact pathname matching is the default when implementing a simple active check. The existing sidebar already has the correct pattern (`pathname === item.href || pathname.startsWith(item.href + "/")`), but a bottom tab bar implemented from scratch will recreate this mistake.

**How to avoid:**
- Copy the existing sidebar `isActive` logic verbatim: `pathname === item.href || pathname.startsWith(item.href + "/")`.
- The tab bar and sidebar share the same `navGroups` config — use that shared config for the bottom tab bar to ensure the route list and active logic stay in sync.

**Warning signs:**
- Bottom tab bar active indicator disappearing when navigating to a sub-page (e.g., opening a loan, visiting a customer).

**Phase to address:**
Phase 1 (Bottom Tab Bar implementation).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `overflow-x-auto` wrapper on tables without mobile card alternative | Tables "work" on mobile via horizontal scroll | Unusable on 5-inch phones; loan officers miss data; primary use case is broken | Never — this is an in-field tool used by loan officers |
| Using `{ force: true }` broadly in Cypress tests to skip visibility checks | Tests pass during rewrite | Masks layout bugs; tests become meaningless; breaks the trust-but-verify contract | Only for intentionally icon-only buttons where the visual affordance is smaller than the accessible area |
| Duplicating nav link lists (sidebar + bottom tab bar) without a shared config | Quicker to implement separately | Two sources of truth for routes; rename/add a page → update two places; easy to drift | Never — share `navGroups` config from the existing sidebar |
| Hardcoded `bottom: 0` without safe-area insets | Works on Android Chrome and desktop | Clips under iOS home indicator on iPhone X+ — looks broken to 60%+ of mobile users | Never — 2 lines of CSS prevent this |
| Keeping desktop breakpoints only (`md:`) and never running tests at 375px | Faster development | The entire v1.2 milestone goes unverified | Never for this milestone |
| Applying responsive classes directly to 9 pages without a shared `PageHeader` / `FilterBar` layout primitive | Faster to ship first page | Every subsequent page is a copy-paste variation; responsive bugs fixed in one page are not propagated | Acceptable for the first 1-2 pages while discovering the pattern; then extract the primitive |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| shadcn/ui `Sheet` component + mobile viewport | Assuming a Sheet (used for mobile sidebar drawer, edit forms) respects parent viewport CSS classes — it renders in a React portal outside the layout tree | Test Sheet components explicitly at `cy.viewport("iphone-se2")`; portal elements need their own height/overflow constraints |
| Next.js App Router + fixed bottom tab bar | Placing the bottom tab bar inside a page component or inside `<main>` — App Router wraps pages in its own scroll container; `position: fixed` inside that container is viewport-relative, not page-relative | Place the bottom tab bar in `AppShell`, as a sibling to `<main>`, not nested inside any page |
| `cypress-real-events` + mobile viewport | `.realClick()` uses actual pointer coordinates; after `cy.viewport("iphone-se2")`, layout reflows and elements can shift | Call `cy.get(...).scrollIntoView()` before `.realClick()` on every mobile-viewport test |
| TanStack Query + layout refactor (table → card) | Changing the presentational component (table vs. cards) can accidentally move data fetching from the server (RSC) to the client, adding a loading spinner that did not exist before | Keep data fetching in Server Components; only the presentational layer (`<DataTable>` vs. `<DataCards>`) changes by viewport |
| Tailwind + base-ui/shadcn popups | Dropdown menus, Select popovers, and Sheet overlays may overflow the viewport on 375px screens if they were sized for desktop | Test every interactive overlay at `cy.viewport(375, 812)` as part of Phase 2 data table work |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Rendering both `<table>` and card stacks in the DOM simultaneously with CSS `hidden` | Double DOM nodes per row; 200+ payments = 400+ DOM nodes; React reconciliation is heavier | Use conditional rendering based on a `useBreakpoint` hook, or render only one representation and switch at a CSS breakpoint using Tailwind (acceptable for ≤50 rows; prefer conditional rendering above that) | At ~100+ rows per page in card mode |
| JS-driven responsive logic (resize event listeners, `window.innerWidth` on every render) | Jank on mobile; layout thrash; hydration mismatch (SSR always returns desktop markup) | Pure Tailwind breakpoint CSS for layout switching; no JS needed | From the first page visit |
| Bottom tab bar re-rendering on every navigation because route state is stored in component state | Tab bar flickers on route change; selected tab indicator jumps | Active tab state must derive only from `usePathname()` — a stable hook, not a component state variable | Not scale-dependent — a correctness issue from day 1 |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| More than 5 items in the bottom tab bar | Tabs are too small to read on 5.4" screens; thumb coverage issues | Maximum 5 tabs. The app has 8+ nav sections — group secondary items (Creditors, Reports, Admin, Watchlist) into an "overflow" or "More" tab, or keep them sidebar-only for tablet+ where there is space |
| Primary row actions hidden in a dropdown on mobile | Recording a payment requires 3 taps instead of 1 — unacceptable for high-frequency workflows | Primary action (e.g., "Record Payment" on a loan row) must be a direct visible button on mobile; dropdowns are acceptable on desktop |
| Sheet / dialog height not accounting for the virtual keyboard | Form inputs in sheets are inaccessible when the keyboard is raised (e.g., the Quick Record payment amount field on phones) | Use `max-h-[calc(100dvh-env(safe-area-inset-top))]` on sheets; switch from `vh` to `dvh` for all full-height containers |
| Page titles and filter bars creating dead space at the top of every page on mobile | Staff must scroll past a 100px+ dead zone to reach the first data row on a 375px screen | On mobile, the page title moves to the top bar (the existing `TopBar` component already has a title slot); filter bars collapse to a `Filters` toggle button |
| Active tab state not reflecting nested routes (Pitfall 8 duplicate in UX context) | Tab indicator disappears on sub-pages; staff lose their navigation context | Use `pathname.startsWith(item.href)` for active matching — same as the existing sidebar |

---

## "Looks Done But Isn't" Checklist

- [ ] **Bottom tab bar safe area:** `env(safe-area-inset-bottom)` applied — verify on real iPhone (or Xcode Simulator), not Chrome DevTools which does not simulate the notch.
- [ ] **Data tables on mobile:** Card view tested at 375px AND 414px — layout must render correctly at both widths.
- [ ] **Existing Cypress suite:** All 25 existing spec files pass without modification to their assertions — run `npx cypress run` against the full suite after each phase.
- [ ] **Navigation selector scoping:** Every `cy.get("nav").contains(...)` in existing tests is scoped to `[data-testid='sidebar-nav']` — grep for unscoped nav selectors before every phase merge.
- [ ] **`<main>` bottom padding on mobile:** Content is not obscured behind the tab bar on pages with short content — check the dashboard and empty-state pages at 375px.
- [ ] **Touch targets 44×44px:** Bottom tab icons and row action buttons have a minimum 44×44px tap area — verify with Chrome DevTools "Accessibility" > "Show tap targets" overlay.
- [ ] **Virtual keyboard:** All sheet forms scroll correctly when the keyboard is raised — focus the last input in the Quick Record and Edit Payment sheets on a phone.
- [ ] **Tablet sidebar preserved:** The existing sidebar still renders correctly at `md:` (768px) — responsive rewrite must not remove tablet navigation.
- [ ] **Active tab on sub-routes:** Navigate to `/loans/new` and verify the "Loans" tab in the bottom tab bar shows as active.
- [ ] **Viewport default unchanged:** `cypress.config.ts` `viewportWidth` remains unset (defaults to 1000px) — verify the config file was not modified.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Navigation selector ambiguity (Pitfalls 1 + 5) | MEDIUM | Grep all 25 spec files for `cy.get("nav")` and `cy.contains("a")`; scope each to the correct testid; re-run full suite |
| Table tests broken by card layout (Pitfall 2) | MEDIUM | Add `data-testid="data-row"` to both `<tr>` and card `<div>`; change all `cy.get("table tbody tr")` assertions to use the testid |
| iOS safe area clipping (Pitfall 3) | LOW | Add `env(safe-area-inset-bottom)` to bar padding and `<main>` bottom padding; 2-line CSS fix; verify on device |
| Tailwind breakpoint direction errors (Pitfall 4) | LOW–MEDIUM | Regex search for `sm:hidden` and `sm:block` in all modified files; correct each instance |
| Global viewport change breaking all tests (Pitfall 6) | HIGH | Revert the global viewport change immediately; move `cy.viewport()` calls into per-describe `beforeEach` blocks |
| Performance from dual-rendering table + cards | MEDIUM | Switch to conditional React rendering with `useBreakpoint` hook; remove the hidden duplicate DOM tree |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Unscoped nav selectors (Pitfalls 1 + 5) | Phase 1 — before adding bottom tab bar | Grep for `cy.get("nav")` across all specs; zero unscoped matches allowed |
| Table test breakage (Pitfall 2) | Phase 2 — before changing any table markup | Add `data-testid="data-row"` to all table rows and mobile cards; grep for `cy.get("table tbody tr")` |
| iOS safe area (Pitfall 3) | Phase 1 — bottom tab bar creation | Manual test on iOS Simulator; `env(safe-area-inset-bottom)` in computed styles |
| Tailwind breakpoint direction (Pitfall 4) | Phase 1 — foundation convention | PR checklist: grep diff for `sm:hidden`, `sm:block`, `sm:flex` |
| Global Cypress viewport change (Pitfall 6) | Phase 1 — before first mobile test | CI runs full existing suite after every PR; zero existing failures allowed |
| Touch target size (Pitfall 7) | Phase 1 for tab bar; Phase 2+ for table row actions | Chrome DevTools tap target overlay; `.realClick()` tests pass without `{ force: true }` |
| Active tab on nested routes (Pitfall 8) | Phase 1 — bottom tab bar implementation | Cypress test: visit `/loans/new`, assert `[data-testid='tab-loans']` has active indicator |
| Too many tab bar items (UX) | Phase 1 — design review before implementation | Tab count ≤ 5; confirmed by code review |
| Dual DOM render performance | Phase 2+ — data tables | Lighthouse mobile performance score; DOM node count |

---

## Sources

- Codebase inspection: `src/components/layout/sidebar.tsx` — existing `isActive` logic and `navGroups` config (HIGH confidence)
- Codebase inspection: `src/components/layout/app-shell.tsx` — existing `hidden md:flex` sidebar pattern (HIGH confidence)
- Codebase inspection: `cypress/e2e/payments-list.cy.ts` lines 59–60, 205, 379 — unscoped table and nav selectors (HIGH confidence)
- Codebase inspection: `cypress/support/commands.ts` — `cypress-real-events` `.realClick()` usage (HIGH confidence)
- Codebase inspection: `cypress.config.ts` — no explicit viewportWidth set; default is 1000px (HIGH confidence)
- Cypress `cy.viewport()` documentation: https://docs.cypress.io/api/commands/viewport (HIGH confidence)
- Cypress Real World App — responsive layout testing: https://learn.cypress.io/real-world-examples/app-layout-and-responsiveness (MEDIUM confidence)
- Tailwind CSS responsive design (mobile-first breakpoints): https://tailwindcss.com/docs/responsive-design (HIGH confidence)
- iOS safe area + Next.js routing regression: https://github.com/vercel/next.js/discussions/81264 (MEDIUM confidence)
- Bottom tab bar safe area coverage: https://github.com/lobehub/lobehub/issues/10454 (MEDIUM confidence)
- Cypress visibility + `display: contents` / `overflow: hidden`: https://github.com/cypress-io/cypress/issues/25199 (HIGH confidence)
- Responsive Tailwind tables: https://tryhoverify.com/blog/how-to-build-responsive-tables-that-dont-break-on-mobile-a-step-by-step-guide-with-css-grid-and-tailwind/ (MEDIUM confidence)

---

*Pitfalls research for: v1.2 Responsive — adding mobile layout to existing desktop-first money lending app*
*Researched: 2026-03-24*

---

## v1.1 Pitfalls (Retained for Reference)

The following pitfalls were documented during v1.1 (Payments) research. They are addressed in the shipped codebase and retained here as reference.

<details>
<summary>v1.1 Payments pitfalls (click to expand)</summary>

- **Soft-delete blindness** (Pitfall v1.1-1) — Addressed: `isNull(deletedAt)` filter in global payments query.
- **UTC vs. local calendar day in daily collections** (Pitfall v1.1-2) — Addressed: `DATE(payment_date AT TIME ZONE 'Africa/Kampala')` grouping.
- **`revalidatePath` scope too narrow after quick-record** (Pitfall v1.1-3) — Addressed: `/payments` added to revalidation set.
- **No loan-active guard in quick-record** (Pitfall v1.1-4) — Addressed: server-side status check.
- **Double-submission of quick-record form** (Pitfall v1.1-5) — Addressed: `disabled={isPending}` pattern.
- **N+1 queries for customer/loan enrichment** (Pitfall v1.1-6) — Addressed: single JOIN query in global payments service.
- **TanStack Query cache key fragmentation** (Pitfall v1.1-7) — Addressed: shared `paymentsKeys` factory.
- **Loan search loading all active loans** (Pitfall v1.1-8) — Addressed: debounced server-side search.
- **Native float in daily collections aggregation** (Pitfall v1.1-9) — Addressed: SQL SUM aggregation.
- **Receipt link using wrong ID** (Pitfall v1.1-10) — Addressed: `data.id` (payment UUID) used.
- **Date range off-by-one** (Pitfall v1.1-11) — Addressed: end-of-day upper bound.

</details>
