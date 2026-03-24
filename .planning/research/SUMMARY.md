# Project Research Summary

**Project:** Money Lending Management System — v1.2 Responsive Milestone
**Domain:** Responsive mobile + desktop layout for a financial/lending management web app
**Researched:** 2026-03-24
**Confidence:** HIGH

## Executive Summary

The v1.2 milestone is a pure UI responsiveness layer over a fully-shipped v1.1 product — no new features, no new npm dependencies, no backend changes. The entire feature set (Customers, Loans, Payments, Collections, Creditors, Expenses, Income, Reports, Watchlist, Simulator, Notifications, Dashboard) is already built and working on desktop. The task is adapting every existing UI surface to work correctly on phones (360–430px wide) while keeping the desktop experience unchanged. The recommended approach is a clean breakpoint-based split: bottom tab bar navigation for mobile (`< md`, hidden via `md:hidden`), sidebar navigation for tablet/desktop (`hidden md:flex`), and dual-render table/card layouts controlled by Tailwind CSS media queries — no JavaScript viewport detection.

The primary architectural additions are three new components: `BottomTabBar` (fixed-position, mobile-only, 5 primary tabs), `ResponsiveTable` (CSS show/hide wrapper rendering `<Table>` on desktop and stacked `<Card>` elements on mobile), and a `use-mobile.ts` hook. All are built from existing primitives already installed in the stack (Tailwind CSS v4, lucide-react, shadcn/ui, @base-ui/react, next/navigation). The build order is strict: AppShell and BottomTabBar first (foundation), then responsive table primitive, then per-page card layouts ordered from simplest to most complex (Dashboard → Customers → Watchlist → Creditors → Loans → Expenses/Income → Payments → Reports), then a final Cypress mobile viewport pass.

The highest-risk area is the existing Cypress test corpus: 25 spec files written exclusively at desktop viewport with unscoped `cy.get("nav")` and `cy.contains("a", ...)` selectors. Adding a second `<nav>` element (the bottom tab bar) to the DOM will cause immediate test failures unless navigation selectors are scoped with `data-testid` before the new component is added. This prerequisite must happen before any layout work begins. iOS safe-area insets are the second critical risk — `env(safe-area-inset-bottom)` must be applied in CSS (not JavaScript state) from the moment the bottom tab bar is created, or the bar will clip the iOS home indicator on iPhones.

---

## Key Findings

### Recommended Stack

No new npm packages are needed. The installed stack (Next.js 16, React 19, Tailwind CSS v4, shadcn/ui, @base-ui/react, lucide-react, next/navigation, Cypress 15) provides everything required to build bottom tab bar navigation, responsive card layouts, safe-area inset handling, and multi-viewport Cypress tests.

**Core technologies (all already installed):**
- **Tailwind CSS v4** — responsive breakpoints via `sm:`, `md:`, `lg:` prefixes; the `md` breakpoint (768px) is the primary mobile/non-mobile boundary already used by the sidebar
- **lucide-react 0.577.0** — provides all icons for the 5-tab bottom nav bar (LayoutDashboard, Users, Banknote, CreditCard, MoreHorizontal)
- **@base-ui/react 1.3.0** — `<Sheet side="bottom">` for the "More" overflow drawer on mobile; already used in the codebase
- **next/navigation `usePathname()`** — active tab detection, identical pattern already in `sidebar.tsx`
- **Cypress 15 `cy.viewport()`** — multi-viewport test support, no plugin needed; `cypress-real-events` (already installed) covers touch event testing

**Critical version notes:**
- Tailwind v4 uses CSS-first configuration (`@import "tailwindcss"` in `globals.css`) — no `tailwind.config.js`. Custom breakpoints go in `globals.css` via `@theme`.
- `@base-ui/react` does NOT support Radix's `asChild` prop. Do not import `@radix-ui/react-*` alongside it.

### Expected Features

**Must have (v1.2 launch blockers):**
- Bottom tab bar navigation on mobile (5 primary tabs + "More" sheet) — replaces hamburger pattern; primary mobile nav surface
- Responsive data tables → card layout for all 8+ list pages — tables with 5–7 columns are unusable at 360px
- Touch-friendly tap targets across all interactive elements (min 44×44px) — required for WCAG 2.5.8 Level AA (effective June 2025)
- Single-column form layout on mobile for all forms (loan wizard, customer registration, creditor form)
- Content padding corrected — remove hardcoded `p-6` from 9 page components that override AppShell's responsive `p-4 md:p-6`
- Horizontal scroll scoped to table containers — prevents iOS Safari browser-back gesture conflicts
- Cypress tests with mobile viewport (390px) coverage for all pages — required by AGENTS.md

**Should have (add when P1s complete, do not block launch):**
- Quick-record payment accessible from bottom tab (1 tap to start; reuses existing QuickRecord component)
- Sticky page header with title + primary CTA (prevents scroll-to-top on long lists)
- Collapsible filter row on mobile (filter bars consume 3–4 rows and push content below fold)
- DrawerDialog pattern — bottom Drawer on mobile instead of centered Dialog
- Card skeleton loading states matching card layout (animated `pulse` skeletons for list pages)

**Defer to v2+:**
- Swipe gesture navigation between tabs (requires Framer Motion or touch event API)
- Offline-capable service worker / PWA — explicitly out of scope per PROJECT.md
- Native iOS/Android app — out of scope per PROJECT.md
- Push notifications — requires service worker + VAPID infrastructure not planned for v1.2

### Architecture Approach

The v1.2 responsive architecture makes no changes to the data layer, routes, or service/action layer — all changes are confined to layout components and UI primitives. `BottomTabBar` lives inside `AppShell` (the `"use client"` component, already inside `<Providers>`), not in `layout.tsx` or individual pages. This is the only placement where `useSession` and `usePathname` are available and where the component is automatically applied to all app pages. The `<main>` element in AppShell must add `pb-16 md:pb-0` to reserve 64px above the fixed-position tab bar on mobile.

**Major new components:**
1. **`BottomTabBar`** (`src/components/layout/bottom-tab-bar.tsx`) — fixed `bottom-0`, `md:hidden`, 5 primary tabs, active state via `pathname.startsWith(item.href)`, safe-area inset padding applied in CSS
2. **`ResponsiveTable`** (`src/components/ui/responsive-table.tsx`) — CSS show/hide wrapper; renders `<Table>` on `md+` and `<Card>` stacks on mobile; avoids JS viewport detection to prevent hydration mismatch
3. **`use-mobile.ts`** (`src/hooks/use-mobile.ts`) — 10-line `window.matchMedia('(max-width: 767px)')` hook; used only for imperative logic, not for layout switching (CSS handles layout)

**No changes needed to:** sidebar.tsx (structural behavior unchanged), top-bar.tsx (hamburger already `md:hidden`), all Server Actions, services, TanStack Query hooks, or database schema.

**Modified files:** `app-shell.tsx` (add BottomTabBar + `pb-16 md:pb-0`), all 11 page components (replace `<Table>` with responsive pattern, adjust padding), all Cypress spec files (add mobile viewport blocks).

### Critical Pitfalls

1. **Unscoped Cypress `cy.get("nav")` selectors break on dual-nav DOM** — After adding `BottomTabBar`, two `<nav>` elements exist simultaneously in the DOM. Unscoped `cy.get("nav").contains("a", "Payments")` finds whichever is first — causing failures or wrong navigation. Add `data-testid="sidebar-nav"` and `data-testid="bottom-tab-bar"` before adding the component; scope all existing nav assertions to `[data-testid='sidebar-nav']`. This must be a prerequisite task in Phase 1.

2. **Existing table tests fail when tables become card stacks** — Tests asserting `cy.get("table tbody tr")` find zero rows when the table is CSS-hidden on mobile. Add `data-testid="data-row"` to both `<tr>` elements and mobile cards before touching any table markup; change all table row assertions to use the viewport-agnostic testid.

3. **iOS safe-area inset clips bottom tab bar** — A `position: fixed; bottom: 0` bar without `env(safe-area-inset-bottom)` is partially obscured by the iOS home indicator (34px on iPhone X+). Set `viewport-fit=cover` in `layout.tsx` viewport meta tag and apply `padding-bottom: env(safe-area-inset-bottom)` directly in CSS — never store this in JavaScript state (Next.js route transitions can reset the CSS variable to `0`).

4. **Tailwind mobile-first breakpoint direction confusion** — `sm:hidden` means "hidden at 640px and above," NOT "hidden on mobile." The correct idioms are `hidden md:flex` (mobile-hidden, desktop-visible) and `md:hidden` (mobile-visible, desktop-hidden). A single wrong breakpoint prefix produces a silent CSS bug. Establish these idioms as a PR checklist item at Phase 1 start.

5. **Changing the global Cypress viewport breaks all 25 existing tests** — Adding `viewportWidth: 375` to `cypress.config.ts` silently fails every existing desktop test. Mobile viewport tests must use `cy.viewport(390, 844)` in their own `beforeEach` block — never change the global config.

---

## Implications for Roadmap

Based on research, the dependency chain is clear and suggests 5 phases with strict ordering at the foundation level and parallelism at the page level.

### Phase 1: Foundation — AppShell + Bottom Tab Bar

**Rationale:** Everything else depends on this. The BottomTabBar establishes mobile navigation; AppShell changes ensure no page content is hidden behind it. Cypress selector scoping must be done here — before any second nav element enters the DOM — or all subsequent phases produce broken tests. This phase also establishes the Tailwind breakpoint conventions that all subsequent phases follow.
**Delivers:** Mobile navigation (5 primary tabs), correct AppShell layout with bottom padding, safe-area inset handling, `data-testid` on both nav surfaces, viewport meta tag with `viewport-fit=cover`, Tailwind breakpoint convention documentation.
**Addresses:** Bottom tab bar navigation (P1), content padding foundation, Cypress mobile test conventions.
**Avoids:** Pitfalls 1, 3, 4, 5, 6 — all must be prevented at this phase, not retrofitted.
**Research flag:** Standard patterns. Skip research-phase; implementation is fully defined.

### Phase 2: Responsive Table Primitive + Simple Pages

**Rationale:** Build the `ResponsiveTable` / card primitive once before applying it across 8+ pages. Validate the pattern on the simplest pages before tackling complex 7-column tables. Add `data-testid="data-row"` as the first task in this phase before touching any table markup.
**Delivers:** `ResponsiveTable` component; responsive card layouts for Dashboard, Customers, Watchlist, Creditors, Notifications pages; hardcoded `p-6` padding removed from all page components.
**Addresses:** Responsive tables → cards (P1) for low-complexity pages; touch tap target fixes (P1); horizontal scroll scoping (P1).
**Avoids:** Pitfall 2 (table test breakage) — `data-testid` added before any markup change.
**Research flag:** Standard patterns. Skip research-phase.

### Phase 3: Complex Page Responsive Layouts

**Rationale:** Loans (5 columns), Expenses/Income (4 columns each), and Payments (7 columns, filter panel, tabs) are the most complex tables. Payments is highest-risk — it has the most columns, a multi-tab layout, and the most assertions in the Cypress corpus. Attack it last after the pattern is validated on simpler pages.
**Delivers:** Responsive card layouts for Loans, Expenses, Income, Payments list, Collections, Repayment Simulator, Admin, Reports; single-column forms on mobile; full-screen dialogs on mobile.
**Addresses:** Responsive tables → cards (P1) for all remaining pages; single-column forms on mobile (P1).
**Avoids:** Pitfall 2 (continued); dual DOM render performance trap (CSS show/hide for ≤50 rows; conditional rendering for high-row-count pages).
**Research flag:** The Payments page filter panel collapse strategy (Accordion vs. Sheet vs. CSS toggle) is a design micro-decision to resolve at the start of this phase — not a full research phase.

### Phase 4: Touch Optimization + P2 Differentiators

**Rationale:** Touch target audits (min 44×44px) and P2 features (sticky headers, collapsible filter row, quick-record tab, DrawerDialog) are independent of page-level responsive work. DrawerDialog requires a quick compatibility check between shadcn Drawer and @base-ui/react before committing — 30-minute verification, not a full research phase.
**Delivers:** WCAG 2.5.8 compliant touch targets across all interactive elements; sticky page headers; collapsible filter bars on Payments/Customers/Loans/Expenses/Income; quick-record shortcut in bottom tab.
**Addresses:** Touch-friendly tap targets (P1 completion); sticky page headers (P2); collapsible filter row (P2); quick-record in bottom tab (P2).
**Avoids:** Pitfall 7 (touch target size causing cypress-real-events click failures).
**Research flag:** DrawerDialog @base-ui/react compatibility needs a verification task at phase start before committing the pattern.

### Phase 5: Cypress Mobile Viewport Coverage

**Rationale:** Mobile Cypress tests can only be written after the responsive implementation exists — they are the verification layer, not a blocker. Per AGENTS.md, all verification must be automated with Cypress. This phase adds `cy.viewport(390, 844)` blocks to every existing spec file plus dedicated mobile-only assertions.
**Delivers:** Full mobile viewport test coverage for all 15+ page specs; verified compliance with AGENTS.md automation requirement; tablet sidebar tests at 768px.
**Addresses:** Cypress mobile viewport tests (P1 requirement per AGENTS.md).
**Avoids:** Pitfall 6 (global viewport change) — tests use scoped viewport calls only.
**Research flag:** Standard Cypress patterns. Skip research-phase; all test patterns are defined in FEATURES.md and PITFALLS.md.

### Phase Ordering Rationale

- **Phase 1 must be first** — Cypress selector scoping and safe-area insets cannot be retrofitted; they produce cascading test failures and device bugs if deferred.
- **Phase 2 before Phase 3** — The `ResponsiveTable` primitive must exist before any page uses it; simple pages validate the pattern before it's applied to complex ones.
- **Phase 3 orders pages by complexity** — Simplest (Dashboard, Customers) first, most complex (Payments with 7-column table and filter panel) last. Front-loads learning and reduces rework.
- **Phase 4 after Phase 3** — Touch targets and P2 features layer on top of responsive layouts; page components need to exist first.
- **Phase 5 is always last** — Tests verify the finished state; writing them before the layout is done requires rewriting them.

### Research Flags

Phases with standard, well-documented patterns (no additional research needed):
- **Phase 1 (Foundation):** BottomTabBar is a standard React component; safe-area insets and Tailwind breakpoints are fully documented; active tab `pathname.startsWith` logic is copied verbatim from the existing sidebar.
- **Phase 2 (Responsive Table + Simple Pages):** CSS show/hide responsive table is a standard Tailwind pattern; Card component is installed.
- **Phase 3 (Complex Pages):** Largely mechanical per-page application of Phase 2 pattern; one design micro-decision for Payments filter panel collapse.
- **Phase 5 (Cypress):** All patterns defined in FEATURES.md; `cy.viewport()` is standard Cypress 15 API.

Phases needing a quick verification task before committing an approach:
- **Phase 4 (DrawerDialog):** Confirm shadcn Drawer (backed by Vaul) is compatible with @base-ui/react. If incompatible, the fallback is `max-h-[calc(100dvh-...)]` on existing `<Sheet>` components. This is a 30-minute verification, not a full research phase.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Direct inspection of package.json; all required packages confirmed installed. No new dependencies needed — validated against every capability requirement. |
| Features | HIGH | Based on direct codebase reading of all 11 page components. Per-page complexity accurately characterized. Navigation tab selection grounded in Material Design and iOS HIG 5-tab maximum. |
| Architecture | HIGH | Based on direct reading of app-shell.tsx, sidebar.tsx, top-bar.tsx, globals.css, and all page components. All integration points verified against live code. Build order is dependency-driven with no ambiguity. |
| Pitfalls | HIGH | Cypress pitfalls verified against actual test files at specific line numbers (payments-list.cy.ts line 379, lines 59–60). iOS safe-area Next.js regression verified via GitHub discussion #81264. Tailwind mobile-first pitfall documented against Tailwind official docs. |

**Overall confidence: HIGH**

### Gaps to Address

- **DrawerDialog @base-ui/react compatibility:** Research concludes DrawerDialog is valuable but flags it as unverified. Confirm in Phase 4 whether shadcn's Drawer (Vaul-backed, Radix-independent) works alongside @base-ui/react primitives before committing the pattern across delete-confirm dialogs and edit sheets.
- **Payments filter panel collapse strategy:** The Payments page filter bar (date range, amount range, customer name, status — 4 filters) needs a collapse mechanism on mobile. Research recommends a "Filters" toggle button but does not specify the collapse implementation (Accordion / Sheet / CSS `max-h` toggle). Resolve this as a design micro-decision at Phase 3 planning before implementing the Payments page.
- **Tablet sidebar at exact 768px breakpoint:** Research confirms sidebar is preserved on tablet. Verify in Phase 5 Cypress tests at `cy.viewport(768, 1024)` that the sidebar renders correctly and the bottom tab bar is absent at exactly the breakpoint boundary on major browsers.

---

## Sources

### Primary (HIGH confidence)
- `src/components/layout/app-shell.tsx` — current AppShell structure; `mobileOpen` state, hamburger handler, main element padding confirmed
- `src/components/layout/sidebar.tsx` — navGroups config (9 destinations), `usePathname` active logic, `hidden md:flex` pattern
- `src/components/layout/top-bar.tsx` — hamburger `md:hidden` pattern
- `src/components/ui/table.tsx` — existing overflow-x-auto wrapper
- `src/app/(app)/customers/page.tsx`, `loans/page.tsx`, `payments/PaymentsClient.tsx`, `dashboard/page.tsx` — page structure and table column counts
- `src/app/globals.css` — Tailwind v4 via `@import "tailwindcss"`, OKLCH design tokens, sidebar CSS vars
- `package.json` — all installed package versions confirmed; absence of conflicting packages confirmed
- `cypress/e2e/payments-list.cy.ts` — unscoped `cy.get("nav")` at line 379, `cy.get("table tbody tr")` at lines 59–60, row action buttons at line 205
- `cypress.config.ts` — no explicit `viewportWidth` set; default 1000px confirmed
- [Cypress viewport docs](https://docs.cypress.io/api/commands/viewport) — `cy.viewport()` API
- [Tailwind responsive design docs](https://tailwindcss.com/docs/responsive-design) — mobile-first breakpoint system
- [MDN env() CSS function](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env) — safe-area-inset universal browser support

### Secondary (MEDIUM confidence)
- [shadcn/ui Tailwind v4 changelog](https://ui.shadcn.com/docs/changelog/2025-02-tailwind-v4) — Tailwind v4 component compatibility
- [GitHub issue #8847 — Bottom Navigation component request](https://github.com/shadcn-ui/ui/issues/8847) — confirms no official shadcn bottom nav; custom build required
- [GitHub discussion #5730 — Mobile bottom tab navigation](https://github.com/shadcn-ui/ui/discussions/5730) — community pattern validation
- [iOS safe area + Next.js routing regression](https://github.com/vercel/next.js/discussions/81264) — `env(safe-area-inset-bottom)` reset during route transitions
- [Nielsen Norman Group — Mobile Tables](https://www.nngroup.com/articles/mobile-tables/) — card layout recommended for 5+ column tables
- [WCAG 2.5.8 Target Size Minimum](https://www.allaccessible.org/blog/wcag-258-target-size-minimum-implementation-guide) — 44×44px minimum, Level AA effective June 2025
- [Bottom Tab Bar Best Practices — UX Planet](https://uxplanet.org/bottom-tab-bar-navigation-design-best-practices-48d46a3b0c36) — 5-tab maximum, primary destinations
- [Cypress Real World App — responsive testing](https://learn.cypress.io/real-world-examples/app-layout-and-responsiveness) — `cy.viewport()` pattern for multi-viewport specs
- [Bottom tab bar safe area coverage](https://github.com/lobehub/lobehub/issues/10454) — iOS home indicator overlap pattern

---

*Research completed: 2026-03-24*
*Ready for roadmap: yes*
