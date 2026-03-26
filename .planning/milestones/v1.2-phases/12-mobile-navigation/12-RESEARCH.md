# Phase 12: Mobile Navigation - Research

**Researched:** 2026-03-25
**Domain:** React / Next.js 16.2 mobile navigation — bottom tab bar, bottom sheet, safe-area insets, Tailwind CSS v4
**Confidence:** HIGH

---

## Summary

This phase replaces the current mobile navigation (hamburger menu + Sheet sidebar) with a standard mobile-app bottom tab bar pattern. The sidebar stays on `md+` viewports; on `< md` viewports the sidebar is removed from the DOM entirely and a fixed bottom tab bar takes its place. A "More" bottom sheet — built with the `@base-ui/react` Drawer already in the project — exposes the secondary nav items.

The entire implementation is CSS-class-driven (Tailwind responsive prefixes `hidden md:flex` / `flex md:hidden`). No JavaScript viewport detection is needed. The `AppShell` component is the single integration point: it already lives in a `"use client"` boundary with `useSession` and `usePathname`, making it the correct home for the `BottomTabBar` (as already recorded in STATE.md).

The iPhone safe-area inset is handled by adding `viewport-fit=cover` to the root layout's Next.js `viewport` export and applying `pb-[env(safe-area-inset-bottom)]` to the bottom bar wrapper — no new packages required.

**Primary recommendation:** Build `BottomTabBar` and `MoreSheet` as new components under `src/components/layout/`, wire them into `AppShell`, and drive visibility entirely with Tailwind responsive classes. Use `@base-ui/react` Drawer (`swipeDirection="down"`) for the "More" sheet.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NAV-01 | Mobile bottom tab bar with 5 primary tabs (Dashboard, Customers, Payments, Loans, More) | BottomTabBar component, fixed-bottom positioning, `flex md:hidden` CSS hide at tablet+ |
| NAV-02 | "More" sheet showing remaining nav items (Creditors, Expenses, Income, Reports, Watchlist) | @base-ui/react `Drawer` with `swipeDirection="down"`, `MoreSheet` component |
| NAV-03 | Sidebar hidden on mobile, visible on desktop (md+ breakpoint) | AppShell already uses `hidden md:flex` for sidebar — keep and extend; remove Sheet-based hamburger on mobile |
| NAV-04 | Active tab state indicator with smooth transitions | `usePathname()` + Tailwind transition classes on tab indicator; CSS `transition-colors` |
| NAV-05 | Safe-area inset padding for iPhone home indicator | Next.js `viewport` export with `viewportFit: 'cover'` in root layout + `pb-[env(safe-area-inset-bottom)]` utility on BottomTabBar |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Tailwind CSS | 4.2.2 (installed) | Responsive breakpoints, safe-area utility, transition classes | Already in project; `md:` prefix drives sidebar/tab-bar visibility split |
| @base-ui/react | 1.3.0 (installed) | `Drawer` component for "More" bottom sheet | Already in project; provides `swipeDirection`, snap-points, accessible focus trap |
| lucide-react | ^0.577.0 (installed) | Tab icons (LayoutDashboard, Users, CreditCard, Banknote, MoreHorizontal) | Already in project; matches sidebar icons |
| next | 16.2.0 (installed) | `viewport` export with `viewportFit: 'cover'` for safe-area support | First-party API; no extra package needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `usePathname` (next/navigation) | bundled | Active tab detection | Read current route to highlight matching tab |
| CSS `env(safe-area-inset-bottom)` | browser native | Bottom inset for iPhone home indicator | Applied as Tailwind arbitrary value on BottomTabBar container |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @base-ui/react Drawer | shadcn Drawer (Vaul) | Vaul is NOT installed; @base-ui/react is already present and its Drawer is confirmed available at 1.3.0 |
| CSS-only show/hide | JS useMediaQuery hook | STATE.md locks CSS-only to avoid hydration mismatch — do not use JS viewport detection |
| Tailwind `env()` arbitrary value | Custom CSS class | Arbitrary value keeps everything in-component, avoids separate CSS files |

**Installation:** No new packages required. All dependencies are already installed.

---

## Architecture Patterns

### Recommended Project Structure
```
src/components/layout/
├── app-shell.tsx          # MODIFY: add BottomTabBar, remove hamburger on mobile
├── bottom-tab-bar.tsx     # NEW: fixed bottom nav, 5 tabs
├── more-sheet.tsx         # NEW: @base-ui/react Drawer with secondary nav items
├── sidebar.tsx            # UNCHANGED: still used at md+ breakpoint
└── top-bar.tsx            # MODIFY: hide hamburger button on mobile (it will be unused)
```

### Pattern 1: AppShell Integration
**What:** BottomTabBar renders inside AppShell's flex column, below `<main>`. Visibility is purely CSS-driven with `flex md:hidden`.
**When to use:** This is the only correct pattern given the CSS-only constraint from STATE.md.

```tsx
// Source: AppShell analysis + STATE.md decision
export function AppShell({ children }: AppShellProps) {
  const [moreOpen, setMoreOpen] = useState(false)

  return (
    <div className="flex flex-col h-screen">
      <TopBar />                          {/* top bar: always visible */}

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar — hidden on mobile */}
        <div className="hidden md:flex">
          <Sidebar />
        </div>

        {/* Main content — add pb for bottom tab bar height on mobile */}
        <main className="flex-1 overflow-auto bg-background p-4 md:p-6 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-6">
          {children}
        </main>
      </div>

      {/* Bottom tab bar — visible only on mobile */}
      <BottomTabBar
        className="flex md:hidden"
        onMoreClick={() => setMoreOpen(true)}
      />

      {/* More sheet — controlled from AppShell */}
      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
    </div>
  )
}
```

### Pattern 2: BottomTabBar Active Indicator
**What:** `usePathname()` detects the current route. Active tab gets a distinct color and a small indicator element with a CSS transition.
**When to use:** Every tab render cycle.

```tsx
// Source: sidebar.tsx active detection pattern (same approach)
"use client"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { cn } from "@/lib/utils"

const PRIMARY_TABS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Customers", href: "/customers", icon: Users },
  { label: "Payments", href: "/payments", icon: CreditCard },
  { label: "Loans", href: "/loans", icon: Banknote },
  { label: "More", href: null, icon: MoreHorizontal },  // triggers sheet, not navigation
]

export function BottomTabBar({ onMoreClick, className }: BottomTabBarProps) {
  const pathname = usePathname()

  return (
    <nav
      data-testid="bottom-tab-bar"
      className={cn(
        "fixed bottom-0 inset-x-0 z-40 h-14",
        "bg-background border-t border-border",
        "pb-[env(safe-area-inset-bottom)]",
        className
      )}
    >
      <div className="flex h-14 items-stretch">
        {PRIMARY_TABS.map((tab) => {
          const isActive = tab.href
            ? pathname === tab.href || pathname.startsWith(tab.href + "/")
            : false
          const Icon = tab.icon

          if (tab.href === null) {
            return (
              <button
                key={tab.label}
                data-testid="bottom-tab-more"
                onClick={onMoreClick}
                className={cn(
                  "flex-1 flex flex-col items-center justify-center gap-0.5",
                  "text-muted-foreground transition-colors duration-200"
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{tab.label}</span>
              </button>
            )
          }

          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-testid={`bottom-tab-${tab.label.toLowerCase()}`}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-0.5",
                "transition-colors duration-200",
                isActive
                  ? "text-primary font-semibold"
                  : "text-muted-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{tab.label}</span>
              {/* Active indicator line */}
              <span
                className={cn(
                  "absolute bottom-0 h-0.5 w-8 rounded-full bg-primary",
                  "transition-opacity duration-200",
                  isActive ? "opacity-100" : "opacity-0"
                )}
              />
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
```

### Pattern 3: MoreSheet with @base-ui/react Drawer
**What:** Bottom sheet using `@base-ui/react` Drawer with `swipeDirection="down"`. Lists secondary nav items: Creditors, Expenses, Income, Reports, Watchlist.
**When to use:** When the "More" tab is tapped.

```tsx
// Source: @base-ui/react drawer/index.d.ts + drawer/root/DrawerRoot.d.ts (verified)
import { Drawer } from "@base-ui/react/drawer"
import Link from "next/link"
import { usePathname } from "next/navigation"

const MORE_ITEMS = [
  { label: "Creditors", href: "/creditors", icon: Landmark },
  { label: "Expenses", href: "/expenses", icon: Receipt },
  { label: "Income", href: "/income", icon: TrendingUp },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Watchlist", href: "/watchlist", icon: AlertTriangle },
]

export function MoreSheet({ open, onOpenChange }: MoreSheetProps) {
  const pathname = usePathname()

  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      swipeDirection="down"
    >
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-50 bg-black/20" />
        <Drawer.Popup
          data-testid="more-sheet"
          className="fixed bottom-0 inset-x-0 z-50 bg-background rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/30" />
          <nav className="p-4 space-y-1">
            {MORE_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-testid={`more-item-${item.label.toLowerCase()}`}
                  onClick={() => onOpenChange(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-3 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-foreground hover:bg-accent"
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </Drawer.Popup>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
```

### Pattern 4: safe-area-inset-bottom via Next.js viewport export
**What:** `viewportFit: 'cover'` in the root layout's viewport export enables `env(safe-area-inset-bottom)` to work correctly on iPhone.
**When to use:** Add once to `src/app/layout.tsx`.

```tsx
// Source: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md (verified)
// Source: node_modules/next/dist/lib/metadata/types/extra-types.d.ts (viewportFit type confirmed)
import type { Viewport } from "next"

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",   // enables env(safe-area-inset-bottom) on iPhone
}
```

### Pattern 5: TopBar hamburger removal
**What:** TopBar currently shows a hamburger button (`md:hidden`) that opens the Sheet sidebar on mobile. After this phase, the hamburger is unused on mobile (navigation is via bottom tab bar). The `onMenuClick` prop and the Sheet inside AppShell should be removed.
**When to use:** As part of AppShell refactor.

Current TopBar renders:
```tsx
{onMenuClick && (
  <Button className="md:hidden" onClick={onMenuClick}>
    <Menu />
  </Button>
)}
```
This becomes dead code once mobile sidebar-sheet is removed. Remove `onMenuClick` prop from TopBar and remove `<Sheet>` from AppShell.

### Anti-Patterns to Avoid
- **JS viewport detection:** Do not use `window.innerWidth`, `useMediaQuery`, or similar to show/hide the bottom tab bar. CSS-only (`flex md:hidden`) is mandated by STATE.md to avoid hydration mismatch.
- **Rendering BottomTabBar in layout.tsx:** Must live in AppShell (`"use client"`) because it requires `usePathname` and `useSession`. `layout.tsx` is a Server Component.
- **Vaul/shadcn Drawer:** Not installed. Use `@base-ui/react` Drawer which is already in the project at 1.3.0.
- **Bottom tab bar in the DOM on desktop:** Use `flex md:hidden` to remove it from layout flow on tablet+. Do not use `visibility:hidden` or `opacity:0` (element would still affect layout).
- **Forgetting main content bottom padding:** With a `h-14` fixed bottom bar, `<main>` needs `pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-6` to prevent content from being obscured by the bar on mobile.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bottom sheet with swipe-to-dismiss | Custom CSS + touch event handlers | @base-ui/react `Drawer` with `swipeDirection="down"` | Touch velocity, snap points, focus trap, accessibility — all handled |
| Active route detection | Custom pathname parsing | `usePathname()` (next/navigation) | Already used in Sidebar — exact same pattern |
| iPhone safe-area inset | Custom JS to measure notch height | `env(safe-area-inset-bottom)` CSS + `viewportFit: 'cover'` viewport | Standard W3C CSS env() variable; no JS needed |
| Transition animation on active indicator | JS animation library | Tailwind `transition-colors duration-200` | Sufficient for color/opacity transitions; no library overhead |

---

## Common Pitfalls

### Pitfall 1: Missing `pb-[env(safe-area-inset-bottom)]` on the tab bar container
**What goes wrong:** Bottom tabs render under the iPhone home indicator; taps on bottom tabs become unreliable.
**Why it happens:** `env(safe-area-inset-bottom)` is 0 on non-notched devices and ~34px on iPhone with Face ID. It must be applied as padding on the bar container itself.
**How to avoid:** Apply `pb-[env(safe-area-inset-bottom)]` on the `<nav>` element. Also add matching padding to `<main>` so content is not obscured.
**Warning signs:** Bottom tabs appear correct in Chrome DevTools iPhone simulator but cut off on real device.

### Pitfall 2: `viewportFit: 'cover'` not set before testing safe-area
**What goes wrong:** `env(safe-area-inset-bottom)` always returns `0` — the safe-area CSS variable is only populated by the browser when `viewport-fit=cover` is set in the viewport meta tag.
**Why it happens:** Browser only exposes safe-area dimensions when the page explicitly opts into full-bleed layout.
**How to avoid:** Export `viewport` from `src/app/layout.tsx` with `viewportFit: 'cover'` — this is the Next.js 14+ API (confirmed in Next.js 16.2 docs).
**Warning signs:** `env(safe-area-inset-bottom)` padding has no visual effect on real iPhone.

### Pitfall 3: Sidebar Sheet conflict — two `<nav>` elements on mobile
**What goes wrong:** If the old hamburger-Sheet-Sidebar remains active alongside the new bottom tab bar, tests using `data-testid="sidebar-nav"` selectors could match multiple elements, and mobile users see both the hamburger and the tab bar.
**Why it happens:** AppShell currently renders a `<Sheet>` with `<Sidebar>` inside it. This must be removed when the bottom tab bar lands.
**How to avoid:** In the same plan wave that adds `BottomTabBar`, also remove the `<Sheet>` wrapper and the `onMenuClick`/`mobileOpen` state from AppShell.
**Warning signs:** Cypress tests selecting `[data-testid="sidebar-nav"]` fail or match unexpectedly.

### Pitfall 4: Main content obscured by fixed bottom bar
**What goes wrong:** Page content is inaccessible at the bottom of scroll — the last ~56px is hidden under the fixed tab bar.
**Why it happens:** `position: fixed` removes the bar from normal flow; `<main>` doesn't know the bar exists.
**How to avoid:** Add `pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-6` to `<main>` inside AppShell. The `md:pb-6` restores normal desktop padding when bar is absent.
**Warning signs:** "Submit" buttons at the bottom of forms appear clipped on mobile.

### Pitfall 5: `viewport` export conflicts with `metadata` export
**What goes wrong:** TypeScript compile error or Next.js warning about viewport in metadata.
**Why it happens:** In Next.js 14+, `viewport` was split from `metadata` into its own export. They cannot coexist in the same file.
**How to avoid:** Export `viewport` as a separate named export from `layout.tsx`. Do NOT put `viewport` inside the `metadata` object.
**Warning signs:** Build warning: "viewport was moved from metadata to generateViewport in Next.js 14."

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `viewport-fit` in `<meta>` tag in `_document.tsx` | `export const viewport: Viewport = { viewportFit: 'cover' }` in `layout.tsx` | Next.js 14.0 | No manual `<meta>` tag needed; type-safe |
| Hamburger + Sheet sidebar on mobile | Fixed bottom tab bar | This phase (Phase 12) | Standard mobile app UX pattern |
| Vaul (shadcn Drawer) for bottom sheets | @base-ui/react Drawer | This project | @base-ui/react is the project's component library; Vaul is not installed |

---

## Code Examples

### Active Tab Detection (verified pattern from sidebar.tsx)
```tsx
// Source: src/components/layout/sidebar.tsx (existing pattern, same logic)
const isActive =
  pathname === item.href || pathname.startsWith(item.href + "/")
```

### Tailwind CSS-only show/hide (confirmed by STATE.md)
```tsx
// Bottom tab bar — only on mobile
<BottomTabBar className="flex md:hidden" ... />

// Sidebar — only on tablet+
<div className="hidden md:flex">
  <Sidebar />
</div>
```

### @base-ui/react Drawer import (confirmed from installed package)
```tsx
// Source: node_modules/@base-ui/react/drawer/index.parts.d.ts (verified)
import { Drawer } from "@base-ui/react/drawer"
// Available parts: Drawer.Root, Drawer.Popup, Drawer.Portal,
//                  Drawer.Backdrop, Drawer.Close, Drawer.Trigger,
//                  Drawer.SwipeArea, Drawer.Title, Drawer.Description
```

### Next.js viewport export for safe-area (confirmed from Next.js 16.2 docs)
```tsx
// Source: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md
// Source: node_modules/next/dist/lib/metadata/types/extra-types.d.ts (viewportFit type confirmed)
import type { Viewport } from "next"

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}
```

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Cypress 15.12.0 (E2E) + Vitest 4.1.0 (unit) |
| Config file | `cypress.config.ts` |
| Quick run command | `npx cypress run --spec cypress/e2e/mobile-navigation.cy.ts` |
| Full suite command | `npx cypress run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NAV-01 | Bottom tab bar visible at 390px with 5 tabs | E2E (mobile viewport) | `npx cypress run --spec cypress/e2e/mobile-navigation.cy.ts` | Wave 0 |
| NAV-02 | "More" tap opens sheet with 5 secondary items | E2E (mobile viewport) | `npx cypress run --spec cypress/e2e/mobile-navigation.cy.ts` | Wave 0 |
| NAV-03 | Sidebar absent from DOM at 390px; present at 768px | E2E (both viewports) | `npx cypress run --spec cypress/e2e/mobile-navigation.cy.ts` | Wave 0 |
| NAV-04 | Active tab highlighted for current route | E2E (mobile viewport) | `npx cypress run --spec cypress/e2e/mobile-navigation.cy.ts` | Wave 0 |
| NAV-05 | Bottom bar has pb-[env(safe-area-inset-bottom)] class present | E2E (DOM assertion) | `npx cypress run --spec cypress/e2e/mobile-navigation.cy.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx cypress run --spec cypress/e2e/mobile-navigation.cy.ts`
- **Per wave merge:** `npx cypress run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `cypress/e2e/mobile-navigation.cy.ts` — covers NAV-01, NAV-02, NAV-03, NAV-04, NAV-05

**Test structure for `mobile-navigation.cy.ts`:**
```typescript
// Covers all 5 requirements — both mobile (390px) and desktop (1280px) viewports
describe("Mobile Navigation", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin()
  })

  context("at mobile viewport (390px)", () => {
    beforeEach(() => cy.viewport(390, 844))  // NAV-01

    it("shows bottom tab bar with 5 tabs")             // NAV-01
    it("does NOT show sidebar")                         // NAV-03
    it("highlights active tab for current route")       // NAV-04
    it("tapping More opens bottom sheet")               // NAV-02
    it("More sheet shows all 5 secondary items")       // NAV-02
    it("tab bar has safe-area-inset padding class")    // NAV-05
    it("navigating tab closes More sheet")             // NAV-02
  })

  context("at tablet/desktop viewport (1280px)", () => {
    beforeEach(() => cy.viewport(1280, 800))

    it("shows sidebar")                                 // NAV-03
    it("does NOT show bottom tab bar in DOM")          // NAV-03
  })
})
```

Note: Global Cypress viewport must NOT be changed (STATE.md decision). Use scoped `cy.viewport()` in `beforeEach` within each `context` block.

---

## Open Questions

1. **TopBar hamburger button removal**
   - What we know: TopBar renders a `md:hidden` hamburger that currently opens the Sheet sidebar. With the bottom tab bar in place, the hamburger is unused on mobile.
   - What's unclear: Should the TopBar still show a hamburger for collapsed-sidebar toggle on desktop, or is that handled solely by the sidebar's own collapse button?
   - Recommendation: Remove `onMenuClick` from TopBar and delete the `<Sheet>` from AppShell. The sidebar's internal collapse button already handles desktop toggle.

2. **"Income" route**
   - What we know: `navGroups` in sidebar.tsx shows "Expenses & Income" as a single item linking to `/expenses`. But REQUIREMENTS.md NAV-02 lists "Income" as a separate More sheet item.
   - What's unclear: Is there a separate `/income` route, or does it share `/expenses`?
   - Recommendation: Check existing route structure (`src/app/(app)/income/`). If `/income` exists as a separate route, use it; otherwise map "Income" to `/income` and keep "Expenses" to `/expenses` in the More sheet.

---

## Sources

### Primary (HIGH confidence)
- `src/components/layout/app-shell.tsx` — existing AppShell structure, current mobile pattern
- `src/components/layout/sidebar.tsx` — active route detection pattern, nav item definitions
- `node_modules/@base-ui/react/drawer/index.d.ts` — Drawer component API confirmed present
- `node_modules/@base-ui/react/drawer/root/DrawerRoot.d.ts` — `swipeDirection`, `snapPoints` props confirmed
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md` — `viewport` export API
- `node_modules/next/dist/lib/metadata/types/extra-types.d.ts` — `viewportFit: 'cover' | 'contain' | 'auto'` type confirmed
- `.planning/STATE.md` — CSS-only show/hide mandate, AppShell as BottomTabBar home, Cypress viewport scoping rules
- `src/app/globals.css` — Tailwind v4 config, no custom breakpoints (uses defaults: `md = 768px`)

### Secondary (MEDIUM confidence)
- `package.json` — confirmed versions: tailwindcss 4.2.2, @base-ui/react 1.3.0, cypress 15.12.0, next 16.2.0
- `cypress.config.ts` — no global viewport set (default 1000x660); mobile tests must use `cy.viewport()` in beforeEach

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed installed at known versions
- Architecture: HIGH — patterns derived from existing codebase code (sidebar.tsx, app-shell.tsx) and Next.js docs in node_modules
- Pitfalls: HIGH — derived from codebase analysis (existing patterns, STATE.md constraints)
- @base-ui/react Drawer API: HIGH — type definitions read directly from installed package

**Research date:** 2026-03-25
**Valid until:** 2026-04-25 (stable dependencies; @base-ui/react and Tailwind v4 are actively developed but API is stable at these versions)
