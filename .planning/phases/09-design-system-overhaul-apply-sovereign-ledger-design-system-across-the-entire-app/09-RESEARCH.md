# Phase 9: Design System Overhaul — Research

**Researched:** 2026-03-23
**Domain:** CSS design tokens (Tailwind v4), component restyling, typography system
**Confidence:** HIGH

---

## Summary

Phase 9 applies the "Sovereign Ledger" design system — defined in `DESIGN.md` at the project root — across the entire application. The design system is fully specified and the tech stack (Tailwind v4, @base-ui/react, shadcn, Geist/Geist Mono fonts) is already in place. This phase is **purely cosmetic**: no data model changes, no new services, no new routes. Every change lives in `globals.css`, component CSS classes, and layout containers.

The Sovereign Ledger aesthetic is "Quantitative Minimalist": monochromatic palette, electric-blue accent used sparingly, Geist Mono for all numeric values, sharp corners (max `sm` = 0.125rem radius), no border separators (spatial separation instead), and tonal layering to convey depth. The current app uses OKLCH-based shadcn defaults — these map well to the Sovereign Ledger tokens but need to be systematically replaced.

The highest-leverage changes are: (1) updating the CSS design token layer in `globals.css`, (2) updating global typography defaults for headings and numbers, (3) tightening the `Card` and `Button` components to match the sharp-corner/no-divider rules, and (4) touching each page's layout classnames to use the correct spacing scale and surface tiers. Because this phase has no logic changes, Cypress E2E tests are the natural verification tool — visual regressions are detected by asserting computed styles and class presence, not snapshot diffs.

**Primary recommendation:** Implement in four ordered waves: tokens → primitives → page layouts → Cypress verification pass. Keep each wave isolated so that CSS changes are reviewable page by page.

---

## Standard Stack

### Core (already installed — no new packages required)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tailwindcss | ^4 | Utility-first CSS | Already installed; v4 uses CSS-native `@theme` and `@layer` — no tailwind.config.js |
| @base-ui/react | ^1.3.0 | Headless primitives (Button, Input, Badge etc.) | Already in use across all components |
| shadcn | ^4.1.0 | Component wrappers / `globals.css` conventions | Already provides the CSS token layer |
| next/font/google | bundled with next 16.2.0 | Geist + Geist Mono font loading | Already loaded in `layout.tsx` |
| class-variance-authority | ^0.7.1 | Variant classes in `buttonVariants`, `badgeVariants` | Already used |
| clsx + tailwind-merge | ^2.1.1 / ^3.5.0 | Class merging utility (`cn()`) | Already used |

No new npm installs are needed for this phase.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tw-animate-css | ^1.4.0 | CSS animation utilities | Already imported; keep for dialog/sheet transitions |

---

## Architecture: What Changes Where

### The Tailwind v4 Token Layer

The project uses Tailwind v4's `@theme inline` block in `globals.css` to map CSS custom properties to utility classes. The Sovereign Ledger tokens map onto the **existing** shadcn token names as follows:

| Sovereign Ledger Token | Value (hex) | Maps to shadcn token | Current OKLCH value |
|------------------------|-------------|----------------------|----------------------|
| `surface` | #f9f9fb | `--background` | `oklch(1 0 0)` — needs update |
| `surface_container_lowest` | #ffffff | `--card` | `oklch(1 0 0)` — already correct |
| `surface_container_low` | #f3f3f5 | `--muted` | `oklch(0.97 0 0)` — needs update |
| `surface_container` | #edeef0 | `--accent` | `oklch(0.97 0 0)` — needs update |
| `surface_container_high` | #e8e8ea | `--secondary` | `oklch(0.97 0 0)` — needs update |
| `surface_container_highest` | #e2e2e4 | `--input` / `--border` | needs update |
| `surface_dim` | #d9dadc | `--ring` (disabled state) | needs update |
| `outline_variant` | #c6c6c6 | `--border` | `oklch(0.922 0 0)` — close |
| `outline` | #777777 | `--ring` | `oklch(0.708 0 0)` — close |
| `on_surface` | #1a1c1d | `--foreground` | `oklch(0.145 0 0)` — very close |
| `on_surface_variant` | #474747 | `--muted-foreground` | `oklch(0.556 0 0)` — needs update |
| `primary` (black) | #000000 | `--primary` | `oklch(0.205 0 0)` — needs to be true black |
| `on_primary` | #e2e2e2 | `--primary-foreground` | needs update |
| `tertiary` (Electric Blue) | #002f9c | No equivalent yet | Map to `--ring` or new `--accent` |
| `error` / `destructive` | existing red | `--destructive` | keep as-is |

**Important:** Tailwind v4 uses OKLCH natively. Hex values in `DESIGN.md` must be converted to OKLCH for the CSS variable block. The conversion is mechanical and does not require new tooling — use the `oklch()` CSS function directly or convert manually.

Approximate OKLCH equivalents for key Sovereign Ledger colors:
- `#f9f9fb` → `oklch(0.98 0 0)` (surface)
- `#f3f3f5` → `oklch(0.96 0 0)` (surface_container_low / muted)
- `#1a1c1d` → `oklch(0.145 0 264)` (on_surface / foreground — already ~correct)
- `#474747` → `oklch(0.42 0 0)` (on_surface_variant)
- `#000000` → `oklch(0 0 0)` (primary)
- `#e2e2e2` → `oklch(0.9 0 0)` (on_primary / primary-foreground)
- `#002f9c` → `oklch(0.35 0.2 264)` (tertiary / Electric Blue accent)
- `#c6c6c6` → `oklch(0.8 0 0)` (outline_variant / border)
- `#777777` → `oklch(0.53 0 0)` (outline / ring)

### Radius Overhaul

The design system mandates sharp corners: max `lg` = 0.5rem, prefer `sm` = 0.125rem for buttons and financial terminals.

Current `globals.css`:
```css
--radius: 0.625rem;
```

Required change:
```css
--radius: 0.5rem;  /* lg = 0.5rem */
/* sm = 0.125rem, md = 0.4rem automatically via the calc() scale */
```

The button component already has `rounded-lg` in its base classes — this will naturally tighten when `--radius` changes. Cards use `rounded-xl` which becomes effectively `0.7rem` — acceptable as card containers should feel slightly softer than buttons.

### The "No-Line" Rule Implementation

**Current state:** The app uses `border-b`, `border-r`, and `ring-1 ring-foreground/10` extensively for section separators.

**Required changes:**
- Card component: remove `ring-1 ring-foreground/10` from base classes, rely on tonal background difference
- Sidebar: remove `border-r border-sidebar-border`, use background color difference (`bg-sidebar` vs `bg-background`) as the only separator
- Table: `<TableRow>` currently renders with default `border-b` — keep only within table body (data rows need some scanability anchor), but reduce opacity to match "felt not seen" rule (15% opacity)
- TopBar: remove `border-b`, use `bg-background` vs `bg-surface` distinction

### Typography System

**Current state:** `layout.tsx` already loads `Geist` and `Geist Mono` via `next/font/google` and exposes them as `--font-geist-sans` and `--font-geist-mono`. The `globals.css` maps `--font-sans` and `--font-mono`.

**Required changes in `globals.css`:**
```css
@layer base {
  /* All numeric values must use Geist Mono */
  /* This cannot be automated with a single rule — must be applied per-component */

  /* Headings: tight tracking */
  h1, h2, h3 {
    letter-spacing: -0.02em;  /* -2% tracking */
  }

  /* Labels: uppercase with +5% tracking */
  /* Applied via utility classes .label-sm on individual elements */
}
```

**Per-component typography changes:**
- All `text-2xl font-semibold` page headings → add `tracking-tight` (already correct at -2%)
- All currency/numeric values (UGX amounts, percentages, counts) → add `font-mono` utility class
- All metadata labels (table headers, card subtitles) → consider `uppercase tracking-wider text-xs` for the "Technical Blueprint" feel

### Sidebar Token Update

The sidebar uses separate CSS variables (`--sidebar`, `--sidebar-foreground`, etc.). These need to align with the Sovereign Ledger surface hierarchy:

```css
/* Sidebar should be surface_container_low, not surface_container_lowest */
--sidebar: oklch(0.96 0 0);              /* #f3f3f5 surface_container_low */
--sidebar-foreground: oklch(0.145 0 264); /* on_surface */
--sidebar-primary: oklch(0 0 0);          /* primary black */
--sidebar-accent: oklch(0.93 0 0);        /* surface_container */
--sidebar-border: oklch(0.8 0 0);         /* outline_variant at 15% — but for sidebar, use full */
```

### Floating Elements (Glass & Ghost)

Dialogs, Sheets, and Dropdowns need:
- `backdrop-blur-[24px]` on overlay
- `bg-white/85` (surface_container_lowest at 85% opacity)

The Dialog component in `src/components/ui/dialog.tsx` wraps `@base-ui/react/dialog`. The overlay and positioner classes need updating.

---

## Architecture Patterns

### Recommended Change Order (Waves)

```
Wave 1: globals.css token layer
  - Color tokens (oklch values)
  - Radius variable
  - Font family assignments

Wave 2: Primitive components (no page logic)
  - src/components/ui/button.tsx      — radius, color variants
  - src/components/ui/card.tsx        — remove ring, padding
  - src/components/ui/input.tsx       — border style, focus ring color
  - src/components/ui/badge.tsx       — radius, colors
  - src/components/ui/table.tsx       — border opacity
  - src/components/ui/dialog.tsx      — glassmorphism overlay
  - src/components/ui/sheet.tsx       — glassmorphism overlay

Wave 3: Layout components
  - src/components/layout/top-bar.tsx     — remove border-b, font
  - src/components/layout/sidebar.tsx     — remove border-r, token updates
  - src/components/layout/app-shell.tsx   — main padding/spacing

Wave 4: Page layouts (content area classnames only)
  - dashboard/page.tsx     — KPI grid spacing, activity feed
  - customers/page.tsx     — table layout, page header
  - loans/page.tsx         — table layout
  - payments/PaymentsClient.tsx — tabs, filter bar
  - watchlist/page.tsx     — table, badges
  - creditors/page.tsx     — cards
  - expenses/ExpenseListClient.tsx
  - income/IncomeListClient.tsx
  - transactions/TransactionLogClient.tsx
  - reports/portfolio/PortfolioClient.tsx
  - reports/pnl/PnlClient.tsx
  - reports/balance-sheet/BalanceSheetClient.tsx
  - admin/page.tsx
  - receipts pages (print layout)
```

### Pattern 1: Numeric Value Typography

Every currency, percentage, or count value in the app needs `font-mono` applied. The pattern is:

```tsx
// Before
<p className="text-2xl font-semibold">{formatUGX(value)}</p>

// After (Sovereign Ledger)
<p className="text-2xl font-semibold font-mono tracking-tight">{formatUGX(value)}</p>
```

For table cells with numeric data, right-alignment is required:
```tsx
// Amount columns in tables
<TableCell className="text-right font-mono">{formatUGX(amount)}</TableCell>
<TableHead className="text-right">Amount</TableHead>
```

### Pattern 2: Surface Tier Usage

The three-tier surface hierarchy must be consistently applied:

```tsx
// Base layer (the "desk") — body background
// bg-background (maps to surface #f9f9fb)

// Section layer — grouping modules
<div className="bg-muted rounded-lg p-6">  {/* surface_container_low */}

// Interaction layer — most important cards, active inputs
<Card>  {/* bg-card = surface_container_lowest = #ffffff */}
```

**KpiCard** should change from generic `Card` to explicitly use `bg-card` with the surface hierarchy distinction:
```tsx
// The KPI grid sits on bg-muted (section layer)
// Individual KPI cards are bg-card (interaction layer)
// This creates the "stacked cardstock" depth without shadows
```

### Pattern 3: Data-Density List Item

Per the DESIGN.md "Data-Density" list spec, list rows should have a leading color indicator:

```tsx
// Active loan / active customer indicator
<span className="inline-block h-1 w-1 rounded-none bg-[oklch(0.35_0.2_264)]" />
// Error / overdue indicator
<span className="inline-block h-1 w-1 rounded-none bg-destructive" />
```

### Pattern 4: Button Variants Mapped to Sovereign Ledger

| Design System Role | Component Variant | Classname Change Needed |
|--------------------|-------------------|-------------------------|
| Primary (black bg) | `default` | `bg-primary` = black, `text-primary-foreground` = #e2e2e2 — token update handles this |
| Secondary (ghost) | `secondary` | `bg-secondary` = surface_container_high — token update handles this |
| Tertiary (blue text) | new `tertiary` variant | Add to `buttonVariants` in button.tsx: `text-[oklch(0.35_0.2_264)] bg-transparent` |
| Destructive | `destructive` | No change needed |

### Anti-Patterns to Avoid

- **Adding `border-[color]` separators:** The no-line rule means spatial separation and tonal layers do the work. If you feel the urge to add a border, increase padding instead.
- **Using `rounded-2xl` or larger:** Maximum is `rounded-lg` (0.5rem). Cards can use `rounded-lg`, buttons use `rounded-sm`.
- **Using colorful icons:** Stick to `text-muted-foreground` for decorative icons; only use `text-[tertiary]` for actionable icons that need the accent attention.
- **Adding `shadow-*` classes:** No traditional drop shadows. Use `bg-[surface_container_highest]` tonal shift instead for elevating search bars or utility components.
- **Multi-color badge variants for status:** For financial status (Active/Overdue/Paid), use the monochromatic base + tertiary accent pattern only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OKLCH color math | Custom color converter | Write OKLCH values directly in CSS | CSS native in all modern browsers, Tailwind v4 already uses it |
| Dark mode variants | Separate dark theme tokens | `@custom-variant dark` already in `globals.css` | Already scaffolded — just update light mode for this phase |
| Font loading | Custom font provider | `next/font/google` already in `layout.tsx` | Geist and Geist Mono are already loaded with correct CSS variables |
| Component library | New component system | Update existing shadcn/base-ui wrappers | All primitives already exist — this is restyling, not rebuilding |
| CSS token management | Token config file | Direct CSS variables in `globals.css` | Tailwind v4's `@theme inline` block IS the config — no separate file |

---

## Common Pitfalls

### Pitfall 1: Tailwind v4 Breaking Changes from v3

**What goes wrong:** Writing `theme()` function calls, `tailwind.config.js` extend blocks, or `@apply` with arbitrary values in ways that only work in v3.
**Why it happens:** Training data is heavily v3. Tailwind v4 is a complete rewrite.
**How to avoid:** All customization happens in `globals.css` using `@theme inline {}` and CSS custom properties. There is no `tailwind.config.js`. Use `--color-*` variable references, not `theme()` calls.
**Warning signs:** Any `tailwind.config.js` or `tailwind.config.ts` file being created; any `theme()` call in CSS; any error about "unknown utility."

### Pitfall 2: OKLCH Values Not Matching Hex Design Spec

**What goes wrong:** Converting DESIGN.md hex colors to OKLCH manually and getting visually incorrect colors.
**Why it happens:** OKLCH lightness, chroma, and hue don't map linearly to hex RGB.
**How to avoid:** Use the browser DevTools color picker to verify conversions. The Tailwind v4 build pipeline will accept standard hex if OKLCH conversion is uncertain — you can use `--primary: #000000` directly in CSS custom properties. Tailwind v4 does not require OKLCH specifically; it's the format shadcn uses, but hex works fine.
**Warning signs:** Colors that are close but slightly wrong, particularly grays that look blue or purple.

### Pitfall 3: base-ui Primitive Class Overrides

**What goes wrong:** Adding Tailwind utilities to base-ui components that the component library's own internal styles override.
**Why it happens:** @base-ui/react components have their own internal stylesheet in some cases. The `cn()` pattern already accounts for this, but `data-*` attribute selectors in the component's own styles may win specificity battles.
**How to avoid:** When restyling, prefer modifying the wrapper component's `cva` variants (in `button.tsx`, `badge.tsx` etc.) rather than adding ad-hoc classnames at the usage site.
**Warning signs:** Applying a class at usage site and seeing no change; running Tailwind with `--debug` shows the class is generated but not visible.

### Pitfall 4: Table Border Reduction Breaking Scannability

**What goes wrong:** Removing all borders from data tables makes them impossible to scan for loan officers processing dozens of entries.
**Why it happens:** The "no-line rule" is about section separators, not data row delimiters.
**How to avoid:** Keep `border-b` on `<TableRow>` elements but reduce it to `border-b border-border/15` (15% opacity as per DESIGN.md ghost border fallback). Do NOT remove table row borders entirely.
**Warning signs:** A loan officer cannot determine which row they're reading during testing.

### Pitfall 5: Font Mono on Non-Numeric Text

**What goes wrong:** Accidentally applying `font-mono` to prose text, labels, or names.
**Why it happens:** Sweeping `font-mono` application to all cells when only numeric cells need it.
**How to avoid:** Apply `font-mono` only to: currency amounts, percentages, counts, timestamps, loan IDs/slugs. Customer names, status labels, and descriptions stay in Geist Sans.
**Warning signs:** Text legibility drops for non-numeric content; names look typewriter-coded.

### Pitfall 6: Receipt Pages and Print Layout

**What goes wrong:** Design token changes break the print layout for disbursement and repayment receipts.
**Why it happens:** `globals.css` has a `@media print` block that hardcodes `background: white; color: black`. If token changes affect this block, receipt printing breaks.
**How to avoid:** Touch the print layout last, audit `@media print` after all token changes, and ensure the receipt pages still render correctly in Cypress with `cy.visit('/receipts/...')`.
**Warning signs:** Receipt page looks wrong in CI screenshots.

---

## Code Examples

### Updating globals.css Token Layer (Wave 1)

```css
/* Source: DESIGN.md Sovereign Ledger spec + Tailwind v4 @theme inline pattern */

:root {
  /* Surface hierarchy — Sovereign Ledger */
  --background: oklch(0.98 0 0);           /* surface #f9f9fb */
  --foreground: oklch(0.145 0 0);          /* on_surface #1a1c1d */

  --card: oklch(1 0 0);                    /* surface_container_lowest #ffffff */
  --card-foreground: oklch(0.145 0 0);

  --muted: oklch(0.96 0 0);               /* surface_container_low #f3f3f5 */
  --muted-foreground: oklch(0.42 0 0);    /* on_surface_variant #474747 */

  --secondary: oklch(0.93 0 0);           /* surface_container_high #e8e8ea */
  --secondary-foreground: oklch(0.145 0 0);

  --accent: oklch(0.94 0 0);              /* surface_container #edeef0 */
  --accent-foreground: oklch(0.145 0 0);

  /* Primary — true black */
  --primary: oklch(0 0 0);               /* #000000 */
  --primary-foreground: oklch(0.9 0 0);  /* on_primary #e2e2e2 */

  /* Borders and rings */
  --border: oklch(0.8 0 0);              /* outline_variant #c6c6c6 */
  --input: oklch(0.9 0 0);               /* surface_container_highest #e2e2e4 */
  --ring: oklch(0.35 0.2 264);           /* tertiary Electric Blue #002f9c */

  /* Radius — sharp financial terminal */
  --radius: 0.5rem;                       /* lg = 0.5rem */

  /* Sidebar */
  --sidebar: oklch(0.96 0 0);            /* surface_container_low */
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0 0 0);
  --sidebar-primary-foreground: oklch(0.9 0 0);
  --sidebar-accent: oklch(0.94 0 0);
  --sidebar-accent-foreground: oklch(0.145 0 0);
  --sidebar-border: oklch(0.8 0 0);
  --sidebar-ring: oklch(0.35 0.2 264);
}
```

### Adding Tertiary Button Variant (Wave 2)

```typescript
// Source: DESIGN.md Button — Tertiary (Accent) spec
// In src/components/ui/button.tsx, inside buttonVariants cva

variant: {
  // ... existing variants ...
  tertiary: "text-[oklch(0.35_0.2_264)] bg-transparent hover:bg-accent",
}

// Usage: "Execute" or "Confirm" calls to action
<Button variant="tertiary">Confirm Payment</Button>
```

### Currency Value with Font Mono (Wave 4 pattern)

```tsx
// Source: DESIGN.md "Data & Numbers (Geist Mono)" spec
// Applied to all currency, percent, and count displays

// KPI Card value
<p className="text-2xl font-semibold font-mono tracking-tight">{formatUGX(value)}</p>

// Table cell amounts (right-aligned, monospaced)
<TableCell className="text-right font-mono tabular-nums">
  UGX {formatNumberWithCommas(amount)}
</TableCell>
<TableHead className="text-right">Amount</TableHead>
```

### Page Header with Tight Tracking (Wave 4 pattern)

```tsx
// Source: DESIGN.md "Display & Headlines" — set with tight tracking
// Replace all text-2xl font-semibold page headings

<h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
<p className="text-sm text-muted-foreground mt-1 uppercase tracking-wider">
  Portfolio health at a glance
</p>
```

### Card with Tonal Depth (No Ring, No Shadow)

```tsx
// Source: DESIGN.md Cards & Data Modules — no dividers, tonal background
// Remove ring-1 ring-foreground/10 from Card base class

// Section wrapper uses muted (surface_container_low)
<div className="bg-muted rounded-lg p-6 space-y-4">
  {/* Individual cards are bg-card (surface_container_lowest = white) */}
  <Card>
    <CardContent>...</CardContent>
  </Card>
</div>
```

---

## Scope Inventory: Files to Touch

### Wave 1 (1 file)
- `src/app/globals.css` — full token rewrite

### Wave 2 (7 files)
- `src/components/ui/button.tsx` — add tertiary variant, radius adjustment
- `src/components/ui/card.tsx` — remove `ring-1 ring-foreground/10`, tighten padding
- `src/components/ui/input.tsx` — focus ring color to tertiary
- `src/components/ui/badge.tsx` — radius to `rounded-sm` for financial terminal
- `src/components/ui/table.tsx` — reduce border opacity on rows
- `src/components/ui/dialog.tsx` — glassmorphism overlay
- `src/components/ui/sheet.tsx` — glassmorphism overlay

### Wave 3 (3 files)
- `src/components/layout/top-bar.tsx` — remove `border-b`, tighten branding
- `src/components/layout/sidebar.tsx` — remove `border-r`, token-driven separation
- `src/components/layout/app-shell.tsx` — content padding, surface background

### Wave 4 (15+ files — page content)
- `src/app/(app)/dashboard/page.tsx` + `src/components/dashboard/kpi-card.tsx`
- `src/app/(app)/customers/page.tsx`
- `src/app/(app)/customers/[id]/page.tsx`
- `src/app/(app)/loans/page.tsx`
- `src/app/(app)/loans/[loanId]/loan-detail-client.tsx`
- `src/app/(app)/payments/PaymentsClient.tsx`
- `src/app/(app)/payments/DailyCollectionsTab.tsx`
- `src/app/(app)/payments/QuickRecordDialog.tsx`
- `src/app/(app)/watchlist/page.tsx`
- `src/app/(app)/creditors/page.tsx` + `CreditorProfileClient.tsx`
- `src/app/(app)/expenses/ExpenseListClient.tsx`
- `src/app/(app)/income/IncomeListClient.tsx`
- `src/app/(app)/transactions/TransactionLogClient.tsx`
- `src/app/(app)/reports/portfolio/PortfolioClient.tsx`
- `src/app/(app)/reports/pnl/PnlClient.tsx`
- `src/app/(app)/reports/balance-sheet/BalanceSheetClient.tsx`
- `src/app/(app)/admin/page.tsx`
- `src/app/(app)/receipts/disbursement/[loanId]/page.tsx`
- `src/app/(app)/receipts/repayment/[paymentId]/page.tsx`

**Total file count:** approximately 26 files changed (1 CSS + 7 components + 3 layout + 15 pages).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| tailwind.config.js | `@theme inline` in CSS | Tailwind v4 (2024) | No config file; all customization in globals.css |
| HSLA/HEX colors | OKLCH color space | Tailwind v4 + shadcn | Perceptually uniform; maps well to tonal layering |
| Radix UI primitives | @base-ui/react | Phase 1 decision | base-ui uses render prop pattern, not asChild |
| Generic SaaS template | Sovereign Ledger spec | Phase 9 (this phase) | Sharp, financial-instrument aesthetic |

**Deprecated in this phase:**
- All `ring-1 ring-foreground/10` on Cards — replace with tonal background difference
- All `border-b border-sidebar-border` and `border-r border-sidebar-border` on layout — replace with background color difference
- `rounded-xl` on buttons — replace with `rounded-sm` (buttons) or `rounded-lg` (cards max)

---

## Open Questions

1. **Dark mode handling**
   - What we know: `globals.css` has a full `.dark` block. The DESIGN.md spec does not describe a dark mode variant.
   - What's unclear: Should the Sovereign Ledger system have a dark mode? Or should dark mode be deferred?
   - Recommendation: Scope this phase to light mode only. Leave the `.dark` block as-is (it already uses good dark defaults). Do not break existing dark mode functionality but don't design it specifically.

2. **Receipt print layout**
   - What we know: `@media print` in `globals.css` hardcodes `background: white; color: black` for receipt pages.
   - What's unclear: The Sovereign Ledger surface changes the background from white to #f9f9fb — receipts should still print white.
   - Recommendation: Ensure `@media print` explicitly resets `--background: oklch(1 0 0)` (pure white) and `--foreground: oklch(0 0 0)` (pure black) to preserve receipt legibility.

3. **Tertiary accent color application scope**
   - What we know: Electric Blue (#002f9c) is the "surgical strike" accent — used only for execute/confirm actions and the "Current/Highlighted" data point.
   - What's unclear: Should the sidebar active item use the tertiary color? The current sidebar uses `bg-sidebar-accent` for the active link.
   - Recommendation: Active sidebar item should use `bg-accent text-foreground` (tonal shift, not electric blue). The tertiary accent is reserved for primary action buttons and focus rings only.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Cypress 15.12.0 |
| Config file | `cypress.config.ts` |
| Quick run command | `npx cypress run --spec cypress/e2e/dashboard.cy.ts` |
| Full suite command | `npx cypress run` |

### Phase Requirements → Test Map

Since Phase 9 has no formal REQ-IDs yet (TBD in requirements), the behaviors map to pages:

| Page | Behavior | Test Type | Automated Command | File Exists? |
|------|----------|-----------|-------------------|-------------|
| Dashboard | KPI cards render with correct typography | visual/render | `npx cypress run --spec cypress/e2e/dashboard.cy.ts` | ✅ |
| Customers | Table renders with monospaced amounts, correct surface | visual/render | `npx cypress run --spec cypress/e2e/customer-crud.cy.ts` | ✅ |
| Loans | Table renders with font-mono on financial values | visual/render | `npx cypress run --spec cypress/e2e/loans-list.cy.ts` | ✅ |
| Payments | Tabs, filter bar, amounts use correct typography | visual/render | `npx cypress run --spec cypress/e2e/payments-list.cy.ts` | ✅ |
| Sidebar | No visible border-r, correct surface color | render | `npx cypress run --spec cypress/e2e/dashboard.cy.ts` | ✅ |
| Design token smoke | Key CSS custom properties have correct values | unit/render | new: `cypress/e2e/design-system.cy.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx cypress run --spec cypress/e2e/dashboard.cy.ts` (fast, high signal)
- **Per wave merge:** `npx cypress run` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `cypress/e2e/design-system.cy.ts` — design token smoke test verifying key CSS custom properties are set correctly, font-mono is applied to numeric elements, and no 1px solid borders appear on section separators

---

## Sources

### Primary (HIGH confidence)

- `DESIGN.md` (project root) — Full Sovereign Ledger specification; all design decisions, color tokens, typography, component rules
- `src/app/globals.css` — Current token layer; verified Tailwind v4 `@theme inline` structure
- `src/components/ui/button.tsx`, `card.tsx`, `badge.tsx`, `input.tsx` — Current component implementations; verified cva/base-ui patterns
- `src/components/layout/sidebar.tsx`, `app-shell.tsx`, `top-bar.tsx` — Current layout structure
- `package.json` — Verified stack: tailwindcss ^4, @base-ui/react ^1.3.0, next 16.2.0, react 19.2.4

### Secondary (MEDIUM confidence)

- Tailwind v4 CSS variable pattern — verified via `globals.css` `@theme inline` which matches the Tailwind v4 docs approach of pure-CSS configuration

### Tertiary (LOW confidence)

- OKLCH hex-to-OKLCH conversion estimates for DESIGN.md colors — converted manually; should be verified in-browser with DevTools color picker before committing

---

## Metadata

**Confidence breakdown:**
- Design spec interpretation: HIGH — DESIGN.md is complete and unambiguous
- Standard stack: HIGH — verified directly from package.json and existing source files
- Token mapping (hex→OKLCH): MEDIUM — estimates; verify in browser
- Architecture (wave order, file inventory): HIGH — derived from full directory scan
- Pitfalls: HIGH — based on direct code inspection of existing patterns

**Research date:** 2026-03-23
**Valid until:** 2026-06-23 (stable toolchain; no fast-moving dependencies)
