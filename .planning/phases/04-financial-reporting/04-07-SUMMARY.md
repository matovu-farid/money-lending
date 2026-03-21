---
phase: 04-financial-reporting
plan: "07"
subsystem: reports-ui-export
tags: [reports, pdf, excel, export, portfolio, pnl, balance-sheet]
dependency_graph:
  requires: ["04-06"]
  provides: ["reports-hub", "report-pages", "export-services", "export-routes"]
  affects: ["src/app/(app)/reports/", "src/services/export/", "src/app/api/reports/"]
tech_stack:
  added:
    - jspdf@4.2.1 (PDF generation)
    - jspdf-autotable@5.0.7 (table rendering in PDFs)
    - exceljs@4.4.0 (Excel generation)
  patterns:
    - Server Component fetches data → passes to Client island
    - Route Handler streams binary response with Content-Disposition
    - autoTable v5 hook pattern for row styling (didParseCell)
    - Uint8Array wrapping Buffer for Web API Response body compatibility
key_files:
  created:
    - src/app/(app)/reports/page.tsx
    - src/app/(app)/reports/portfolio/page.tsx
    - src/app/(app)/reports/portfolio/PortfolioClient.tsx
    - src/app/(app)/reports/pnl/page.tsx
    - src/app/(app)/reports/pnl/PnlClient.tsx
    - src/app/(app)/reports/balance-sheet/page.tsx
    - src/app/(app)/reports/balance-sheet/BalanceSheetClient.tsx
    - src/services/export/pdf.service.ts
    - src/services/export/excel.service.ts
    - src/app/api/reports/portfolio/route.ts
    - src/app/api/reports/pnl/route.ts
    - src/app/api/reports/balance-sheet/route.ts
    - src/app/api/reports/transactions/route.ts
  modified: []
decisions:
  - "Buffer from pdf.service/excel.service wrapped as Uint8Array for Response body — Node Buffer is not assignable to Web API BodyInit"
  - "buttonVariants with Link used for report hub cards — base-ui Button has no asChild prop per Phase 1 pattern"
  - "eslint-disable comment used instead of @ts-expect-error for lastAutoTable access — autoTable v5 extends jsPDF at runtime, TypeScript correctly allows (doc as any).lastAutoTable"
metrics:
  duration: 15
  completed_date: "2026-03-21"
  tasks_completed: 2
  files_created: 13
  files_modified: 0
---

# Phase 04 Plan 07: Report UI Pages and Export Services Summary

Reports hub, 3 report pages with period pickers, PDF service (jsPDF v4 + autoTable), Excel service (ExcelJS with styling), and 4 export Route Handlers covering all report types.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Report UI pages — hub, portfolio, P&L, balance sheet | ba3858f | 7 files |
| 2 | PDF and Excel export services with Route Handlers | d6228f8 | 6 files |

## What Was Built

### Report Hub (`/reports`)
4-card grid linking to portfolio, P&L, balance-sheet, and transactions pages. Uses `buttonVariants` with `Link` per base-ui pattern.

### Loan Portfolio Report (`/reports/portfolio`)
Server Component fetches `getPortfolioData()` and passes to `PortfolioClient`. Table shows customer name, loan amount, outstanding balance, interest accrued, days overdue, status badge, and risk badge (red "At Risk" for loans >= 30 days overdue).

### P&L Report (`/reports/pnl`)
Server Component with `searchParams.period` (defaults to last completed month). `PnlClient` has period picker (12 months), income table with Total Income subtotal, expense table with Total Expenses subtotal, and Net Profit row (green/red based on sign). Export buttons trigger fetch-and-download.

### Balance Sheet Report (`/reports/balance-sheet`)
Same period picker pattern. `BalanceSheetClient` shows Assets (total loans), Liabilities (creditor balances), Equity (share capital + retained earnings), and Total Liabilities + Equity summary row.

### PDF Service (`src/services/export/pdf.service.ts`)
- Branded header: "Money Lending Management" (bold 16pt), report title (12pt), period (10pt), generated date (8pt muted), horizontal rule
- `generatePortfolioPdf`: landscape, 7-column autoTable with alternating rows
- `generatePnlPdf`: portrait, income table + expense table + bold net profit row
- `generateBalanceSheetPdf`: portrait, three sections + total L+E row
- `generateTransactionsPdf`: landscape, 6-column audit trail table

### Excel Service (`src/services/export/excel.service.ts`)
- Header rows: fill `#1F2937` (FF1F2937), white bold 12pt
- Data rows: alternating white/`#F9FAFB`
- Thin borders `#E5E7EB` on all cells
- UGX number format `"UGX "#,##0.00`
- Freeze pane row 1, auto-filter where applicable
- All functions async — `await workbook.xlsx.writeBuffer()`

### Route Handlers
All 4 handlers follow the same pattern: parse `format` and optional `period` params, call report service, dispatch to PDF or Excel generator, return `new Response(new Uint8Array(buffer), {...})` with Content-Disposition attachment header.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Buffer → Uint8Array for Web API Response**
- **Found during:** Task 2 TypeScript check
- **Issue:** `Buffer<ArrayBufferLike>` is not assignable to `BodyInit` — Node's `Buffer` is not a valid Web API `Response` body type in this TypeScript environment
- **Fix:** Wrapped all buffer responses with `new Uint8Array(buffer)` before passing to `new Response()`
- **Files modified:** All 4 route handlers
- **Commit:** d6228f8

**2. [Rule 1 - Bug] Unused @ts-expect-error directives in pdf.service.ts**
- **Found during:** Task 2 TypeScript check
- **Issue:** TypeScript flagged `@ts-expect-error` directives as unused because `(doc as any).lastAutoTable` is already allowed (autoTable v5 types `jsPDFDocument` as `any`)
- **Fix:** Replaced with `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comment
- **Files modified:** src/services/export/pdf.service.ts
- **Commit:** d6228f8

**3. [Rule 2 - Pattern] Used buttonVariants + Link instead of Button asChild**
- **Found during:** Task 1
- **Issue:** base-ui `Button` component has no `asChild` prop per Phase 1 decision
- **Fix:** Used `buttonVariants({ variant: "outline", size: "sm" })` className on `<Link>` per established pattern
- **Files modified:** src/app/(app)/reports/page.tsx
- **Commit:** ba3858f

## Self-Check: PASSED

Files created:
- src/app/(app)/reports/page.tsx — FOUND
- src/app/(app)/reports/portfolio/page.tsx — FOUND
- src/app/(app)/reports/portfolio/PortfolioClient.tsx — FOUND
- src/app/(app)/reports/pnl/page.tsx — FOUND
- src/app/(app)/reports/pnl/PnlClient.tsx — FOUND
- src/app/(app)/reports/balance-sheet/page.tsx — FOUND
- src/app/(app)/reports/balance-sheet/BalanceSheetClient.tsx — FOUND
- src/services/export/pdf.service.ts — FOUND
- src/services/export/excel.service.ts — FOUND
- src/app/api/reports/portfolio/route.ts — FOUND
- src/app/api/reports/pnl/route.ts — FOUND
- src/app/api/reports/balance-sheet/route.ts — FOUND
- src/app/api/reports/transactions/route.ts — FOUND

Commits verified:
- ba3858f (Task 1) — FOUND
- d6228f8 (Task 2) — FOUND

TypeScript: npx tsc --noEmit — PASSED (0 errors)
Tests: pnpm test — PASSED (64/64)
