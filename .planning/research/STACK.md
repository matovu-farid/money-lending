# Stack Research

**Project:** Money Lending Management System — v1.2 Responsive Milestone
**Researched:** 2026-03-24
**Scope:** NEW capabilities only for responsive mobile + desktop layouts. Existing validated stack (Next.js 16, React 19, Better Auth, Drizzle ORM, PostgreSQL, Effect.js, BigNumber.js, TanStack Query, Tailwind CSS v4, shadcn/ui with @base-ui/react primitives, Server Actions, date-fns, sonner, lucide-react, react-day-picker, ExcelJS, jspdf) is NOT re-examined.
**Confidence:** HIGH

---

## Executive Decision

**No new npm dependencies are required for v1.2 Responsive.**

Everything needed to build bottom tab bar navigation, responsive layouts, and mobile-friendly data tables already exists in the installed stack. The work is purely UI restructuring using Tailwind responsive utilities, CSS environment variables, and custom React components built from existing shadcn/base-ui primitives.

---

## What "Responsive" Means for This Project

The app is used by lending staff (loan officers, admins) — not borrowers. The target is:

- **Desktop** (`lg:` and above, ≥1024px): Sidebar navigation, full data tables, dense information layout
- **Tablet** (`md:`, 768–1023px): Sidebar hidden by default (hamburger), full data tables still work
- **Mobile** (`< md`, <768px): Bottom tab bar navigation, tables collapse to stacked cards, touch targets ≥44px

The current `AppShell` already has a hamburger + Sheet-based mobile sidebar. v1.2 replaces the mobile hamburger approach with a persistent bottom tab bar on small screens.

---

## Recommended Stack

### Core Technologies (all already installed)

| Technology | Version | Purpose | Why Sufficient |
|------------|---------|---------|----------------|
| Tailwind CSS | v4 (CSS-first config) | Responsive breakpoints, safe-area utilities | Mobile-first breakpoint system with `sm:`, `md:`, `lg:` prefixes; `@theme` for custom breakpoints in `globals.css` |
| shadcn/ui | 4.1.0 | Component registry | All UI primitives needed for layout restructuring exist |
| @base-ui/react | 1.3.0 | Headless component primitives | Dialog, Sheet, Popover — used for mobile overlays |
| lucide-react | 0.577.0 | Navigation icons for bottom tab bar | Already provides all icons needed for 5-tab bottom nav |
| next/navigation | Next.js 16 | `usePathname()` for active tab detection | Already used in Sidebar component |

### No New Dependencies Needed

| Capability | How to Achieve | Why No New Package |
|------------|---------------|-------------------|
| Bottom tab bar | Custom component using `<Link>`, `usePathname()`, `lucide-react` icons, Tailwind | 30-50 lines of code; no third-party nav library matches the project's design system |
| Responsive tables → cards | Tailwind `hidden md:table` + conditional card rendering in same component | Pure CSS breakpoint technique, no table library needed |
| Safe-area insets (iPhone notch) | CSS `env(safe-area-inset-bottom)` inline style on bottom tab bar | Browser-native API, no package needed |
| `useMediaQuery` / mobile detection | Build a 10-line `use-mobile.ts` hook using `window.matchMedia` | Simpler than installing `react-responsive` or `use-media` |
| Touch target sizing | Tailwind `min-h-[44px] min-w-[44px]` on interactive elements | CSS-only, no library |
| Swipe gestures on drawers | Vaul is already shadcn's drawer backing library | Already available via the existing `<Sheet>` component on `@base-ui/react` |

---

## New Components to Build (from existing primitives)

| Component | File | Built From | Purpose |
|-----------|------|-----------|---------|
| `BottomTabBar` | `src/components/layout/bottom-tab-bar.tsx` | `<Link>`, `usePathname`, lucide icons, Tailwind | Mobile-only navigation bar pinned to viewport bottom |
| `use-mobile` hook | `src/hooks/use-mobile.ts` | `window.matchMedia('(max-width: 767px)')` | Detects mobile viewport for conditional rendering |
| `MobileCard` slot | Inline in each page component | `<Card>`, `<Badge>`, existing UI primitives | Stacked card layout shown only on `< md` |

These are implementation artifacts, not library additions. They follow the same patterns already established in the codebase.

---

## Tailwind Breakpoint Strategy

The project uses Tailwind v4 with CSS-first configuration. Breakpoints are defined in `globals.css` via `@theme`:

```css
/* Already in globals.css via @import "tailwindcss" */
/* Default Tailwind v4 breakpoints apply: */
/* sm: 640px, md: 768px, lg: 1024px, xl: 1280px */
```

**Pattern for bottom tab bar visibility:**

```css
/* Show bottom tab bar only below md breakpoint */
.bottom-tab-bar {
  display: flex;   /* visible on mobile */
}

@media (min-width: 48rem) {  /* md = 768px */
  .bottom-tab-bar {
    display: none;
  }
}
```

Tailwind utility equivalent: `flex md:hidden` on the tab bar container.

**Pattern for sidebar visibility:**

```
hidden md:flex   ← desktop sidebar (already implemented in AppShell)
```

**Pattern for data table → card layout:**

```
hidden md:block  ← table wrapper (hide on mobile)
block md:hidden  ← card list wrapper (show on mobile)
```

---

## Safe-Area Insets (iOS Notch / Android Cutout)

The bottom tab bar must sit above the home indicator bar on iPhone X+. This requires the `viewport-fit=cover` meta tag and CSS environment variables.

**Required viewport meta tag** (add to `src/app/layout.tsx`):

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

**Bottom tab bar padding** (inline style or custom Tailwind utility):

```css
padding-bottom: env(safe-area-inset-bottom, 0px);
```

No npm package is needed. This is a browser-native CSS function supported by all modern browsers including Chrome for Android, Safari iOS, and Firefox.

---

## Bottom Tab Bar Design

The app has 9 navigation destinations in the sidebar. A mobile bottom tab bar should show 5 at most (thumb reachability constraint). The approach:

**Primary tabs (always visible in bottom bar):**
1. Dashboard — `LayoutDashboard` icon
2. Customers — `Users` icon
3. Loans — `Banknote` icon
4. Payments — `CreditCard` icon
5. More — `Menu` icon (opens a Sheet with the remaining destinations)

**"More" sheet destinations (shown via bottom Sheet on tap):**
- Watchlist, Creditors, Expenses & Income, Reports, Admin

The "More" sheet uses the existing `<Sheet side="bottom">` component already in the codebase (via `@base-ui/react`). No new components needed.

**Active state detection:** `usePathname()` from `next/navigation` — already used identically in `sidebar.tsx`.

---

## Mobile-Friendly Data Tables

**Pattern:** Dual rendering within the same component — table for `md:` and above, card list for mobile. No new library. Tailwind visibility utilities handle the switch.

```tsx
{/* Desktop: full table */}
<div className="hidden md:block">
  <Table>...</Table>
</div>

{/* Mobile: stacked card list */}
<div className="block md:hidden space-y-3">
  {rows.map(row => (
    <Card key={row.id} className="p-4">
      <div className="flex justify-between items-start">
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-sm text-muted-foreground">{row.subtitle}</p>
        </div>
        <Badge>{row.status}</Badge>
      </div>
    </Card>
  ))}
</div>
```

The `<Card>` component is already installed. This pattern is proven and requires zero additional dependencies.

---

## Touch Target Sizing

Apple HIG and Google Material both specify 44×44pt as the minimum touch target. The existing Button component (`size="sm"` = `h-8`) is 32px — too small for primary mobile actions.

**Fix:** Apply `min-h-[44px] min-w-[44px]` on buttons that serve as primary touch targets on mobile. This is a Tailwind utility — no new package needed. The fix is applied via responsive class:

```tsx
<Button className="h-8 md:h-8 min-h-[44px] md:min-h-0">
```

Or, more precisely, apply `touch-manipulation` and target enlargement only at `< md` viewport.

---

## Cypress Viewport Testing

The existing Cypress test suite must be updated to test at both mobile and desktop viewports. Cypress 15 (already installed at ^15.12.0) supports `cy.viewport()` natively — no new plugin needed.

**Standard Cypress viewport presets available:**
- `cy.viewport('iphone-14')` — 390×844
- `cy.viewport('ipad-2')` — 768×1024
- `cy.viewport(1280, 800)` — desktop

**Pattern for multi-viewport testing in existing spec files:**

```typescript
const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
]

viewports.forEach(({ name, width, height }) => {
  describe(`${name} viewport`, () => {
    beforeEach(() => cy.viewport(width, height))
    // tests here
  })
})
```

No new Cypress plugin is needed. `cypress-real-events` (already installed at ^1.15.0) covers touch events for swipe gesture testing.

---

## What NOT to Add

| Package | Why to Avoid | What to Use Instead |
|---------|-------------|---------------------|
| `react-responsive` | Adds SSR hydration complexity; `window.matchMedia` hook does the same job in 10 lines | Custom `use-mobile.ts` hook |
| `use-media` | Extra dependency for a 10-line hook | Custom `use-mobile.ts` hook |
| `@radix-ui/react-navigation-menu` | Conflicts with `@base-ui/react` — this project explicitly uses base-ui, not Radix | Custom component with `<Link>` + `usePathname` |
| `framer-motion` | Heavy (100KB+) for tab bar animation; Tailwind transitions + `tw-animate-css` (already installed) are sufficient | `transition-colors duration-150` Tailwind utilities |
| `react-swipeable` | Bottom sheet swipe is handled by Vaul (already backing the `<Sheet>` component) | Existing `<Sheet>` from `@base-ui/react` |
| `TanStack Table` (`@tanstack/react-table`) | Overkill for the mobile card pattern; table → card switch is a CSS visibility toggle | `hidden md:block` / `block md:hidden` Tailwind pattern |
| Any native mobile framework (React Native, Capacitor, Ionic) | Explicitly out of scope — web-only per PROJECT.md | N/A |
| `next-pwa` / `@ducanh2912/next-pwa` | PWA not in scope for v1.2 | N/A |

---

## AppShell Restructuring Plan

The current `AppShell` handles mobile via a hamburger button → Sheet drawer for the sidebar. v1.2 replaces this with:

**Before:**
```
[TopBar with hamburger] → [Sheet sidebar on mobile] + [inline sidebar on desktop]
[main content area]
```

**After:**
```
[TopBar — desktop only shows hamburger for collapse, mobile shows no hamburger]
[sidebar — md:flex hidden on mobile]
[main content area — pb-16 md:pb-0 to clear bottom tab bar]
[BottomTabBar — flex md:hidden, position: fixed bottom-0]
```

The `TopBar` hamburger button gets `hidden md:hidden` (remove entirely on mobile) since the bottom tab bar replaces it. The main content area needs `pb-16` (64px) on mobile to prevent content from hiding behind the fixed tab bar.

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| No new npm packages needed | HIGH | Direct inspection of package.json confirms Tailwind v4, lucide-react, base-ui/react, Sheet, Card all installed |
| Bottom tab bar implementability | HIGH | Pattern is pure HTML/CSS/React; `usePathname` already used identically in sidebar.tsx |
| Safe-area-inset browser support | HIGH | MDN documents universal support across Chrome, Safari, Firefox, Edge |
| Table → card responsive pattern | HIGH | Standard Tailwind `hidden md:block` pattern; Card component already installed |
| Cypress multi-viewport testing | HIGH | `cy.viewport()` documented in Cypress 15 official docs; cypress-real-events already installed |
| Touch target fix via Tailwind | HIGH | CSS min-height/min-width are universally supported |

---

## Sources

- `/Users/faridmatovu/projects/money-lending/package.json` — installed versions (direct inspection)
- `/Users/faridmatovu/projects/money-lending/src/components/layout/app-shell.tsx` — current AppShell structure
- `/Users/faridmatovu/projects/money-lending/src/components/layout/sidebar.tsx` — `usePathname` active state pattern
- `/Users/faridmatovu/projects/money-lending/src/components/ui/` — inventory of existing UI primitives
- [shadcn/ui Tailwind v4 changelog](https://ui.shadcn.com/docs/changelog/2025-02-tailwind-v4) — Tailwind v4 component compatibility confirmed (MEDIUM confidence — WebSearch)
- [GitHub issue #8847 — Bottom Navigation component request](https://github.com/shadcn-ui/ui/issues/8847) — confirms no official shadcn bottom nav component exists; custom build required (HIGH confidence)
- [GitHub discussion #5730 — Mobile bottom tab navigation](https://github.com/shadcn-ui/ui/discussions/5730) — community pattern validation (MEDIUM confidence)
- [MDN env() CSS function](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env) — safe-area-inset universal browser support (HIGH confidence)
- [Cypress viewport docs](https://docs.cypress.io/api/commands/viewport) — cy.viewport() API confirmation (HIGH confidence)
- [Tailwind responsive design docs](https://tailwindcss.com/docs/responsive-design) — breakpoint strategy (HIGH confidence)

---

*Stack research for: v1.2 Responsive — Mobile + Desktop layouts*
*Researched: 2026-03-24*
