---
phase: 09-design-system-overhaul
plan: 02
subsystem: ui
tags: [tailwindcss, shadcn, glassmorphism, design-system, sovereign-ledger, cva, base-ui]

# Dependency graph
requires:
  - phase: 09-01
    provides: CSS token variables (--ring Electric Blue, --radius 0.5rem, --border, --primary) in globals.css

provides:
  - Card component with no ring, rounded-lg corners, cascades to all Card consumers
  - Button with tertiary variant (Electric Blue text) and rounded-sm base
  - Badge with rounded-sm (sharp financial terminal aesthetic)
  - Input with rounded-md and Electric Blue focus ring via --ring token
  - Table with ghost border rows (border-border/15) and label typography headers
  - Dialog with glassmorphism overlay (backdrop-blur-[24px]) and bg-white/85 content
  - Sheet with glassmorphism overlay and bg-white/85 content, no shadow, no side borders
  - Icon-only close buttons with aria-label="Close" for accessibility
  - Card ring removal test enabled in design-system.cy.ts

affects:
  - 09-03 (sidebar/top-bar plan — all UI primitives now styled)
  - 09-04 (typography plan — tables now use label typography already)
  - All app pages using Card, Button, Badge, Input, Table, Dialog, Sheet

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ghost border pattern: border-b border-border/15 for data tables"
    - "Glassmorphism pattern: bg-black/10 + supports-backdrop-filter:backdrop-blur-[24px] for overlays"
    - "Glass content pattern: bg-white/85 for floating content panels"
    - "Tertiary button: text-[oklch(0.35_0.2_264)] bg-transparent for Electric Blue accent actions"

key-files:
  created: []
  modified:
    - src/components/ui/card.tsx
    - src/components/ui/button.tsx
    - src/components/ui/badge.tsx
    - src/components/ui/input.tsx
    - src/components/ui/table.tsx
    - src/components/ui/dialog.tsx
    - src/components/ui/sheet.tsx
    - cypress/e2e/design-system.cy.ts

key-decisions:
  - "Card uses rounded-lg (not rounded-xl) — 0.5rem is max allowed radius per Sovereign Ledger spec"
  - "Dialog/Sheet content uses bg-white/85 (not bg-background) — glassmorphism requires semi-transparent white"
  - "Sheet removes all side border classes (border-t, border-b, border-l, border-r) per No-Line rule"
  - "TableHead drops font-medium/text-foreground, uses text-xs/font-semibold/uppercase/tracking-wider/text-muted-foreground — label typography spec"

patterns-established:
  - "Glassmorphism floating panels: overlay = bg-black/10 + supports-backdrop-filter:backdrop-blur-[24px]; content = bg-white/85"
  - "Ghost border tables: TableRow border-b border-border/15, TableHeader [&_tr]:border-b [&_tr]:border-border/15"
  - "Label typography for table headers: text-xs font-semibold uppercase tracking-wider text-muted-foreground"

requirements-completed: [DS-04, DS-05, DS-06]

# Metrics
duration: 4min
completed: 2026-03-23
---

# Phase 09 Plan 02: Primitive UI Components Summary

**7 shadcn/base-ui primitive components restyled to Sovereign Ledger spec — sharp corners, ghost borders on tables, glassmorphism on dialogs/sheets, tertiary button variant, no rings on cards**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-23T18:26:31Z
- **Completed:** 2026-03-23T18:30:45Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Card stripped of `ring-1 ring-foreground/10` and all `rounded-xl` changed to `rounded-lg` — cascades tonal depth to all card consumers
- Button gains `tertiary` variant with Electric Blue text (`oklch(0.35_0.2_264)`) and base changes from `rounded-lg` to `rounded-sm` for financial terminal precision
- Table rows now use `border-border/15` ghost borders and headers use label typography (uppercase, tracking-wider, semibold, muted-foreground)
- Dialog and Sheet overlays upgraded from `backdrop-blur-xs` to `backdrop-blur-[24px]` glassmorphism; content panels use `bg-white/85`
- Sheet side borders (`border-t/b/l/r`) removed per No-Line rule; `shadow-lg` removed per no-drop-shadows rule
- Close buttons on Dialog and Sheet now have `aria-label="Close"` for icon-only button accessibility
- Card ring removal test in `design-system.cy.ts` enabled (changed from `it.skip` to `it`) and passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Restyle Card, Button, Badge, Input primitives** - `49e60a9` (feat)
2. **Task 2: Restyle Table, Dialog, Sheet + enable card ring test** - `a844238` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `src/components/ui/card.tsx` - Removed ring-1, changed rounded-xl to rounded-lg throughout
- `src/components/ui/button.tsx` - Changed base rounded-lg to rounded-sm, added tertiary variant
- `src/components/ui/badge.tsx` - Changed rounded-4xl to rounded-sm
- `src/components/ui/input.tsx` - Changed rounded-lg to rounded-md
- `src/components/ui/table.tsx` - Ghost border rows, label typography headers, ghost border on TableHeader
- `src/components/ui/dialog.tsx` - backdrop-blur-[24px] overlay, bg-white/85 content, rounded-lg, no ring, aria-label on close
- `src/components/ui/sheet.tsx` - backdrop-blur-[24px] overlay, bg-white/85 content, no shadow, no side borders, aria-label on close
- `cypress/e2e/design-system.cy.ts` - Enabled card ring removal test (it.skip -> it)

## Decisions Made

- Card uses `rounded-lg` (not `rounded-xl`) — 0.5rem is the maximum allowed radius per Sovereign Ledger spec
- Dialog/Sheet content uses `bg-white/85` instead of `bg-background` — glassmorphism requires a semi-transparent white for the frosted glass effect
- Sheet removes all side border classes per the No-Line rule (no 1px solid borders for sectioning)
- `TableHead` drops `font-medium` and `text-foreground`, replaces with `text-xs font-semibold uppercase tracking-wider text-muted-foreground` per label typography spec
- Input uses `rounded-md` (midpoint between `rounded-sm` button and `rounded-lg` card) — slightly softer than button per plan spec

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. All Cypress tests passed on first run.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 7 primitive components match Sovereign Ledger spec
- Design changes cascade automatically to all page consumers (no page-level changes required)
- Plan 03 (sidebar/top-bar border removal) can now proceed
- Design system smoke tests: 10/13 passing (3 pending for Plans 03 and 04 — expected)

---
*Phase: 09-design-system-overhaul*
*Completed: 2026-03-23*
