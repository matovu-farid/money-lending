# Phase 15: Touch Optimization - Research

**Researched:** 2026-03-25
**Domain:** Touch targets (WCAG 2.5.8), responsive dialog/drawer pattern, swipe navigation
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TOUCH-01 | All interactive elements meet 44px minimum touch target (WCAG 2.5.8) | Audit shows button default size is `h-8` (32px). `DropdownMenuTrigger` action buttons use explicit `h-8 w-8`. All need a 44px minimum via `min-h-[44px] min-w-[44px]` or a CSS utility, but only on mobile — desktop can remain compact. The notification bell already demonstrates the pattern. |
| TOUCH-02 | DrawerDialog component — dialog on desktop, bottom drawer on mobile | `@base-ui/react` v1.3.0 ships `./drawer` export with `Drawer.Root`, `Drawer.Popup`, `Drawer.Trigger`, `Drawer.Close`, `Drawer.Backdrop`, `Drawer.SwipeArea`, `Drawer.Title`, `Drawer.Description`. No new package install needed. Sheet already uses `@base-ui/react/dialog` with `side="bottom"` — a `DrawerDialog` wrapper can choose between `Dialog` (desktop) and a Sheet-style `Drawer.Popup` (mobile) via the existing `@base-ui/react/unstable-use-media-query` hook. |
| TOUCH-03 | Swipe gestures for mobile navigation where applicable without conflicting with browser back gestures | `Drawer.SwipeArea` from `@base-ui/react/drawer` enables swipe-to-close on drawers. For navigation between pages, swipe is explicitly complex and conflicts with browser back gesture — the requirement says "where applicable", meaning the scope is swipe-to-close on the MoreSheet drawer, not full swipe navigation between routes. |
</phase_requirements>

---

## Summary

Phase 15 has three distinct sub-problems. Two are CSS / component composition work; one (TOUCH-03) requires careful scoping.

**TOUCH-01 (44px touch targets)** is a codebase-wide audit and fix. The default `Button` size is `h-8` (32px) — below the 44px WCAG minimum. Interactive elements need a visual hit-area of at least 44×44px on mobile. The CSS approach is to add `min-h-[44px] min-w-[44px]` on mobile (`md:min-h-0 md:min-w-0`) to the Button component's default size, or add it to the specific interactive elements that appear on mobile. The `DropdownMenuTrigger` elements in table row action menus (`h-8 w-8`) are the most critical gap. The `icon-sm` close buttons in Dialog and Sheet (`size-7` = 28px) also need mobile touch-area expansion. The notification bell already uses `min-h-[44px] min-w-[44px]` — this is the established project pattern.

**TOUCH-02 (DrawerDialog)** is the highest-value task. Currently the codebase has 13+ `DialogContent` usages and 3 `SheetContent` usages across 9 files. Rather than converting each individually, the right approach is to create a single `DrawerDialog` component that renders as a centered modal on desktop (`md+`) and as a bottom-sheet drawer on mobile. This uses `@base-ui/react/drawer` (confirmed at v1.3.0) plus `@base-ui/react/unstable-use-media-query` for the breakpoint switch. Call sites swap `Dialog` → `DrawerDialog` with no change to content.

**TOUCH-03 (swipe gestures)** is explicitly scoped. The MoreSheet (`more-sheet.tsx`) is the primary candidate: it already slides up from the bottom — adding `Drawer.SwipeArea` makes it dismissible by swipe-down. Full swipe-left/right navigation between pages is explicitly out of scope because it conflicts with the browser's native back-forward gesture and provides no unique value when the BottomTabBar is present.

**Primary recommendation:** Implement in order TOUCH-01 (CSS touch targets) → TOUCH-02 (DrawerDialog component + migrate call sites) → TOUCH-03 (swipe-to-close on MoreSheet). The first two can be separate plan waves; TOUCH-03 is a small addition to the DrawerDialog wave.

---

## Standard Stack

### Core (already installed — zero new packages)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @base-ui/react | 1.3.0 | `Drawer.Root`, `Drawer.Popup`, `Drawer.SwipeArea` | Already used for Dialog, Sheet, Popover, Collapsible. Drawer confirmed present via `./drawer` export. |
| @base-ui/react/unstable-use-media-query | 1.3.0 | SSR-safe breakpoint detection for desktop/mobile toggle | Ships with @base-ui, confirmed in package exports. Used to choose Dialog vs Drawer at render time. |
| tailwindcss | ^4 | `min-h-[44px]`, `min-w-[44px]`, `md:min-h-0`, `md:min-w-0` | Project standard |

### No new packages needed

All required primitives exist in the installed `@base-ui/react` v1.3.0. The `./drawer` and `./unstable-use-media-query` exports are confirmed present.

**Installation:** None required.

**Version verification (already confirmed):**
```
@base-ui/react: 1.3.0 — ./drawer export: confirmed
```

---

## Architecture Patterns

### Recommended Project Structure — New and Modified Files

```
src/
└── components/
    └── ui/
        └── drawer-dialog.tsx     # New: responsive dialog/drawer wrapper (TOUCH-02)

Callers updated to use DrawerDialog:
src/app/(app)/customers/[id]/page.tsx
src/app/(app)/loans/[loanId]/loan-detail-client.tsx
src/app/(app)/loans/page.tsx
src/app/(app)/payments/PaymentsClient.tsx
src/app/(app)/payments/QuickRecordDialog.tsx
src/app/(app)/expenses/ExpenseListClient.tsx
src/app/(app)/income/IncomeListClient.tsx
src/app/(app)/creditors/[id]/RecordRepaymentDialog.tsx
src/app/(app)/creditors/[id]/AddInvestmentDialog.tsx

Touch-target fixes (TOUCH-01):
src/components/ui/button.tsx              # Add mobile min touch-area to default/icon sizes
src/app/(app)/loans/[loanId]/loan-detail-client.tsx  # DropdownMenuTrigger h-8 w-8 fix
src/app/(app)/loans/page.tsx                         # DropdownMenuTrigger fix
src/app/(app)/payments/PaymentsClient.tsx            # DropdownMenuTrigger fix

Swipe area (TOUCH-03):
src/components/layout/more-sheet.tsx      # Add Drawer.SwipeArea handle
```

---

### Pattern 1: Touch Target Fix (TOUCH-01)

**What:** All tappable UI elements must have a minimum 44×44px touch target on mobile.

**Current state:**
- `Button` default size: `h-8` = 32px — below 44px minimum
- `Button size="icon"`: `size-8` = 32px — below 44px minimum
- `Button size="icon-sm"`: `size-7` = 28px — below 44px minimum
- `DropdownMenuTrigger` in action menus: explicit `h-8 w-8` — 32px — below minimum
- `Button size="lg"`: `h-9` = 36px — still below 44px minimum
- BottomTabBar tabs: `flex-1 h-14` — 56px — already meets requirement
- Notification bell: `min-h-[44px] min-w-[44px]` — already meets requirement

**Approach (visual size vs touch area):**
WCAG 2.5.8 allows the visual size to stay small if the interactive element's hit area (via padding) meets 44px. The correct technique is to keep visual size unchanged and expand the interactive hit area using `min-h-[44px] min-w-[44px]` on mobile.

For the Button component, the best fix is to add `min-h-[44px] md:min-h-0` to the relevant size variants so the touch area is automatically 44px tall on mobile without changing desktop appearance.

For `DropdownMenuTrigger` elements in table cards (which appear on mobile), the fix is to add `min-h-[44px] min-w-[44px] md:h-8 md:w-8` or similar to the className already on those elements.

**Example (Button component update):**
```tsx
// Source: src/components/ui/button.tsx — buttonVariants cva
// Add min-h-[44px] md:min-h-0 to default, lg, icon sizes:
size: {
  default: "h-8 min-h-[44px] md:min-h-0 gap-1.5 px-2.5 ...",
  lg:      "h-9 min-h-[44px] md:min-h-0 gap-1.5 px-2.5 ...",
  icon:    "size-8 min-h-[44px] min-w-[44px] md:min-h-8 md:min-w-8",
  "icon-sm": "size-7 min-h-[44px] min-w-[44px] md:min-h-7 md:min-w-7",
}
```

**Scope of audit — interactive elements to fix:**

| Element | Location | Current Size | Fix |
|---------|----------|-------------|-----|
| Default Button | button.tsx | h-8 (32px) | min-h-[44px] md:min-h-0 |
| Button size="lg" | button.tsx | h-9 (36px) | min-h-[44px] md:min-h-0 |
| Button size="icon" | button.tsx | 32×32px | min-h-[44px] min-w-[44px] md:size-8 |
| Button size="icon-sm" | button.tsx | 28×28px | min-h-[44px] min-w-[44px] md:size-7 |
| DropdownMenuTrigger (action menu) | loan-detail-client, loans/page, PaymentsClient | h-8 w-8 (32px) | min-h-[44px] min-w-[44px] md:h-8 md:w-8 |
| FilterPanel toggle button | filter-panel.tsx | h-8 (32px) | Already mobile-only; add min-h-[44px] |

**Note:** `Button size="sm"` (`h-7` = 28px) and `Button size="xs"` (`h-6`) should also be checked, but these appear primarily in desktop table headers, pagination, and filter bars — not as primary mobile actions. If they appear in mobile card action areas, they also need the fix.

---

### Pattern 2: DrawerDialog Component (TOUCH-02)

**What:** A single wrapper component that uses `@base-ui/react/dialog` on desktop (md+) and `@base-ui/react/drawer` on mobile (< md). Callers use `DrawerDialog` instead of `Dialog` with identical content children.

**Critical design decision — how to detect mobile/desktop:**

Option A: `useMediaQuery` from `@base-ui/react/unstable-use-media-query`
- SSR-safe: takes `defaultMatches` parameter
- Returns `boolean` — no hydration mismatch with `noSsr: false` and `defaultMatches: false`
- Simple: `const isMobile = !useMediaQuery('(min-width: 768px)', { defaultMatches: false })`

Option B: CSS-only (render both, hide one)
- Requires two Dialog instances in DOM — problematic for focus management and accessibility
- NOT recommended for this case

**Use Option A.** The `unstable-` prefix is a base-ui convention indicating "API may change" not "unstable in runtime."

**DrawerDialog component structure:**
```tsx
// Source: @base-ui/react/drawer and @base-ui/react/unstable-use-media-query APIs
// src/components/ui/drawer-dialog.tsx
"use client"

import * as React from "react"
import { useMediaQuery } from "@base-ui/react/unstable-use-media-query"
import { Drawer } from "@base-ui/react/drawer"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

// Props mirror Dialog API
interface DrawerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

export function DrawerDialog({ open, onOpenChange, children }: DrawerDialogProps) {
  // defaultMatches: false = desktop layout is SSR default
  // This means on first render it shows as Dialog (no bottom drawer flicker on desktop)
  const isDesktop = useMediaQuery("(min-width: 768px)", { defaultMatches: true })

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {children}
      </Dialog>
    )
  }

  return (
    <Drawer.Root open={open} onOpenChange={(o) => onOpenChange(o)} swipeDirection="down">
      {children}
    </Drawer.Root>
  )
}
```

**However**: this approach requires callers to render different content components (`DialogContent` vs `Drawer.Popup`). A cleaner approach keeps the content unified:

```tsx
// DrawerDialogContent renders DialogContent on desktop, Drawer.Popup on mobile
export function DrawerDialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: { className?: string; children: React.ReactNode; showCloseButton?: boolean }) {
  const isDesktop = useMediaQuery("(min-width: 768px)", { defaultMatches: true })

  if (isDesktop) {
    return (
      <DialogContent className={className} showCloseButton={showCloseButton} {...props}>
        {children}
      </DialogContent>
    )
  }

  return (
    <Drawer.Portal>
      <Drawer.Backdrop className="fixed inset-0 z-50 bg-black/10 ..." />
      <Drawer.Popup
        data-slot="drawer-dialog-content"
        className={cn(
          "fixed bottom-0 inset-x-0 z-50 flex flex-col bg-white/85 rounded-t-xl p-4 max-h-[90dvh]",
          "data-open:animate-in data-open:slide-in-from-bottom",
          "data-closed:animate-out data-closed:slide-out-to-bottom",
          className
        )}
        {...props}
      >
        {/* Drag handle */}
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-muted-foreground/30" />
        {children}
      </Drawer.Popup>
    </Drawer.Portal>
  )
}
```

**Migration pattern for call sites — minimal diff:**
```tsx
// BEFORE
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"

<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent>
    <DialogHeader><DialogTitle>...</DialogTitle></DialogHeader>
    ...
    <DialogFooter>...</DialogFooter>
  </DialogContent>
</Dialog>

// AFTER
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import { DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"

<DrawerDialog open={open} onOpenChange={onOpenChange}>
  <DrawerDialogContent>
    <DialogHeader><DialogTitle>...</DialogTitle></DialogHeader>
    ...
    <DialogFooter>...</DialogFooter>
  </DrawerDialogContent>
</DrawerDialog>
```

`DialogHeader`, `DialogTitle`, `DialogFooter`, `DialogDescription` are plain `<div>` wrappers — they work identically inside `DrawerDialogContent` whether rendered as dialog or drawer.

**Files that use SheetContent with side="right" (edit forms) — SEPARATE handling:**
The `SheetContent side="right"` pattern in `PaymentsClient`, `ExpenseListClient`, `IncomeListClient` is an edit panel, not a confirmation dialog. On mobile, a side-sheet that slides in from the right is not thumb-friendly. The correct mobile conversion is `side="bottom"` on mobile. This can be done with a similar `DrawerSheet` wrapper, or by changing `side` based on viewport — using the existing `Sheet` component with `side={isDesktop ? "right" : "bottom"}`.

---

### Pattern 3: Swipe-to-Close on MoreSheet (TOUCH-03)

**What:** The MoreSheet (`more-sheet.tsx`) currently uses `SheetContent side="bottom"`. Wrap it with `Drawer.Root` / `Drawer.SwipeArea` to enable swipe-down-to-close.

**Approach:** Convert `more-sheet.tsx` to use `@base-ui/react/drawer` instead of `@base-ui/react/dialog` (which Sheet currently wraps). The Drawer already supports swipe-down-to-close natively via `swipeDirection="down"` on `Drawer.Root`. Add `Drawer.SwipeArea` at the top of the popup for a visible drag handle.

**Scope clarification — TOUCH-03 does NOT include:**
- Swipe-left/right to navigate between tab pages (conflicts with browser back gesture, no implementation value)
- Horizontal swipe on data tables (explicitly out of scope — browser scroll handles this)

**TOUCH-03 implementation:**
```tsx
// more-sheet.tsx — convert from Sheet (Dialog-based) to Drawer
import { Drawer } from "@base-ui/react/drawer"

// Drawer.Root replaces Sheet
// Drawer.Popup with swipeDirection="down" replaces SheetContent side="bottom"
// Drawer.SwipeArea at popup top enables swipe-to-close handle
```

**Why this is safe re: browser back gesture:**
`Drawer.SwipeArea` only intercepts vertical (down) swipes within the drawer popup, not horizontal edge swipes that the browser intercepts for back/forward navigation. These do not conflict.

---

### Anti-Patterns to Avoid

- **Two DOM instances for desktop/drawer:** Don't render `<Dialog>` and `<Drawer>` both in the DOM and toggle visibility via CSS. Focus management, ARIA, and portals require a single active component. The `useMediaQuery` conditional rendering approach is correct.
- **Server-side `useMediaQuery` misuse:** Always pass `defaultMatches: true` (assumes desktop) to avoid bottom-drawer flash on initial server render on desktop devices. This is the SSR-safe convention.
- **Converting every Dialog immediately:** Do not create DrawerDialog and then immediately migrate all 13 call sites in one task. Do it incrementally — create the component, migrate 2-3 dialogs, validate, then migrate the rest.
- **Swipe navigation between pages:** Do not implement `Drawer` or swipe on the main page router. The BottomTabBar already handles primary navigation; adding horizontal swipe creates conflicts with browser gestures and screen reader navigation.
- **Using `vaul` library:** The project does not have `vaul` installed, and `@base-ui/react` v1.3.0 has its own native `Drawer` — no need to install external drawer libraries. This was flagged as a concern in STATE.md ("DrawerDialog @base-ui/react compatibility needs verification task at Phase 15 start") — this research confirms `@base-ui/react/drawer` is available at v1.3.0. The concern is resolved.
- **Breaking `DialogHeader`/`DialogTitle` reuse:** These components are plain `<div>`/`<h2>` wrappers. They work inside any container, including inside `Drawer.Popup`. Don't create separate DrawerHeader/DrawerTitle components.
- **min-h alone without width:** WCAG 2.5.8 requires BOTH dimensions to be at least 44px. Always set both `min-h-[44px] min-w-[44px]` on icon buttons.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bottom drawer with swipe | Custom CSS slide-up + touch event listeners | `@base-ui/react/drawer` Drawer.Root + Drawer.Popup | Handles velocity-based swipe, snap points, focus trap, ARIA, backdrop |
| Breakpoint detection | `useEffect` + `window.innerWidth` + state | `useMediaQuery` from `@base-ui/react/unstable-use-media-query` | SSR-safe, no hydration mismatch, already in the installed package |
| Custom drag handle | Canvas or SVG drag indicator | `Drawer.SwipeArea` + a simple `<div>` visual handle | Drawer.SwipeArea manages touch event capture; visual handle is 2 lines of CSS |
| Touch target CSS class | Custom utility `.touch-target` | Tailwind `min-h-[44px] min-w-[44px]` arbitrary values | Already Tailwind v4 compatible, no new utility definition needed |

**Key insight:** The `@base-ui/react` v1.3.0 drawer concern from STATE.md is resolved — it ships natively. Zero additional packages needed.

---

## Common Pitfalls

### Pitfall 1: SSR Hydration Flash on DrawerDialog
**What goes wrong:** On desktop, the page first renders with `defaultMatches: false` (mobile path), briefly shows a bottom drawer, then re-renders as a dialog after hydration.
**Why it happens:** `useMediaQuery` uses `defaultMatches` for the server render and first paint, then syncs with actual viewport.
**How to avoid:** Pass `defaultMatches: true` — assume desktop on server. The mismatch is then only visible on mobile users who see a very brief desktop dialog before re-rendering as drawer. This is the lesser evil vs the reverse (desktop users seeing drawer).
**Warning signs:** Cypress desktop tests see bottom-drawer animation on dialog open.

### Pitfall 2: Drawer.Root Replacing Dialog.Root — onOpenChange API Difference
**What goes wrong:** `Drawer.Root` fires `onOpenChange(open, eventDetails)` with two arguments; `Dialog.Root` fires `onOpenChange(open)` with one. Callers that destructure the argument may break.
**Why it happens:** The Drawer has richer event details including the change reason. Existing callers pass `(open: boolean) => setState(open)` which is safe — extra args are ignored in JS. But TypeScript may complain if the prop type is `(open: boolean) => void` and the Drawer type is `(open: boolean, details: ChangeEventDetails) => void`.
**How to avoid:** Use `onOpenChange={(o) => onOpenChange(o)}` wrapper in `DrawerDialog` to normalize the signature.
**Warning signs:** TypeScript errors at call sites after migration.

### Pitfall 3: Sheet side="right" Edit Forms Become Inaccessible on Mobile After DrawerDialog Migration
**What goes wrong:** `SheetContent side="right"` on a narrow mobile viewport is clipped or doesn't show correctly because `w-3/4` of 390px is too narrow for a form.
**Why it happens:** The Sheet `side="right"` was designed for desktop sidebar panels.
**How to avoid:** For edit forms currently using `SheetContent side="right"`, use `side={isDesktop ? "right" : "bottom"}` (conditional prop on existing Sheet component, not a new component). OR migrate to DrawerDialogContent which opens as bottom drawer.
**Warning signs:** Edit forms in Payments/Expenses/Income are too narrow to use on mobile.

### Pitfall 4: DropdownMenuTrigger Touch Area Without Visual Break
**What goes wrong:** Adding `min-h-[44px] min-w-[44px]` to DropdownMenuTrigger buttons in table rows increases the tap area but also increases visible button size on mobile cards, breaking the card layout.
**Why it happens:** `min-h` only prevents the element from being smaller; it doesn't add visual padding. The button visual size stays as `h-8 w-8` but the element may push into adjacent elements.
**How to avoid:** Use CSS `padding` to expand the interactive area invisibly: `p-2 h-fit w-fit` on a touch container gives extra finger room without changing visual dimensions. Alternative: use `after:` pseudo-element to expand the hit area without affecting layout flow.
**Warning signs:** Mobile card rows have extra whitespace between the content and the action button.

### Pitfall 5: Drawer Popup z-index Conflicts With BottomTabBar
**What goes wrong:** The BottomTabBar is `z-40`. The Drawer backdrop and popup use `z-50` by default. If not properly layered, the tab bar can appear above the drawer backdrop.
**Why it happens:** The BottomTabBar is `z-40 fixed`; the Drawer backdrop is `z-50 fixed`. This should be fine — drawer is higher. But if the Drawer portal renders before BottomTabBar in the DOM and both are `fixed`, paint order may vary.
**How to avoid:** Use `z-50` on `Drawer.Backdrop` and `Drawer.Popup` (matches existing Sheet and Dialog patterns). The BottomTabBar at `z-40` is correctly below. Verify in Cypress by opening a drawer from a mobile tab and asserting the tab bar is not visible through the backdrop.
**Warning signs:** Tab bar icons visible through the drawer backdrop.

---

## Code Examples

Verified patterns from the installed package and existing codebase:

### @base-ui/react Drawer API (confirmed from node_modules type definitions)
```tsx
// Source: node_modules/@base-ui/react/esm/drawer/root/DrawerRoot.d.ts
import { Drawer } from "@base-ui/react/drawer"

// Sub-components available:
// Drawer.Root       — groups all parts, controls open/close
// Drawer.Trigger    — button that opens the drawer
// Drawer.Portal     — portals popup to body
// Drawer.Backdrop   — overlay behind the popup
// Drawer.Popup      — the sliding container (renders <div>)
// Drawer.SwipeArea  — invisible zone that listens for swipe-to-open gestures
// Drawer.Close      — closes the drawer
// Drawer.Title      — accessible title
// Drawer.Description — accessible description

// Drawer.Root props (key subset):
// open?: boolean
// defaultOpen?: boolean
// onOpenChange?: (open: boolean, eventDetails) => void
// modal?: boolean | 'trap-focus'     (default: true)
// swipeDirection?: 'up' | 'down' | 'left' | 'right'  (default: 'down')
// snapPoints?: (number | string)[]   — fractions 0-1, px values, or rem strings
```

### useMediaQuery (confirmed from node_modules type definitions)
```tsx
// Source: node_modules/@base-ui/react/esm/unstable-use-media-query/index.d.ts
import { useMediaQuery } from "@base-ui/react/unstable-use-media-query"

// Usage:
const isDesktop = useMediaQuery("(min-width: 768px)", {
  defaultMatches: true,   // SSR default: assume desktop
  noSsr: false,           // safe: double-render to sync with actual viewport
})
```

### Existing Sheet Component (shows @base-ui Dialog used as Sheet — reference for Drawer migration)
```tsx
// Source: src/components/ui/sheet.tsx
// Sheet wraps @base-ui/react/dialog with data-side attribute for CSS slide direction
// The Drawer replaces this for bottom-sheet cases — same visual result, native swipe support
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"
// data-[side=bottom]: inset-x-0 bottom-0 h-auto
```

### Notification Bell Touch Target (established project pattern)
```tsx
// Source: src/components/notifications/notification-bell.tsx:99
// Project precedent for min-h-[44px] min-w-[44px]:
<Button
  variant="ghost"
  size="icon"
  aria-label="Notifications"
  className="relative min-h-[44px] min-w-[44px]"
/>
```

### DropdownMenuTrigger in Action Menus (current state — needs touch-target fix)
```tsx
// Source: src/app/(app)/payments/PaymentsClient.tsx:378-383
<DropdownMenuTrigger
  aria-label="Payment actions"
  className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition-colors"
>
  <MoreHorizontal className="h-4 w-4" />
</DropdownMenuTrigger>

// AFTER (TOUCH-01 fix):
<DropdownMenuTrigger
  aria-label="Payment actions"
  className="flex h-8 w-8 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 items-center justify-center rounded-md hover:bg-muted transition-colors"
>
  <MoreHorizontal className="h-4 w-4" />
</DropdownMenuTrigger>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `vaul` library for drawers | `@base-ui/react/drawer` native | @base-ui v1.0+ | No new dependency; consistent with rest of UI layer |
| JS resize listener for breakpoints | `useMediaQuery` from @base-ui | Phase 12+ (project decision) | SSR-safe, no hydration mismatch |
| Fixed `h-8` buttons everywhere | `min-h-[44px]` on mobile | Phase 15 (this phase) | WCAG 2.5.8 compliance |
| Separate Dialog and Sheet for create/edit | `DrawerDialog` responsive wrapper | Phase 15 (this phase) | Single component replaces 13 call sites |

**Key resolved concern (from STATE.md):**
> "DrawerDialog @base-ui/react compatibility needs verification task at Phase 15 start"

`@base-ui/react` v1.3.0 ships `./drawer` as a confirmed export. The concern is fully resolved — no third-party library (vaul, react-spring-bottom-sheet, etc.) is required. The Drawer API is stable with full TypeScript types.

---

## Open Questions

1. **SheetContent side="right" edit forms — DrawerDialog or keep as Sheet?**
   - What we know: `PaymentsClient`, `ExpenseListClient`, `IncomeListClient` use `SheetContent side="right"` for edit forms
   - What's unclear: Whether these should be migrated to DrawerDialogContent (bottom on mobile) or kept as sheets with `side={isDesktop ? "right" : "bottom"}`
   - Recommendation: Use `DrawerDialogContent` (bottom drawer on mobile) for consistency. The edit form sheet pattern on mobile is awkward in a right-side sheet — bottom drawer is more thumb-friendly.

2. **Button size="sm" and size="xs" — need touch target fix?**
   - What we know: These appear in filter bars, pagination, and table header actions — primarily desktop contexts
   - What's unclear: Whether any `sm`/`xs` buttons appear as the primary action on mobile card layouts
   - Recommendation: Audit at task time. If `sm`/`xs` buttons appear in `ResponsiveTable` card actions or in the bottom-visible portion of mobile pages, apply the same `min-h-[44px]` fix.

3. **DrawerDialog for QuickRecordDialog — scrollable content on small screens**
   - What we know: `QuickRecordDialog` has variable content height (recently-collected chips can add rows)
   - What's unclear: Whether `max-h-[90dvh] overflow-y-auto` on the Drawer.Popup is sufficient
   - Recommendation: Set `max-h-[90dvh] overflow-y-auto` on DrawerDialogContent's mobile popup. Test with a device that has many recent loans.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Cypress 15.12.0 |
| Config file | `cypress.config.ts` |
| Quick run command | `npx cypress run --spec cypress/e2e/touch-optimization.cy.ts` |
| Full suite command | `npx cypress run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TOUCH-01 | All DropdownMenuTrigger action buttons have min 44px hit area at 390px viewport | e2e | `npx cypress run --spec cypress/e2e/touch-optimization.cy.ts` | No — Wave 0 |
| TOUCH-01 | Default Button elements have min 44px height at 390px viewport | e2e | `npx cypress run --spec cypress/e2e/touch-optimization.cy.ts` | No — Wave 0 |
| TOUCH-02 | Dialog opens as bottom drawer at 390px viewport | e2e | `npx cypress run --spec cypress/e2e/touch-optimization.cy.ts` | No — Wave 0 |
| TOUCH-02 | Dialog opens as centered modal at 1280px viewport | e2e | `npx cypress run --spec cypress/e2e/touch-optimization.cy.ts` | No — Wave 0 |
| TOUCH-02 | Drawer closes on swipe-down gesture (cypress-real-events) | e2e | `npx cypress run --spec cypress/e2e/touch-optimization.cy.ts` | No — Wave 0 |
| TOUCH-03 | MoreSheet dismisses on swipe-down gesture | e2e | `npx cypress run --spec cypress/e2e/touch-optimization.cy.ts` | No — Wave 0 |
| TOUCH-03 | Swiping MoreSheet does not trigger browser navigation | manual | N/A — browser nav cannot be asserted in Cypress | manual-only |

**Note on TOUCH-02 swipe test:** `cypress-real-events` (v1.15.0, already installed) provides `cy.realSwipe()` for simulating touch swipe gestures. Use `cy.get('[data-slot="drawer-dialog-content"]').realSwipe("toBottom", { length: 300 })` to test swipe-to-dismiss.

### Sampling Rate
- **Per task commit:** `npx cypress run --spec cypress/e2e/touch-optimization.cy.ts`
- **Per wave merge:** `npx cypress run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `cypress/e2e/touch-optimization.cy.ts` — covers TOUCH-01, TOUCH-02, TOUCH-03
- [ ] `src/components/ui/drawer-dialog.tsx` — the new DrawerDialog component (implementation gap, not test gap)

---

## Sources

### Primary (HIGH confidence)
- Direct type-definition reading — `node_modules/@base-ui/react/esm/drawer/root/DrawerRoot.d.ts` — confirmed Drawer.Root API with `swipeDirection`, `snapPoints`, `onOpenChange(open, eventDetails)` signature
- Direct type-definition reading — `node_modules/@base-ui/react/esm/drawer/popup/DrawerPopup.d.ts` — confirmed Drawer.Popup props and state shape
- Direct type-definition reading — `node_modules/@base-ui/react/esm/drawer/swipe-area/DrawerSwipeArea.d.ts` — confirmed SwipeArea API
- Direct type-definition reading — `node_modules/@base-ui/react/esm/unstable-use-media-query/index.d.ts` — confirmed `useMediaQuery(query, options)` API with `defaultMatches`, `noSsr`
- Direct package.json inspection — `@base-ui/react` version 1.3.0, `./drawer` export confirmed present
- Direct codebase reading — `src/components/ui/dialog.tsx`, `src/components/ui/sheet.tsx`, `src/components/ui/button.tsx` — current component APIs
- Direct codebase reading — `src/app/(app)/payments/PaymentsClient.tsx`, `ExpenseListClient.tsx`, `IncomeListClient.tsx`, `QuickRecordDialog.tsx`, `RecordRepaymentDialog.tsx` — existing Dialog/Sheet usage inventory
- Direct codebase reading — `src/components/notifications/notification-bell.tsx` — established `min-h-[44px] min-w-[44px]` pattern in project

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` — confirmed "DrawerDialog @base-ui/react compatibility needs verification" concern now resolved
- `.planning/STATE.md` — confirmed CSS-only mobile/desktop pattern from Phases 12-14 (informs `useMediaQuery` approach for non-layout cases)
- `cypress/e2e/forms-filters-table-polish.cy.ts` — established pattern for `cy.viewport(390, 844)` mobile tests

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- TOUCH-01 (touch targets): HIGH — `min-h-[44px]` Tailwind approach directly verified; notification bell demonstrates the established project pattern; button sizes read directly from source
- TOUCH-02 (DrawerDialog): HIGH — `@base-ui/react/drawer` confirmed in node_modules v1.3.0 with full type definitions; `useMediaQuery` hook confirmed in package exports; existing Dialog/Sheet API read directly
- TOUCH-03 (swipe gestures): HIGH for MoreSheet scope; deliberately scoped to swipe-to-dismiss (not page navigation); Drawer.SwipeArea API confirmed

**Research date:** 2026-03-25
**Valid until:** 2026-04-25 (stable CSS and @base-ui APIs; no rapidly-changing dependencies)
