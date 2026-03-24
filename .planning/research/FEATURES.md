# Feature Research

**Domain:** Responsive mobile + desktop layout for a financial/lending management web app (v1.2)
**Researched:** 2026-03-24
**Confidence:** HIGH (existing codebase read directly; patterns verified against current UX/accessibility research)

---

## Context: What Already Exists

This is a subsequent milestone. The full feature set (Customers, Loans, Payments, Collections, Creditors, Expenses, Income, Reports, Watchlist, Simulator, Notifications, Dashboard) is already built and working on desktop/tablet. The existing app shell:

- **Desktop:** Fixed left sidebar (240px, collapsible to 60px) with 9 nav items across 5 groups
- **Mobile:** Hamburger button in top bar opens a Sheet slide-in with the same Sidebar component
- **KPI grid on dashboard:** `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` — already responsive
- **Tables:** Plain `<Table>` rows on every list page — no mobile alternative, unusable at 360px
- **Forms/dialogs:** Dialog and Sheet components — not touch-optimised, tap targets often 32×32px
- **Page padding:** AppShell uses `p-4 md:p-6`, but page components override with hardcoded `p-6`
- **Cypress tests:** Written at default desktop viewport, no mobile viewport coverage

The scope of v1.2 is **not building new features** — it is adapting every existing UI surface to work well on phones (360–430px wide) while keeping the desktop experience unchanged.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features mobile users assume exist. Missing these makes the app feel broken on a phone.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Bottom tab bar navigation on mobile | Standard pattern for staff apps used on phones; the hamburger-in-sheet pattern is discoverable but slow — loan officers tap 4–5 sections daily | MEDIUM | Replace mobile Sheet-nav with a fixed bottom bar. Keep desktop sidebar unchanged. 3–5 tabs max. Existing sidebar has 9 items — need a "More" overflow sheet for secondary items. |
| Responsive data tables → card layout on mobile | Tables with 5–7 columns are unusable below 480px; horizontal scroll causes accidental browser-back gestures on iOS Safari | HIGH | Per-page card design required — each page has a different column schema. Card layout: primary label + key metric + status badge + action trigger. 8+ pages affected. |
| Touch-friendly tap targets (min 44×44px) | WCAG 2.5.8 Level AA (effective June 2025) and Apple/Google HIG both require ≥44px; current DropdownMenuTrigger buttons are `h-8 w-8` (32px) — non-compliant | LOW | Affects: DropdownMenuTrigger (MoreHorizontal) on every table row, pagination buttons (`size="sm"` → too small), filter clear chips, tab switches. Apply `min-h-[44px] min-w-[44px]` at `sm:` and below. |
| Single-column form layout on mobile | Multi-column grids in forms (loan wizard, customer registration, creditor form) collapse into cramped unreadable columns at 360px | MEDIUM | Audit all form grids. Use `grid-cols-1 sm:grid-cols-2` pattern. Full-width inputs on small screens. Labels stacked above inputs (not inline). |
| Scoped horizontal scroll on wide tables | Wide tables cause full-page horizontal scroll on iOS Safari, which conflicts with the swipe-back gesture | LOW | Wrap `<Table>` in `overflow-x-auto` scoped to the table container, not the page. Or replace with card layout. Card layout is preferred for list pages; scroll acceptable for financial statement tables (P&L, Balance Sheet) where column comparison is needed. |
| Content padding corrected for mobile | Page components hardcode `className="p-6"` inside their own `<div>`, bypassing the AppShell's `p-4 md:p-6`. On a 360px phone this leaves only 348px content width at best | LOW | Remove hardcoded `p-6` from: `customers/page.tsx`, `loans/page.tsx`, `payments/page.tsx`, `reports/page.tsx`, `creditors/page.tsx`, `expenses/page.tsx`, `income/page.tsx`, `watchlist/page.tsx`, `admin/page.tsx`. Let AppShell padding govern. |
| Cypress tests with mobile viewport coverage | Every existing spec runs at default desktop width (1280px); no test validates that bottom tab bar appears, tables become cards, dialogs behave correctly at 390px | MEDIUM | Add `cy.viewport(390, 844)` (iPhone 14 portrait) blocks to each spec file. Assert: bottom tab visible, sidebar hidden, card layout present, tap targets reachable. This is required per AGENTS.md — all verification must be automated. |

### Differentiators (Competitive Advantage)

Features beyond bare responsiveness that make the mobile experience genuinely good for loan officers working in the field.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Quick-record payment accessible from bottom tab | Recording a payment is the most common field action; surfacing it as a bottom tab item means one tap to start — faster than Dashboard → Payments → Quick Record | LOW | Add "Record" tab (CreditCard icon) pointing to `/payments?tab=quick`. Reuses existing QuickRecord UI component. No new backend work. |
| Sticky page header with title + primary CTA | On mobile, "Add Customer" and "New Loan" buttons scroll off screen almost immediately on list pages | LOW | `sticky top-0 z-10 bg-background/95 backdrop-blur` on the heading + CTA row. Prevents repeated scroll-to-top to access the primary action. |
| DrawerDialog: Drawer on mobile, Dialog on desktop | Small-screen centered dialogs clip content (delete confirm, edit sheets). A bottom-anchored drawer is more natural on phone — full-width buttons, no keyboard overlap | MEDIUM | `useMediaQuery` hook + conditional render: `<Drawer>` at mobile, `<Dialog>` at desktop. Requires verifying shadcn Drawer works with `@base-ui/react` primitives. Applies to: delete confirm dialogs, edit sheets, payment recording form. |
| Collapsible filter row on mobile | Filter bars (date range, amount range, customer name, status) occupy 3–4 rows on mobile and push the list content below the fold | MEDIUM | Filter bar collapsed behind a "Filters" button with a badge count showing active filters. Expands into an accordion or sheet. Desktop keeps inline filters. Applies to: Payments, Customers, Loans, Expenses, Income pages. |
| Card skeleton loading states matching card layout | Current loaders show text "Loading customers..." — on mobile this looks unfinished and does not reserve vertical space | LOW | Replace text loaders with animated card skeletons that match the card layout used on mobile. The dashboard activity feed already uses `animate-pulse` — extend this pattern to list pages. |

### Anti-Features (Commonly Requested, Often Problematic)

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| Swipe-to-delete on table/card rows | Feels intuitive on iOS | Conflicts with browser scroll gesture; requires custom touch event handling that breaks on Android and Safari; existing delete flow requires a reason field (audit log) — swipe bypasses this guard; creates an accidental deletion path | Keep MoreHorizontal dropdown; ensure its tap target is 44×44px. The reason-required dialog is non-negotiable for audit compliance. |
| Retain hamburger menu alongside bottom tabs on mobile | "Users might want the full nav list" | Creates two parallel navigation systems; users become confused about which is canonical; bottom tabs should be the sole mobile nav | Remove hamburger / Sheet nav on `< md` breakpoints. The "More" tab in the bottom bar covers secondary nav items. |
| Infinite scroll to replace pagination | "Mobile users dislike pagination buttons" | Virtual scroll breaks browser back/forward state; filter + pagination state is already synced to URL params — infinite scroll would break this architecture; loading indeterminate amounts of financial records creates performance risk | Use large tap-target (min 44px) pagination buttons with clear "X–Y of Z" indicator; this is the established pattern in financial management tools |
| Pinch-to-zoom on data tables | "See all columns at once" | iOS/Android treat pinch as page viewport zoom, not component zoom; this is not reliably interceptable without disabling user-scalable, which violates WCAG | Card layout on mobile (shows only the most relevant fields); horizontal scroll within `overflow-x-auto` container for true comparison tables (P&L, Balance Sheet) |
| Push notifications for mobile web | "Remind loan officers on their phone" | Out of scope per PROJECT.md; requires service worker + VAPID key setup + permission prompts; adds infrastructure complexity not planned for v1.2 | In-app notification bell (already built); email notifications on financial events (already built) |

---

## Feature Dependencies

```
Bottom Tab Bar Navigation
    └──requires──> Split navGroups into primary (5 tabs) vs secondary (More sheet)
    └──requires──> Hide mobile hamburger button when bottom tabs present
    └──requires──> AppShell layout: bottom-nav reserved space (56–60px) on mobile to avoid content clipping

Responsive Table → Card Layout (per page)
    └──requires──> Per-page card component (schema differs per page — cannot share one component)
    └──requires──> Each card has action trigger (DropdownMenu replaces the table-row MoreHorizontal)
    └──requires──> Empty states preserved in card view

Touch-Friendly Tap Targets
    └──enhances──> Card layout action menus (card action buttons can be larger than table row icons)
    └──requires──> Pagination button size audit

Single-Column Forms
    └──requires──> Audit of each form's grid layout
    └──requires──> Loan wizard multi-step form — verify each step stacks correctly

Cypress Mobile Viewport Tests
    └──requires──> All responsive features implemented first (tests verify the result)
    └──requires──> cy.viewport(390, 844) in each spec file
    └──enhances──> All existing specs (each gets a mobile block alongside desktop block)

DrawerDialog (P2 differentiator)
    └──requires──> Verify @base-ui/react Drawer exists / shadcn Drawer compatibility
    └──requires──> useMediaQuery hook (or CSS-only approach)
    └──conflicts──> Existing Dialog components (must replace, not add alongside)

Collapsible Filter Row (P2 differentiator)
    └──requires──> Responsive table/card layout exists (filters only matter once list is usable)
    └──requires──> Active filter count badge

Sticky Page Headers
    └──requires──> Content padding corrected (sticky header needs bg-background to not bleed)
```

### Dependency Notes

- **Bottom tab bar requires navGroups split:** The sidebar has 9 nav items. A bottom bar holds 3–5. The split decision (primary vs secondary) must be made before implementation starts. Recommended: Dashboard, Customers, Payments, Loans, More (opens sheet).
- **Card layout is per-page work:** This is the bulk of the implementation. Each of the 8+ list pages needs its own card design because column schemas differ (e.g. Loans has Principal + Rate + Status, Creditors has Capital + Balance). There is no generic responsive table component that fits all.
- **DrawerDialog requires verification:** The project uses `@base-ui/react` primitives (note: `asChild` prop is not available). Shadcn Drawer must be tested for compatibility before committing this pattern.
- **Cypress tests are last:** Mobile viewport tests can only be written after the responsive implementation exists. They are the verification layer, not a blocker.
- **Padding fix is first:** Page-level `p-6` overrides must be removed before any layout work, otherwise responsive padding will be inconsistent.

---

## MVP Definition

This is a responsive layer over an existing product. "Launch with" = required for v1.2 to ship.

### Launch With (v1.2)

- [ ] Bottom tab bar navigation on mobile (5 tabs including More) — core nav is broken without this
- [ ] Responsive tables → card layout for all 8+ list pages — tables are unusable on 360px screens
- [ ] Touch-friendly tap targets across all interactive elements (min 44×44px) — WCAG 2.5.8 compliance
- [ ] Single-column form layout on mobile across all forms — forms are the primary data entry path
- [ ] Content padding corrected (remove hardcoded `p-6` from page components) — layout correctness
- [ ] Horizontal scroll scoped to table containers — prevents iOS Safari gesture conflicts
- [ ] Cypress tests with mobile viewport (390px) coverage for all pages — required by AGENTS.md

### Add After Validation (v1.x)

- [ ] Quick-record in bottom tab bar — high value, low effort; add once tab bar is stable
- [ ] Sticky page headers with primary CTA — helpful for long lists; not a blocker
- [ ] Collapsible filter row — useful for pages with heavy filtering; add if feedback confirms friction
- [ ] DrawerDialog pattern — polish; current dialogs function at mobile, just less elegantly
- [ ] Card skeleton loading states — replaces text loaders; add after card layout is implemented

### Future Consideration (v2+)

- [ ] Swipe gesture navigation between tabs — requires Framer Motion or touch event API work
- [ ] Offline-capable service worker — explicitly out of scope per PROJECT.md
- [ ] Native iOS/Android app — out of scope per PROJECT.md

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Bottom tab bar navigation (mobile) | HIGH | MEDIUM | P1 |
| Responsive tables → cards (all pages) | HIGH | HIGH | P1 |
| Touch-friendly tap targets | HIGH | LOW | P1 |
| Single-column forms on mobile | HIGH | LOW | P1 |
| Fix hardcoded `p-6` padding | HIGH | LOW | P1 |
| Horizontal scroll scoping | HIGH | LOW | P1 |
| Cypress mobile viewport tests | HIGH | MEDIUM | P1 |
| Sticky page headers | MEDIUM | LOW | P2 |
| Quick-record in bottom tab | MEDIUM | LOW | P2 |
| Collapsible filter row | MEDIUM | MEDIUM | P2 |
| DrawerDialog pattern | MEDIUM | MEDIUM | P2 |
| Card skeleton loaders | LOW | LOW | P2 |

**Priority key:**
- P1: Required for v1.2 launch
- P2: Add when P1s are complete; do not block launch
- P3: Future consideration

---

## Per-Page Responsive Work Breakdown

| Page | Current Table Columns | Mobile Strategy | Estimated Complexity |
|------|-----------------------|-----------------|----------------------|
| Dashboard | No table (KPI grid + activity feed) | KPI grid already `grid-cols-1 sm:grid-cols-2`; activity feed rows need min 44px touch target; heading/CTA already responsive | LOW |
| Customers | Name, Contact, Status | Card: Name (primary, bold) + Contact + Status badge; row tap navigates to customer detail | LOW-MEDIUM |
| Loans | Slug, Customer, Principal, Rate, Status, Date, Actions | Card: Customer name + Principal (large mono) + Status badge + Start date + MoreHorizontal action (44px target) | HIGH — 7 columns to distill |
| Payments (list) | Customer, Amount, Date, Interest, Principal, Actions | Card: Customer + Amount (large mono) + Date + breakdown as secondary text + actions | HIGH |
| Collections (daily) | Summary + due-today list + breakdown table | Cards for due-today list; breakdown table stays scrollable-x (comparison data) | MEDIUM |
| Quick Record | Combobox + form | Single-column already; ensure all inputs `min-h-[44px]`; submit button full-width | LOW |
| Creditors | Name, Capital Invested, Interest Accrued, Balance, Actions | Card: Name + Balance (large) + Interest Accrued + actions | MEDIUM |
| Expenses | Date, Description, Amount, Category, Actions | Card: Description + Amount + Category badge + Date | MEDIUM |
| Income | Date, Description, Amount, Category, Actions | Same as Expenses | MEDIUM |
| Watchlist | Customer, Days Overdue, Outstanding, Actions | Card: Customer + Days Overdue badge (destructive colour) + Outstanding balance | MEDIUM |
| Reports index | Grid of report cards | Already `grid-cols-1 sm:grid-cols-2` — already responsive | LOW |
| Reports (P&L, Balance Sheet, Portfolio) | Financial statement tables | Horizontal scroll-x in container; too structured to card-ify meaningfully | MEDIUM |
| Admin | User table | Card: User name + email + Role badge + actions | MEDIUM |
| Repayment Simulator | Form + result table | Single-column form; result table stays scrollable-x or stacked KPIs | MEDIUM |
| Notifications | List of notifications | List items already stack; ensure touch targets ≥44px; bell badge visible on mobile | LOW |

---

## Navigation Architecture Decision

The existing sidebar has 9 nav items across 5 groups. A bottom tab bar supports 3–5 items (standard practice; 5 is the upper limit per Material Design and iOS HIG).

**Recommended bottom tab structure (5 items covering 90% of daily usage):**

| Tab | Icon | Route | Usage Frequency |
|-----|------|-------|-----------------|
| Dashboard | LayoutDashboard | /dashboard | Daily — KPI check |
| Customers | Users | /customers | Daily — lookup/register |
| Payments | CreditCard | /payments | Daily — record + list |
| Loans | Banknote | /loans | Daily — issue + view |
| More | MoreHorizontal | opens sheet | As needed |

**"More" sheet items (secondary nav):**
- Watchlist
- Creditors
- Expenses & Income
- Reports
- Admin (role-gated, only shown to admin+)

**Implementation notes:**
- Bottom tabs: `flex md:hidden` — invisible on desktop, desktop continues to use sidebar
- Hamburger button in TopBar: `hidden` when at mobile breakpoint (bottom tabs replace it)
- Bottom bar height: 56–60px fixed, with bottom safe-area inset for notched phones (`pb-safe`)
- Active tab indicator: highlighted icon + label, matches sidebar active style

---

## Cypress Responsive Test Strategy

Every existing spec file needs a mobile block. Pattern to follow:

```typescript
// At top of spec file, add alongside existing desktop tests:
context("Mobile viewport", () => {
  beforeEach(() => {
    cy.viewport(390, 844) // iPhone 14 portrait
    // existing beforeEach setup
  })

  it("shows bottom tab bar", () => {
    cy.get("[data-testid=bottom-tab-bar]").should("be.visible")
  })

  it("hides desktop sidebar", () => {
    cy.get("[data-testid=sidebar]").should("not.be.visible")
  })

  it("shows card layout instead of table", () => {
    cy.get("[data-testid=mobile-card-list]").should("exist")
    cy.get("table").should("not.exist") // or be hidden
  })
})
```

Viewports to cover:
- `390 x 844` — iPhone 14 portrait (primary test target)
- `768 x 1024` — iPad portrait (tablet — desktop sidebar should be visible)
- `1280 x 800` — desktop default (existing tests unchanged)

---

## Sources

- [Bottom Navigation Bar Best Practices — AppMySite 2025](https://blog.appmysite.com/bottom-navigation-bar-in-mobile-apps-heres-all-you-need-to-know/)
- [Bottom Tab Bar Navigation Design Best Practices — UX Planet](https://uxplanet.org/bottom-tab-bar-navigation-design-best-practices-48d46a3b0c36)
- [Mobile Tables: Comparisons and Other Data Tables — Nielsen Norman Group](https://www.nngroup.com/articles/mobile-tables/)
- [5 Practical Solutions to Make Responsive Data Tables — Appnroll/Medium](https://medium.com/appnroll-publication/5-practical-solutions-to-make-responsive-data-tables-ff031c48b122)
- [10 Best Fintech UX Practices for Mobile Apps — ProCreator 2025](https://procreator.design/blog/best-fintech-ux-practices-for-mobile-apps/)
- [WCAG 2.5.8 Target Size (Minimum) — AllAccessible](https://www.allaccessible.org/blog/wcag-258-target-size-minimum-implementation-guide)
- [Touch Targets on Touchscreens — Nielsen Norman Group](https://www.nngroup.com/articles/touch-target-size/)
- [Cypress Viewport API Documentation](https://docs.cypress.io/api/commands/viewport)
- [Mastering Cypress for Responsive Web Testing — DEV Community](https://dev.to/raju_dandigam/mastering-cypress-for-responsive-web-testing-the-ultimate-guide-1ife)
- [Shadcn Data Table patterns](https://ui.shadcn.com/docs/components/data-table)
- [Adapting KPI Dashboards for Mobile — Grow.com](https://medium.com/@grow.com/adapting-your-kpi-dashboard-for-mobile-a-brief-how-to-guide-1b8f7d9217dd)
- **Direct codebase reading (HIGH confidence):** `app-shell.tsx`, `sidebar.tsx`, `top-bar.tsx`, `dashboard/page.tsx`, `customers/page.tsx`, `loans/page.tsx`, `payments/page.tsx`, `reports/page.tsx` — all read 2026-03-24

---

*Feature research for: Responsive mobile + desktop layout — money-lending app v1.2*
*Researched: 2026-03-24*
