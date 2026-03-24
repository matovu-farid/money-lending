# Architecture Research

**Domain:** Responsive mobile + desktop layout — v1.2 milestone
**Researched:** 2026-03-24
**Confidence:** HIGH — based on direct reading of v1.1 codebase (67k LOC, 414 files)

---

## Context: What Already Exists

All architecture decisions for v1.2 are constrained by and must integrate with the existing system.

| Existing Piece | Location | Relevance to v1.2 |
|----------------|----------|-------------------|
| Root layout | `src/app/layout.tsx` | Sets `<html>`, `<body>`, font variables, `<Toaster>` — no nav here |
| App group layout | `src/app/(app)/layout.tsx` | Wraps all app pages in `<Providers><AppShell>` |
| `AppShell` | `src/components/layout/app-shell.tsx` | `"use client"` — owns `mobileOpen` state, renders `<TopBar>` + `<Sidebar>` + `<main>` |
| `Sidebar` | `src/components/layout/sidebar.tsx` | Desktop collapsible (60px / 240px), mobile via Sheet, contains all nav groups |
| `TopBar` | `src/components/layout/top-bar.tsx` | Full-width header, hamburger (`md:hidden`), notification bell |
| Nav items | `sidebar.tsx` lines 42-76 | 9 destinations: Dashboard, Customers, Loans, Payments, Watchlist, Creditors, Expenses, Reports, Admin |
| Tailwind breakpoints | `globals.css` → `@import "tailwindcss"` | Standard Tailwind v4: `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px |
| Design system | `globals.css` OKLCH tokens | Sovereign Ledger — `--sidebar`, `--sidebar-accent`, `--sidebar-foreground` tokens already defined |
| Data tables | All page components | Use `src/components/ui/table.tsx` — `<Table>` wraps in `overflow-x-auto` div |
| Page pattern | `customers/page.tsx`, `loans/page.tsx` | `p-6 space-y-4` outer wrapper, `<h1>` + subtitle, `<Table>` |

The current mobile behavior: hamburger in TopBar opens a `<Sheet side="left">` containing the Sidebar. The bottom of the screen has no navigation element. Pages have no responsive breakpoints beyond the KPI grid in dashboard (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`).

---

## Standard Architecture

### System Overview

```
Browser Viewport
┌──────────────────────────────────────────────────────────────────┐
│                         Root Layout                               │
│  (html + body, fonts, Toaster — never changes for v1.2)          │
├──────────────────────────────────────────────────────────────────┤
│                      App Group Layout                             │
│  src/app/(app)/layout.tsx → <Providers><AppShell>                │
├──────────────────────────────────────────────────────────────────┤
│                          AppShell                                 │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                       TopBar (h-14)                        │   │
│  │  hamburger[mobile] | "Lending Manager" | NotificationBell  │   │
│  └───────────────────────────────────────────────────────────┘   │
│  ┌─────────────┐  ┌─────────────────────────────────────────┐   │
│  │   Sidebar   │  │              <main>                      │   │
│  │ (md: flex)  │  │   flex-1 overflow-auto bg-background     │   │
│  │ (sm: hidden)│  │   p-4 md:p-6                             │   │
│  │             │  │   {children} — page content              │   │
│  │  collapsed: │  │                                          │   │
│  │  60px/240px │  │                                          │   │
│  └─────────────┘  └─────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │           BottomTabBar (NEW — mobile only)                 │   │
│  │  [hidden md:hidden] — 5 primary tabs with icons           │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### Breakpoint Strategy

The project uses Tailwind's standard breakpoints, already active via `@import "tailwindcss"` in globals.css:

| Viewport | Width | Navigation | Tables | Layout |
|----------|-------|-----------|--------|--------|
| Mobile | < 768px (`< md`) | Bottom tab bar | Stacked cards | single column, `p-4` |
| Tablet | 768–1023px | Sidebar (collapsed 60px) | Horizontal scroll | sidebar + main |
| Desktop | ≥ 1024px (`lg`) | Sidebar (expanded 240px) | Full table | sidebar + main |

The `md` breakpoint (768px) is the primary mobile/non-mobile boundary — it already drives `hidden md:flex` on the Sidebar and `md:hidden` on the hamburger button.

---

## Component Boundaries

### Modified Components

| Component | Current Behavior | Change for v1.2 |
|-----------|-----------------|-----------------|
| `AppShell` | Manages `mobileOpen` Sheet state | Add `pb-16 md:pb-0` to `<main>` to reserve space above bottom tab bar; remove hamburger trigger (menu button becomes redundant with bottom tabs) OR keep for edge cases |
| `Sidebar` | Mobile: Sheet overlay. Desktop: always visible | No structural change — Sheet behavior stays as fallback, but primary mobile nav shifts to BottomTabBar |
| `TopBar` | Shows hamburger `md:hidden` | Hamburger can be hidden entirely on mobile once BottomTabBar exists — or kept as "more" overflow trigger |

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `BottomTabBar` | `src/components/layout/bottom-tab-bar.tsx` | Fixed bottom nav, `md:hidden`, 5 primary destinations |
| `ResponsiveTable` | `src/components/ui/responsive-table.tsx` | Wrapper: renders `<Table>` on `md+`, renders stacked `<Card>` per row on mobile |
| `MobileCard` | `src/components/ui/mobile-card.tsx` | Optional: single row rendered as labeled key-value card on mobile |

### Unchanged Components

All page components (`customers/page.tsx`, `loans/page.tsx`, `payments/PaymentsClient.tsx`, etc.) receive responsive treatment by swapping `<Table>` usage for `<ResponsiveTable>` — the page shell structure (`p-4 space-y-4`, heading, filters) needs only minor padding/typography tweaks.

---

## Recommended Project Structure Changes

```
src/
├── components/
│   ├── layout/
│   │   ├── app-shell.tsx        # MODIFIED — add pb-16 md:pb-0, BottomTabBar
│   │   ├── bottom-tab-bar.tsx   # NEW — mobile-only fixed nav
│   │   ├── sidebar.tsx          # UNCHANGED (structural)
│   │   └── top-bar.tsx          # MINOR — optional hamburger visibility change
│   └── ui/
│       ├── table.tsx            # UNCHANGED — still used on md+ breakpoint
│       ├── responsive-table.tsx # NEW — viewport-aware table/card switcher
│       └── mobile-card.tsx      # NEW — row-as-card component
```

No new route groups, no new layouts, no new page routes required for v1.2. All changes are layout components and UI primitives.

---

## Architectural Patterns

### Pattern 1: BottomTabBar — Fixed Positioned, Mobile Only

**What:** A `"use client"` component fixed to the bottom of the viewport on mobile. Mirrors the 5 primary nav destinations from the Sidebar's first two nav groups. Hidden at `md` breakpoint.

**When to use:** Mobile-only navigation overlay. Does not appear on tablet or desktop.

**Trade-offs:** Reserves 64px at the bottom of the viewport — `<main>` needs `pb-16 md:pb-0` to prevent content hidden behind it. The tab bar uses the same `navGroups` config or a slimmed-down subset (5 items max for comfortable thumb reach).

**Example:**
```typescript
// src/components/layout/bottom-tab-bar.tsx
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Users, Banknote, CreditCard, BarChart3 } from "lucide-react"
import { cn } from "@/lib/utils"

const TAB_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Customers", href: "/customers", icon: Users },
  { label: "Loans", href: "/loans", icon: Banknote },
  { label: "Payments", href: "/payments", icon: CreditCard },
  { label: "Reports", href: "/reports", icon: BarChart3 },
]

export function BottomTabBar() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 h-16 bg-background border-t border-border md:hidden">
      <ul className="flex h-full items-center justify-around px-2">
        {TAB_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
          const Icon = item.icon
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-1 px-3 py-2 text-xs transition-colors",
                  isActive
                    ? "text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
```

### Pattern 2: ResponsiveTable — Viewport-Aware Data Display

**What:** A wrapper component that renders a `<Table>` on `md+` screens and a list of `<Card>` elements on mobile. Uses CSS to hide/show rather than JavaScript viewport detection — avoids hydration mismatches and flash of wrong layout.

**When to use:** Every page that currently renders a `<Table>`. Replace `<Table>...</Table>` with `<ResponsiveTable columns={...} rows={...} renderMobileCard={...} />`.

**Trade-offs:** Requires a "render prop" or `columns` / `renderMobileCard` API that callers must implement. The table definition lives in one place (the columns config), and the mobile card template is a simple slot. This is more verbose than class-only approaches but gives clean control per page.

**Approach — CSS show/hide (preferred):**

```typescript
// src/components/ui/responsive-table.tsx
// Renders BOTH layouts; CSS hides the non-active one.
// Avoids useEffect / window.innerWidth / hydration issues.

interface Column<T> {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  mobileLabel?: string   // label shown in card; defaults to header
  hideOnMobile?: boolean // omit this column from the mobile card
}

interface ResponsiveTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  getRowKey: (row: T) => string
  onRowClick?: (row: T) => void
  emptyState?: React.ReactNode
}
```

Mobile card renders each column (unless `hideOnMobile: true`) as a label + value pair. The "primary" column (first non-hidden column) gets larger typography to act as the card title.

**Alternative approach — Tailwind responsive classes only:**

Per-column `hidden md:table-cell` on less important columns. The table remains a `<table>` at all sizes but secondary columns collapse. Simpler to implement but less readable on narrow screens. Good for tables with 3-4 columns; not suitable for 6+ column tables like the Payments list.

**Recommendation:** Use CSS show/hide `ResponsiveTable` for pages with 5+ columns (Payments, Loans). Use column-hiding approach for simpler tables (Customers — 3 columns, Creditors — 4 columns).

### Pattern 3: AppShell Integration — Bottom Bar in Layout

**What:** `BottomTabBar` is rendered inside `AppShell` (the `"use client"` layout component), not in `layout.tsx`. This keeps it co-located with the other navigation components and inside the `<Providers>` context (needed for `useSession`).

**When to use:** Always — don't add `BottomTabBar` to individual pages or to `layout.tsx`.

**Example change to AppShell:**
```typescript
// src/components/layout/app-shell.tsx
export function AppShell({ children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex flex-col h-screen">
      <TopBar onMenuClick={() => setMobileOpen(true)} />
      <div className="flex flex-1 overflow-hidden">
        <div className="hidden md:flex">
          <Sidebar />
        </div>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="p-0 w-[240px]">
            <Sidebar onClose={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
        {/* pb-16 md:pb-0: reserve 64px for bottom tab bar on mobile */}
        <main className="flex-1 overflow-auto bg-background p-4 md:p-6 pb-16 md:pb-0">
          {children}
        </main>
      </div>
      {/* Bottom tab bar: renders itself as md:hidden */}
      <BottomTabBar />
    </div>
  )
}
```

### Pattern 4: Touch-Friendly Form Controls

**What:** Minimum 44px tap targets on interactive elements (WCAG 2.5.5 AA). Sheets and Dialogs open full-screen on mobile. Select dropdowns use the native mobile picker behavior.

**When to use:** All form inputs, action buttons, and row action triggers on mobile viewports.

**Concrete changes:**
- Buttons in page headers: `h-9 md:h-8` (slightly taller on mobile)
- `<Input>` components: already `h-9` — acceptable; verify touch target in Cypress
- Row action menus (`DropdownMenu`): trigger button `h-10 w-10` on mobile
- `<Sheet>` for edit forms: already slides from edge — appropriate for mobile
- `<Dialog>` modals: add `sm:max-w-[100vw] sm:rounded-none` override for full-screen on mobile

---

## Data Flow

### Responsive Table Data Flow

No changes to data fetching. The data layer (Server Actions → TanStack Query → page state) is viewport-agnostic. Only the presentation layer changes.

```
[Existing data flow — unchanged]
TanStack Query hook
  → Server Action
    → Effect service
      → Drizzle query
        → PostgreSQL

[New presentation fork at component level]
ResponsiveTable receives rows[] + columns[]
  → md+ viewport: renders <table> (existing Table component)
  → < md viewport: renders rows as <Card> elements
      each card: primary field as title, secondary fields as dl key-value pairs
```

### Navigation State Flow

```
User taps tab in BottomTabBar
  → Link component
    → Next.js App Router navigation
      → new page renders in <main>
        → BottomTabBar re-renders with new active state
          (usePathname() reactive to route change)
```

No additional state management needed. `usePathname()` from `next/navigation` is the source of truth for active tab highlight — same pattern the Sidebar already uses.

### Mobile Sheet Navigation (retained as overflow)

The existing hamburger + Sheet for mobile sidebar navigation is retained, not removed. On mobile, the Sheet provides access to the full nav (including Admin, Watchlist, Expenses/Income that don't fit in 5 bottom tabs). The hamburger button in TopBar (`md:hidden`) stays. Bottom tabs handle primary destinations; hamburger handles overflow.

---

## Integration Points: New vs Modified

### New Files

| File | Type | Purpose |
|------|------|---------|
| `src/components/layout/bottom-tab-bar.tsx` | Client Component | Fixed mobile nav, 5 primary tabs, `md:hidden` |
| `src/components/ui/responsive-table.tsx` | Shared Component | Viewport-aware table/card switcher |
| `src/components/ui/mobile-card.tsx` | Shared Component | Single data row rendered as labeled card (optional, may inline) |

### Modified Files

| File | Change | Risk |
|------|--------|------|
| `src/components/layout/app-shell.tsx` | Add `<BottomTabBar />`, add `pb-16 md:pb-0` to `<main>` | Low — 3-line change |
| `src/app/(app)/*/page.tsx` (all 11 pages) | Replace `<Table>` with `<ResponsiveTable>` or column-hiding approach; adjust header layout for small screens | Medium — repetitive but mechanical across pages |
| `src/app/(app)/customers/page.tsx` | Add responsive table (3 columns — low complexity) | Low |
| `src/app/(app)/loans/page.tsx` | Add responsive table (5 columns — medium complexity); touch-friendly row actions | Medium |
| `src/app/(app)/payments/PaymentsClient.tsx` | Add responsive table (7 columns — highest complexity); full-screen Sheet on mobile for filters | High |
| `src/app/(app)/dashboard/page.tsx` | Already has `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` for KPIs — activity feed needs `px-4 md:px-6` adjustment | Low |
| `cypress/e2e/*.cy.ts` | All tests need viewport annotations; add `cy.viewport('iphone-x')` variants | Medium |

### No Changes Needed

- `src/components/layout/sidebar.tsx` — structural behavior unchanged; CSS already hides it on mobile
- `src/components/layout/top-bar.tsx` — works as-is; hamburger button already `md:hidden`
- All Server Actions, services, hooks, and database schema — data layer is viewport-agnostic
- `src/components/providers.tsx` — no change
- `src/app/layout.tsx` — no change

---

## Recommended Build Order

Dependencies dictate this order. Items at the same level can be built in parallel.

```
Level 1 — Foundation (sequential; everything depends on these)
  1a. BottomTabBar component
      (src/components/layout/bottom-tab-bar.tsx)
      No dependencies. Standalone component.

  1b. AppShell integration
      (src/components/layout/app-shell.tsx — add BottomTabBar + pb-16 md:pb-0)
      Depends on 1a. All pages automatically get bottom tab bar.

Level 2 — Responsive Table Primitives (after Level 1, parallel)
  2a. ResponsiveTable component
      (src/components/ui/responsive-table.tsx)
      Pure UI primitive. No page dependencies.

Level 3 — Page Responsive Layouts (parallel; all depend on 2a)
  Order by complexity: simpler pages first to validate pattern, complex later.

  3a. Dashboard — already mostly responsive; adjust KPI grid + activity feed padding
  3b. Customers — 3-column table, simple card layout
  3c. Watchlist — similar structure to customers
  3d. Creditors — 4-column table
  3e. Loans — 5-column table + row actions
  3f. Expenses / Income — similar structure
  3g. Payments — 7-column table, filter panel, tabs (most complex)
  3h. Reports — no table; mostly cards and charts; layout adjustments only

Level 4 — Touch Optimization (parallel with Level 3 or after)
  4a. Form input tap target audit across all forms
  4b. Dialog full-screen on mobile (payment dialogs, loan wizard steps)
  4c. Action menus (DropdownMenu trigger size on mobile)

Level 5 — Cypress Tests (after each page is complete)
  5a. Add iphone-x viewport tests alongside each page's existing desktop tests
  5b. Verify bottom tab bar navigation in mobile viewport
  5c. Verify table → card layout switch in mobile viewport
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: JavaScript Viewport Detection for Table Switching

**What:** Using `useState` + `useEffect` + `window.innerWidth` to decide table vs card layout.

**Why bad:** Causes hydration mismatch (server renders without `window`), flash of wrong layout on load, and unnecessary re-renders on resize. Also breaks SSR for page content.

**Do this instead:** CSS-only show/hide. Render both layouts in the DOM; use `hidden md:block` and `md:hidden` to show the correct one. No JavaScript needed. Tailwind's responsive classes use CSS media queries evaluated by the browser — no hydration issue.

### Anti-Pattern 2: BottomTabBar in Root Layout or Individual Pages

**What:** Placing `<BottomTabBar />` in `src/app/layout.tsx` or in each page component.

**Why bad:** Root layout is outside `<Providers>`, so `useSession` (needed for user avatar / conditional admin tab) won't work. Individual pages duplicate the component and require coordination.

**Do this instead:** Place `<BottomTabBar />` inside `AppShell` (already a `"use client"` component inside `<Providers>`). One location, automatically present on all app pages.

### Anti-Pattern 3: Replacing the Sheet/Hamburger with Only Bottom Tabs

**What:** Removing the hamburger + mobile Sheet overlay entirely.

**Why bad:** The bottom tab bar holds 5 primary destinations. The app has 9+ nav destinations (Watchlist, Creditors, Expenses, Income, Admin, Transactions). Users lose access to those secondary destinations on mobile.

**Do this instead:** Keep the hamburger + Sheet as overflow navigation. Bottom tabs handle the primary 5; hamburger provides access to the rest. This is the standard pattern used by mobile apps with deep nav hierarchies (Gmail, Notion, etc.).

### Anti-Pattern 4: New Mobile-Only Pages or Routes

**What:** Creating `/m/customers`, `/mobile/dashboard`, or similar mobile-specific routes.

**Why bad:** Doubles the maintenance surface. Authentication, Server Actions, and data access all need to work for both routes. Impossible to keep in sync.

**Do this instead:** Single route, responsive CSS. The same `/customers` page renders differently based on viewport via Tailwind breakpoint classes. This is the established web approach.

### Anti-Pattern 5: Hardcoded px Values for Touch Targets

**What:** Adding `style={{ minHeight: '44px' }}` inline on interactive elements.

**Why bad:** Breaks out of the design token system. Inconsistent with the Sovereign Ledger design system's use of Tailwind utilities.

**Do this instead:** Use Tailwind size utilities: `h-11` (44px), `min-h-11`, or shadcn button `size="lg"`. These are already part of the design system and tracked by the CSS.

---

## Scalability Considerations

| Concern | Current (mobile-first) | If nav grows beyond 9 items |
|---------|------------------------|------------------------------|
| Bottom tab overflow | 5 tabs fit comfortably in `justify-around` | Add "More" tab → Sheet with remaining items (standard pattern) |
| Table column count | Up to 7 columns (Payments) | Cards scale linearly; no table overflow issues on mobile |
| Touch target density | KPI cards and table rows have adequate spacing | If density increases, increase `py` on row items |

---

## Sources

- Direct reading: `src/components/layout/app-shell.tsx` (current AppShell structure)
- Direct reading: `src/components/layout/sidebar.tsx` (nav groups, 9 destinations, breakpoint usage)
- Direct reading: `src/components/layout/top-bar.tsx` (hamburger md:hidden pattern)
- Direct reading: `src/components/ui/table.tsx` (overflow-x-auto wrapper, existing structure)
- Direct reading: `src/app/(app)/customers/page.tsx` (3-column table pattern)
- Direct reading: `src/app/(app)/payments/PaymentsClient.tsx` (7-column table, most complex page)
- Direct reading: `src/app/(app)/dashboard/page.tsx` (existing grid-cols responsive KPIs)
- Direct reading: `src/app/globals.css` (Tailwind v4 via @import, OKLCH tokens, sidebar CSS vars)
- Direct reading: `.planning/PROJECT.md` (v1.2 requirements)
- Confidence: HIGH — all integration points verified against live codebase

---

*Architecture research for: v1.2 Responsive — mobile + desktop layout*
*Researched: 2026-03-24*
