# Codebase Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve codebase clarity and extensibility by splitting monolithic services, extracting shared patterns, removing dead code, and adding missing test coverage.

**Architecture:** Split transaction.service.ts (1,374 lines, 30+ exports) into focused modules. Extract duplicated URL filter/debounce logic into a shared hook. Extract shared report toolbar component. Remove unused dependencies.

**Tech Stack:** Next.js, Drizzle ORM, Effect-TS, TanStack Query, Vitest, Zustand

**Pre-existing state:** 69 tests currently fail (engine.test.ts, creditor, dashboard, etc.) — these are pre-existing and not part of this refactor. Baseline: 380 passing, 69 failing.

---

## Task 1: Remove Unused Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove node-cron, tw-animate-css, and msw**

```bash
pnpm remove node-cron tw-animate-css msw
```

- [ ] **Step 2: Remove MSW handler file**

Delete `src/lib/msw/handlers.ts` (exports empty array, unused).
Delete `src/lib/msw/` directory if empty after.

- [ ] **Step 3: Remove tw-animate-css import from globals.css**

In `src/app/globals.css`, remove the `@import "tw-animate-css"` line if present.

- [ ] **Step 4: Verify build still works**

```bash
pnpm build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: remove unused dependencies (node-cron, tw-animate-css, msw)"
```

---

## Task 2: Split transaction.service.ts — Add Tests for Ledger Query Functions

Before splitting, we need tests covering the ledger query functions that will move to a new module.

**Files:**
- Create: `src/services/__tests__/ledger-queries.test.ts`
- Read: `src/services/transaction.service.ts` (lines 556-957)

- [ ] **Step 1: Write tests for getLoanBalancesFromLedger**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    execute: vi.fn(),
  },
}))

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm")
  return { ...actual, sql: vi.fn().mockReturnValue("mock-sql") }
})

describe("Ledger Query Functions", () => {
  let mockedDb: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const dbMod = await import("@/lib/db")
    mockedDb = dbMod.db as any
  })

  describe("getLoanBalancesFromLedger", () => {
    it("returns empty map when no loan IDs provided", async () => {
      const { getLoanBalancesFromLedger } = await import("@/services/transaction.service")
      const result = await getLoanBalancesFromLedger([])
      expect(result).toEqual(new Map())
    })

    it("queries ledger and returns balance map for given loan IDs", async () => {
      mockedDb.execute = vi.fn().mockResolvedValue([
        { loanId: "loan-1", balance: "500000" },
        { loanId: "loan-2", balance: "300000" },
      ])
      const { getLoanBalancesFromLedger } = await import("@/services/transaction.service")
      const result = await getLoanBalancesFromLedger(["loan-1", "loan-2"])
      expect(result.get("loan-1")).toBe("500000")
      expect(result.get("loan-2")).toBe("300000")
    })
  })

  describe("getLoanBalanceFromLedger", () => {
    it("returns balance string for single loan", async () => {
      mockedDb.execute = vi.fn().mockResolvedValue([
        { loanId: "loan-1", balance: "500000" },
      ])
      const { getLoanBalanceFromLedger } = await import("@/services/transaction.service")
      const result = await getLoanBalanceFromLedger("loan-1")
      expect(typeof result).toBe("string")
    })
  })

  describe("getInterestEarnedFromLedger", () => {
    it("returns empty map when no loan IDs provided", async () => {
      const { getInterestEarnedFromLedger } = await import("@/services/transaction.service")
      const result = await getInterestEarnedFromLedger([])
      expect(result).toEqual(new Map())
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npx vitest run src/services/__tests__/ledger-queries.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/services/__tests__/ledger-queries.test.ts
git commit -m "test: add unit tests for ledger query functions before splitting transaction.service"
```

---

## Task 3: Split transaction.service.ts into Focused Modules

**Files:**
- Create: `src/services/ledger-queries.service.ts` (read-side: all get*FromLedger functions)
- Create: `src/services/auto-post.service.ts` (write-side: all autoPost* functions)
- Modify: `src/services/transaction.service.ts` (keep: postJournalEntry, recordExpense, recordIncome, listTransactions, getTransactionById, deleteTransaction, accrueInterest*, reverseInterest*)
- Modify: all files that import the moved functions

- [ ] **Step 1: Create ledger-queries.service.ts**

Move these functions from transaction.service.ts to a new file:
- `getLoanBalancesFromLedger`
- `getLoanBalanceFromLedger`
- `getInterestEarnedFromLedger`
- `getInterestPayableFromLedger`
- `getCreditorBalancesFromLedger`
- `getPaymentPortionsFromLedger`
- `getCreditorRepaymentPortionsFromLedger`
- `getCreditorTotalInvestedFromLedger`
- `getCreditorTotalRepaidFromLedger`

The new file imports `db`, `sql`, `transactions`, `transactionCategories`, `and`, `eq`, `inArray`, `BigNumber` — only what it needs. Each function keeps its exact signature and implementation.

- [ ] **Step 2: Create auto-post.service.ts**

Move these functions:
- `autoPostInterestEarned`
- `autoPostInterestExpense`
- `autoPostPrincipalDisbursement`
- `autoPostRolloverPrincipalTransfer`
- `autoPostPrincipalRepayment`
- `autoPostPrincipalRecovery`
- `autoPostCreditorInvestment`
- `autoPostCreditorPrincipalRepaid`
- `autoPostRateChangeAdjustment`
- `autoPostFundTransfer`
- `autoPostCapitalInjection`

Import `postJournalEntry` from `./transaction.service` (the original file keeps this).

- [ ] **Step 3: Update transaction.service.ts**

Remove the moved functions. Add re-exports for backward compatibility:

```typescript
// Re-export for backward compatibility
export {
  getLoanBalancesFromLedger,
  getLoanBalanceFromLedger,
  getInterestEarnedFromLedger,
  getInterestPayableFromLedger,
  getCreditorBalancesFromLedger,
  getPaymentPortionsFromLedger,
  getCreditorRepaymentPortionsFromLedger,
  getCreditorTotalInvestedFromLedger,
  getCreditorTotalRepaidFromLedger,
} from "./ledger-queries.service"

export {
  autoPostInterestEarned,
  autoPostInterestExpense,
  autoPostPrincipalDisbursement,
  autoPostRolloverPrincipalTransfer,
  autoPostPrincipalRepayment,
  autoPostPrincipalRecovery,
  autoPostCreditorInvestment,
  autoPostCreditorPrincipalRepaid,
  autoPostRateChangeAdjustment,
  autoPostFundTransfer,
  autoPostCapitalInjection,
} from "./auto-post.service"
```

- [ ] **Step 4: Update direct imports across the codebase**

Find all files importing from `transaction.service` and update imports to point to the specific module where appropriate. The re-exports ensure nothing breaks immediately, but direct imports are cleaner.

Key files to update:
- `src/services/loan.service.ts` — uses autoPost* and getLoan* functions
- `src/services/payment.service.ts` — uses autoPost* and getLoan* functions
- `src/services/creditor.service.ts` — uses autoPost* and getCreditor* functions
- `src/services/dashboard.service.ts` — uses getLoan* and getInterest* functions
- `src/services/report.service.ts` — uses getLoan* and getInterest* functions
- `src/actions/*.ts` — various imports

- [ ] **Step 5: Run all tests**

```bash
npx vitest run
```

Verify same 380 passing / 69 failing as baseline.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: split transaction.service into ledger-queries and auto-post modules"
```

---

## Task 4: Extract useUrlFilters Hook

**Files:**
- Create: `src/hooks/use-url-filters.ts`
- Create: `src/hooks/__tests__/use-url-filters.test.ts`
- Modify: `src/app/(app)/payments/PaymentsClient.tsx`
- Modify: `src/app/(app)/transactions/TransactionLogClient.tsx`

- [ ] **Step 1: Write the hook test**

```typescript
import { describe, it, expect, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"

// Mock next/navigation
const mockPush = vi.fn()
const mockSearchParams = new URLSearchParams()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}))

describe("useUrlFilters", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("initializes filter values from URL search params", async () => {
    // Will test after implementation
  })

  it("debounces URL updates by 300ms", async () => {
    // Will test after implementation
  })

  it("resets page param on filter change", async () => {
    // Will test after implementation
  })
})
```

- [ ] **Step 2: Write the hook**

```typescript
"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"

interface UseUrlFiltersConfig<T extends Record<string, string>> {
  basePath: string
  defaults: T
  debounceMs?: number
}

export function useUrlFilters<T extends Record<string, string>>({
  basePath,
  defaults,
  debounceMs = 300,
}: UseUrlFiltersConfig<T>) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Initialize from URL
  const initial = useMemo(() => {
    const result = { ...defaults }
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const val = searchParams.get(key as string)
      if (val) (result as any)[key] = val
    }
    return result
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [filters, setFiltersState] = useState<T>(initial)

  const page = Math.max(1, Number(searchParams.get("page")) || 1)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [])

  const syncToUrl = useCallback(
    (updated: T) => {
      const params = new URLSearchParams()
      for (const [key, val] of Object.entries(updated)) {
        if (val) params.set(key, val)
      }
      params.delete("page")
      const qs = params.toString()
      router.push(qs ? `${basePath}?${qs}` : basePath)
    },
    [router, basePath]
  )

  const setFilter = useCallback(
    (key: keyof T, value: string) => {
      setFiltersState((prev) => {
        const next = { ...prev, [key]: value }
        if (debounceTimer.current) clearTimeout(debounceTimer.current)
        debounceTimer.current = setTimeout(() => syncToUrl(next), debounceMs)
        return next
      })
    },
    [syncToUrl, debounceMs]
  )

  const clearFilters = useCallback(() => {
    setFiltersState(defaults)
    router.push(basePath)
  }, [defaults, router, basePath])

  const setPage = useCallback(
    (newPage: number) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("page", String(newPage))
      router.push(`${basePath}?${params.toString()}`)
    },
    [router, searchParams, basePath]
  )

  const hasFilters = Object.entries(filters).some(
    ([key, val]) => val !== (defaults as any)[key]
  )

  const activeFilterCount = Object.entries(filters).filter(
    ([key, val]) => val !== (defaults as any)[key]
  ).length

  return {
    filters,
    page,
    setFilter,
    clearFilters,
    setPage,
    hasFilters,
    activeFilterCount,
  }
}
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/hooks/__tests__/use-url-filters.test.ts
```

- [ ] **Step 4: Refactor PaymentsClient to use useUrlFilters**

Replace the manual debounce/URL sync code (lines 95-221) with:

```typescript
const { filters, page, setFilter, clearFilters, setPage, hasFilters, activeFilterCount } =
  useUrlFilters({
    basePath: "/payments",
    defaults: { customerName: "", dateFrom: "", dateTo: "", amountMin: "", amountMax: "" },
  })
const { customerName, dateFrom, dateTo, amountMin, amountMax } = filters
```

Remove from PaymentsClient:
- The `usePaymentsPageStore()` filter-related destructuring (keep dialog state)
- The `useEffect` for `initFilters`
- The `debounceTimer` ref
- The `syncFiltersToUrl` callback
- The `handleFilterChange` function
- The `handleClearFilters` function
- The `handlePageChange` function
- The `hasFilters` and `activeFilterCount` calculations

Replace filter change handlers in JSX with `(value) => setFilter("customerName", value)` etc.

- [ ] **Step 5: Refactor TransactionLogClient to use useUrlFilters**

Replace the manual debounce/URL sync code (lines 54-116) with:

```typescript
const { filters, page, setFilter, clearFilters, hasFilters } = useUrlFilters({
  basePath: "/transactions",
  defaults: { type: "all", categoryId: "all", dateFrom: "", dateTo: "" },
})
```

Remove the local `useState` for each filter, `debounceTimer` ref, `applyFilters`, `scheduleApply`, cleanup `useEffect`.

- [ ] **Step 6: Run full tests**

```bash
npx vitest run
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: extract useUrlFilters hook to replace duplicated URL sync pattern"
```

---

## Task 5: Extract ReportToolbar Component

**Files:**
- Create: `src/components/reports/report-toolbar.tsx`
- Modify: `src/app/(app)/reports/balance-sheet/BalanceSheetClient.tsx`
- Modify: `src/app/(app)/reports/pnl/PnlClient.tsx`
- Modify: `src/app/(app)/reports/retained-earnings/RetainedEarningsClient.tsx`
- Modify: `src/app/(app)/reports/portfolio/PortfolioClient.tsx`

- [ ] **Step 1: Create the ReportToolbar component**

```typescript
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2 } from "lucide-react"
import { getMonthOptions } from "@/lib/utils"
import { downloadFromUrl } from "@/lib/download"
import { toast } from "sonner"

interface ReportToolbarProps {
  period: string
  basePath: string
  exportFormats?: ("pdf" | "excel")[]
  /** Build the export URL. Receives format and period. */
  exportHref?: (format: "pdf" | "excel", period: string) => string
  /** Build the export filename. Receives format and period. */
  exportFilename?: (format: "pdf" | "excel", period: string) => string
}

export function ReportToolbar({
  period,
  basePath,
  exportFormats = ["pdf", "excel"],
  exportHref,
  exportFilename,
}: ReportToolbarProps) {
  const router = useRouter()
  const monthOptions = getMonthOptions()
  const [downloading, setDownloading] = useState<string | null>(null)

  function handlePeriodChange(value: string | null) {
    if (value !== null) {
      router.push(`${basePath}?period=${value}`)
    }
  }

  async function handleDownload(format: "pdf" | "excel") {
    if (downloading) return
    if (!exportHref || !exportFilename) return
    setDownloading(format)
    try {
      await downloadFromUrl(exportHref(format, period), exportFilename(format, period))
    } catch {
      toast.error("Export failed. Please try again.")
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={period} onValueChange={handlePeriodChange}>
        <SelectTrigger className="w-48">
          <SelectValue placeholder="Select period" />
        </SelectTrigger>
        <SelectContent>
          {monthOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {exportFormats.map((format) => (
        <Button
          key={format}
          variant="outline"
          size="sm"
          onClick={() => handleDownload(format)}
          disabled={downloading !== null}
        >
          {downloading === format && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {downloading === format ? "Exporting..." : `Export ${format.toUpperCase()}`}
        </Button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Refactor BalanceSheetClient to use ReportToolbar**

Replace lines 29-52 (period change + download logic) and lines 67-89 (toolbar JSX) with:

```tsx
<ReportToolbar
  period={period}
  basePath="/reports/balance-sheet"
  exportHref={(fmt, p) => `/api/reports/balance-sheet?format=${fmt}&period=${p}`}
  exportFilename={(fmt, p) => `balance-sheet-${p}.${fmt === "pdf" ? "pdf" : "xlsx"}`}
/>
```

Remove unused imports: `useState` (if only used for downloading), `useRouter`, `Button`, `Select*`, `downloadFromUrl`, `toast`.

- [ ] **Step 3: Refactor PnlClient to use ReportToolbar**

Same pattern — replace toolbar + download logic.

- [ ] **Step 4: Refactor RetainedEarningsClient to use ReportToolbar**

This one has no export buttons, so:
```tsx
<ReportToolbar period={period} basePath="/reports/retained-earnings" exportFormats={[]} />
```

- [ ] **Step 5: Refactor PortfolioClient to use ReportToolbar**

Portfolio passes explicit hrefs as props, so adapt to:
```tsx
<ReportToolbar
  period=""
  basePath="/reports/portfolio"
  exportHref={(fmt) => fmt === "pdf" ? exportPdfHref : exportExcelHref}
  exportFilename={(fmt) => `portfolio-report.${fmt === "pdf" ? "pdf" : "xlsx"}`}
/>
```

Note: Portfolio doesn't use period selector — it may need a slightly different approach. If it has no period, skip the period selector or add a `showPeriodSelector={false}` prop.

- [ ] **Step 6: Run build to verify**

```bash
pnpm build 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: extract ReportToolbar component from 4 report pages"
```

---

## Task 6: Add Missing Tests for Untested Services

**Files:**
- Create: `src/services/__tests__/fund-transfer.service.test.ts`
- Create: `src/services/__tests__/rate-change-request.service.test.ts`
- Create: `src/services/__tests__/collateral-settlement.service.test.ts`

- [ ] **Step 1: Write fund-transfer.service unit tests**

Read `src/services/fund-transfer.service.ts` to understand exports, then write mocked unit tests for each exported function covering:
- Happy path
- Error cases (missing data, invalid input)

- [ ] **Step 2: Write rate-change-request.service unit tests**

Read `src/services/rate-change-request.service.ts` to understand exports, then write mocked unit tests.

- [ ] **Step 3: Write collateral-settlement.service unit tests**

Read `src/services/collateral-settlement.service.ts` to understand exports, then write mocked unit tests.

- [ ] **Step 4: Run all new tests**

```bash
npx vitest run src/services/__tests__/fund-transfer.service.test.ts src/services/__tests__/rate-change-request.service.test.ts src/services/__tests__/collateral-settlement.service.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: add unit tests for fund-transfer, rate-change-request, and collateral-settlement services"
```

---

## Task 7: Consolidate Page-Level Actions into Central Location

**Files:**
- Modify: `src/app/(app)/creditors/actions.ts` → move to `src/actions/creditor.actions.ts`
- Modify: `src/app/(app)/expenses/actions.ts` → move to `src/actions/expense.actions.ts`
- Modify: `src/app/(app)/income/actions.ts` → move to `src/actions/income.actions.ts`
- Update: all files that import from the old locations

- [ ] **Step 1: Move creditor page actions**

Read `src/app/(app)/creditors/actions.ts`. If functions already exist in `src/actions/creditor.actions.ts`, merge them. Otherwise, move the file contents to the central location.

Update all imports in `src/app/(app)/creditors/` to use `@/actions/creditor.actions`.

- [ ] **Step 2: Move expense page actions**

Move `src/app/(app)/expenses/actions.ts` to `src/actions/expense.actions.ts`.
Update imports.

- [ ] **Step 3: Move income page actions**

Move `src/app/(app)/income/actions.ts` to `src/actions/income.actions.ts`.
Update imports.

- [ ] **Step 4: Delete old action files**

```bash
rm src/app/\(app\)/creditors/actions.ts src/app/\(app\)/expenses/actions.ts src/app/\(app\)/income/actions.ts
```

- [ ] **Step 5: Run build to verify**

```bash
pnpm build 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: consolidate page-level actions into central /actions directory"
```

---

## Task 8: Use ResponsiveTable in TransactionLogClient

**Files:**
- Modify: `src/app/(app)/transactions/TransactionLogClient.tsx`

- [ ] **Step 1: Replace raw Table with ResponsiveTable**

Replace the `<Table>` / `<TableHeader>` / `<TableBody>` / `<TableRow>` / `<TableCell>` usage with `<ResponsiveTable>` component, defining columns using the `Column<TransactionRow>[]` pattern used across the rest of the app.

- [ ] **Step 2: Verify build**

```bash
pnpm build 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: use ResponsiveTable in TransactionLogClient for mobile consistency"
```
