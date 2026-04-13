# Creditor Monthly Payment Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins visibility into monthly creditor obligations — a "Monthly Interest Due" column on the creditors list and a month-by-month summary tab on each creditor's profile.

**Architecture:** Two new service functions derive data from existing ledger entries (no new writes). The creditors list page enriches its table with per-creditor interest due. The creditor profile adds a "Monthly Summary" tab computing a running ledger of interest due, payments made, and remaining balance per month. Also fixes the default interest rate (10% → 3%) and adds a back button on the new creditor form.

**Tech Stack:** Next.js, Drizzle ORM, Effect, BigNumber.js, TanStack React Query, shadcn/ui, Tailwind CSS

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/types/creditor.ts` | Modify | Add `MonthlySummaryRow` type |
| `src/services/creditor.service.ts` | Modify | Add `getCreditorMonthlyInterestDue()` and `getCreditorMonthlySummary()` |
| `src/actions/creditor.actions.ts` | Modify | Expose new service functions as server actions |
| `src/hooks/query-keys.ts` | Modify | Add `monthlySummary` query key |
| `src/app/(app)/creditors/page.tsx` | Modify | Fetch monthly interest due, pass to table |
| `src/app/(app)/creditors/creditors-table.tsx` | Modify | Add "Monthly Interest Due" column |
| `src/app/(app)/creditors/[id]/page.tsx` | Modify | Fetch monthly summary, pass to client |
| `src/app/(app)/creditors/[id]/CreditorProfileClient.tsx` | Modify | Add "Monthly Summary" tab |
| `src/app/(app)/creditors/new/page.tsx` | Modify | Fix default rate, add back button |

---

### Task 1: Fix Default Interest Rate and Add Back Button

**Files:**
- Modify: `src/app/(app)/creditors/new/page.tsx`

- [ ] **Step 1: Change default interest rate from 10 to 3**

In `src/app/(app)/creditors/new/page.tsx`, change line 50:

```tsx
// Before:
interestRateMonthly: "10",

// After:
interestRateMonthly: "3",
```

- [ ] **Step 2: Add back button and remove bottom Cancel link**

At the top of the page (inside the return, before `PageHeader`), add a back link. Remove the Cancel `<Link>` from the bottom button group.

Replace the full return block starting at the `<div className="p-4 md:p-6 max-w-lg">` with:

```tsx
return (
    <div className="p-4 md:p-6 max-w-lg">
      <Link
        href="/creditors"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Creditors
      </Link>

      <PageHeader
        title="Add Creditor"
        subtitle="Register a new creditor and record their initial investment."
        className="mb-6"
      />

      <div className="space-y-6">
        {/* ... Card sections remain unchanged ... */}

        <div className="flex gap-3">
          <Button type="submit" form="creditor-form" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="animate-spin mr-2 h-4 w-4" />
                Registering...
              </>
            ) : (
              "Register Creditor"
            )}
          </Button>
        </div>
      </div>
    </div>
  )
```

Add `ArrowLeft` to the lucide-react import:

```tsx
import { Loader2, ArrowLeft } from "lucide-react"
```

Remove the `buttonVariants` import and the `cn` import if no longer used (check — `cn` is used for `todayDateString` import line so keep the import but remove `cn` from it if unused). Actually `cn` is imported alongside `todayDateString` — remove `cn` from that import since it's only used for the Cancel link's className:

```tsx
// Before:
import { cn, todayDateString } from "@/lib/utils"

// After:
import { todayDateString } from "@/lib/utils"
```

Remove the unused `buttonVariants` import:

```tsx
// Remove this from the Button import:
import { Button, buttonVariants } from "@/components/ui/button"

// Keep only:
import { Button } from "@/components/ui/button"
```

Remove the unused `Link` import? No — we still use `Link` for the back button. Keep it.

- [ ] **Step 3: Verify the page renders**

Run: `npx next build --no-lint 2>&1 | head -30` or check the dev server for `/creditors/new`.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/creditors/new/page.tsx
git commit -m "fix: change default creditor interest rate to 3% and add back button"
```

---

### Task 2: Add Types for Monthly Summary and Enriched Creditor

**Files:**
- Modify: `src/types/creditor.ts`

- [ ] **Step 1: Add new types**

Append to `src/types/creditor.ts`:

```typescript
export interface MonthlySummaryRow {
  /** Format: "YYYY-MM" */
  month: string
  /** Interest due for this month (principal_balance * monthly_rate) */
  interestDue: string
  /** Interest portion of repayments made this month */
  interestPaid: string
  /** Principal portion of repayments made this month */
  principalPaid: string
  /** interestPaid + principalPaid */
  totalPaid: string
  /** Running remaining principal balance after this month */
  remainingBalance: string
}

```

- [ ] **Step 2: Commit**

```bash
git add src/types/creditor.ts
git commit -m "feat: add MonthlySummaryRow and CreditorListItem types"
```

---

### Task 3: Add `getCreditorMonthlyInterestDue` Service Function

**Files:**
- Modify: `src/services/creditor.service.ts`

- [ ] **Step 1: Add the service function**

Add this function at the end of `src/services/creditor.service.ts`:

```typescript
/**
 * For each creditor, compute the monthly interest due:
 * Sum of (principal_balance × monthly_rate) across all their investments.
 * Returns Map<creditorId, formatted string>.
 */
export const getCreditorMonthlyInterestDue = (): Effect.Effect<
  Map<string, string>,
  DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      const allInvestments = await db.select().from(creditorInvestments);
      if (allInvestments.length === 0) return new Map<string, string>();

      const investmentIds = allInvestments.map((inv) => inv.id);
      const ledgerBalances = await getCreditorBalancesFromLedger(investmentIds);

      const dueByCreditor = new Map<string, BigNumber>();

      for (const investment of allInvestments) {
        const principalBalance =
          ledgerBalances.get(investment.id) ?? new BigNumber(investment.amount);

        if (principalBalance.isLessThanOrEqualTo(0)) continue;

        const monthlyRate = new BigNumber(investment.interestRateMonthly);
        const monthlyInterest = principalBalance.times(monthlyRate);

        const current =
          dueByCreditor.get(investment.creditorId) ?? new BigNumber(0);
        dueByCreditor.set(
          investment.creditorId,
          current.plus(monthlyInterest),
        );
      }

      const result = new Map<string, string>();
      for (const [creditorId, amount] of dueByCreditor) {
        result.set(creditorId, formatAmount(amount));
      }
      return result;
    },
    catch: (e) => new DatabaseError({ cause: e }),
  });
```

- [ ] **Step 2: Commit**

```bash
git add src/services/creditor.service.ts
git commit -m "feat: add getCreditorMonthlyInterestDue service function"
```

---

### Task 4: Add `getCreditorMonthlySummary` Service Function

**Files:**
- Modify: `src/services/creditor.service.ts`

- [ ] **Step 1: Add the service function**

Add this function at the end of `src/services/creditor.service.ts`:

```typescript
/**
 * Build a month-by-month summary for a single creditor.
 * Walks from earliest investment month to current month.
 * Each row: interest due, interest paid, principal paid, total paid, remaining balance.
 */
export const getCreditorMonthlySummary = (
  creditorId: string,
): Effect.Effect<MonthlySummaryRow[], CreditorNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [creditor] = await db
        .select()
        .from(creditors)
        .where(eq(creditors.id, creditorId));
      if (!creditor) throw { _tag: "CreditorNotFound", id: creditorId };

      const investments = await db
        .select()
        .from(creditorInvestments)
        .where(eq(creditorInvestments.creditorId, creditorId))
        .orderBy(asc(creditorInvestments.investmentDate));

      if (investments.length === 0) return [];

      // Fetch all repayments for this creditor's investments
      const investmentIds = investments.map((inv) => inv.id);
      const allRepayments = await db
        .select()
        .from(creditorRepayments)
        .where(inArray(creditorRepayments.investmentId, investmentIds))
        .orderBy(asc(creditorRepayments.repaymentDate));

      // Get interest/principal portions for each repayment from ledger
      const portionsMap =
        allRepayments.length > 0
          ? await getCreditorRepaymentPortionsFromLedger(
              allRepayments.map((r) => r.id),
            )
          : new Map<
              string,
              { interestPortion: string; principalPortion: string }
            >();

      // Group repayments by month (YYYY-MM)
      const repaymentsByMonth = new Map<
        string,
        { interestPaid: BigNumber; principalPaid: BigNumber }
      >();
      for (const repayment of allRepayments) {
        const date = new Date(repayment.repaymentDate);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        const current = repaymentsByMonth.get(monthKey) ?? {
          interestPaid: new BigNumber(0),
          principalPaid: new BigNumber(0),
        };
        const portions = portionsMap.get(repayment.id);
        if (portions) {
          current.interestPaid = current.interestPaid.plus(
            portions.interestPortion,
          );
          current.principalPaid = current.principalPaid.plus(
            portions.principalPortion,
          );
        } else {
          // Fallback: treat entire amount as principal
          current.principalPaid = current.principalPaid.plus(repayment.amount);
        }
        repaymentsByMonth.set(monthKey, current);
      }

      // Group investments by the month they started
      // Track: for each investment, which month it became active and its rate
      interface InvestmentInfo {
        id: string;
        amount: BigNumber;
        rate: BigNumber;
        startMonth: string;
      }
      const investmentInfos: InvestmentInfo[] = investments.map((inv) => {
        const d = new Date(inv.investmentDate);
        return {
          id: inv.id,
          amount: new BigNumber(inv.amount),
          rate: new BigNumber(inv.interestRateMonthly),
          startMonth: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        };
      });

      // Determine month range
      const earliestDate = new Date(investments[0].investmentDate);
      const startYear = earliestDate.getFullYear();
      const startMonth = earliestDate.getMonth(); // 0-indexed
      const now = new Date();
      const endYear = now.getFullYear();
      const endMonth = now.getMonth();

      // Walk month by month
      const rows: MonthlySummaryRow[] = [];
      // Track running principal balance per investment
      const balances = new Map<string, BigNumber>();

      let year = startYear;
      let month = startMonth;

      while (year < endYear || (year === endYear && month <= endMonth)) {
        const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;

        // Activate new investments this month
        for (const info of investmentInfos) {
          if (info.startMonth === monthKey && !balances.has(info.id)) {
            balances.set(info.id, info.amount);
          }
        }

        // Calculate interest due this month
        let interestDue = new BigNumber(0);
        for (const info of investmentInfos) {
          const bal = balances.get(info.id);
          if (bal && bal.isGreaterThan(0)) {
            interestDue = interestDue.plus(bal.times(info.rate));
          }
        }

        // Get repayments for this month
        const monthRepayments = repaymentsByMonth.get(monthKey) ?? {
          interestPaid: new BigNumber(0),
          principalPaid: new BigNumber(0),
        };

        // Reduce principal balances proportionally based on principal paid
        // Distribute principal reduction across investments proportionally
        let totalPrincipalPaid = monthRepayments.principalPaid;
        if (totalPrincipalPaid.isGreaterThan(0)) {
          const totalBalance = Array.from(balances.values()).reduce(
            (acc, b) => acc.plus(b),
            new BigNumber(0),
          );
          if (totalBalance.isGreaterThan(0)) {
            for (const [invId, bal] of balances) {
              const share = bal.div(totalBalance);
              const reduction = totalPrincipalPaid.times(share);
              balances.set(invId, BigNumber.max(bal.minus(reduction), new BigNumber(0)));
            }
          }
        }

        const totalRemainingBalance = Array.from(balances.values()).reduce(
          (acc, b) => acc.plus(b),
          new BigNumber(0),
        );

        const totalPaid = monthRepayments.interestPaid.plus(
          monthRepayments.principalPaid,
        );

        rows.push({
          month: monthKey,
          interestDue: formatAmount(interestDue),
          interestPaid: formatAmount(monthRepayments.interestPaid),
          principalPaid: formatAmount(monthRepayments.principalPaid),
          totalPaid: formatAmount(totalPaid),
          remainingBalance: formatAmount(totalRemainingBalance),
        });

        // Advance month
        month++;
        if (month > 11) {
          month = 0;
          year++;
        }
      }

      // Return newest first
      return rows.reverse();
    },
    catch: (e: any) => {
      if (e?._tag === "CreditorNotFound")
        return new CreditorNotFound({ id: e.id });
      return new DatabaseError({ cause: e });
    },
  });
```

Add the import for `MonthlySummaryRow` at the top of the file (update the existing import from `@/types`):

```typescript
import type {
  Creditor,
  CreditorInvestment,
  CreditorRepayment,
  CreateCreditorInput,
  UpdateCreditorInput,
  AddInvestmentInput,
  RecordCreditorRepaymentInput,
  CreditorDashboard,
  CreditorInvestmentSummary,
  MonthlySummaryRow,
} from "@/types";
```

Add the import for `getCreditorRepaymentPortionsFromLedger`:

```typescript
import { getCreditorBalancesFromLedger, getInterestPayableFromLedger, getCreditorTotalInvestedFromLedger, getCreditorTotalRepaidFromLedger, getCreditorRepaymentPortionsFromLedger } from "@/services/ledger-queries.service";
```

- [ ] **Step 2: Commit**

```bash
git add src/services/creditor.service.ts
git commit -m "feat: add getCreditorMonthlySummary service function"
```

---

### Task 5: Expose New Service Functions as Server Actions

**Files:**
- Modify: `src/actions/creditor.actions.ts`

- [ ] **Step 1: Add imports and actions**

Add to the imports from `@/services/creditor.service`:

```typescript
import {
  createCreditor,
  updateCreditor,
  addInvestment,
  recordCreditorRepayment,
  listCreditors,
  getSystemCapital,
  getCreditorMonthlyInterestDue,
  getCreditorMonthlySummary,
} from "@/services/creditor.service"
```

Add at the end of the file:

```typescript
export const getCreditorMonthlyInterestDueAction = withAction({
  permission: "creditor:read",
  effect: () => getCreditorMonthlyInterestDue(),
})

export const getCreditorMonthlySummaryAction = withAction<string, any>({
  permission: "creditor:read",
  effect: (_session, creditorId) => getCreditorMonthlySummary(creditorId),
})
```

Note: `getCreditorMonthlyInterestDue` returns `Map<string, string>` but Maps don't serialize over the wire. We need to convert the result. Let's use the `action` mode instead:

```typescript
export const getCreditorMonthlyInterestDueAction = withAction({
  permission: "creditor:read",
  action: async () => {
    try {
      const map = await Effect.runPromise(getCreditorMonthlyInterestDue())
      const data: Record<string, string> = {}
      for (const [k, v] of map) data[k] = v
      return { data }
    } catch {
      return { error: "Internal server error" }
    }
  },
})

export const getCreditorMonthlySummaryAction = withAction<string, any>({
  permission: "creditor:read",
  action: async (_session, creditorId) => {
    try {
      const data = await Effect.runPromise(getCreditorMonthlySummary(creditorId))
      return { data }
    } catch {
      return { error: "Internal server error" }
    }
  },
})
```

Add the `Effect` import if not already present (it is — line 3).

- [ ] **Step 2: Commit**

```bash
git add src/actions/creditor.actions.ts
git commit -m "feat: expose monthly interest due and monthly summary as server actions"
```

---

### Task 6: Add Query Key for Monthly Summary

**Files:**
- Modify: `src/hooks/query-keys.ts`

- [ ] **Step 1: Add query keys**

In `src/hooks/query-keys.ts`, update the `creditors` section:

```typescript
creditors: {
    all: ["creditors"] as const,
    detail: (id: string) => [...queryKeys.creditors.all, id] as const,
    capital: () => [...queryKeys.creditors.all, "capital"] as const,
    monthlyDue: () => [...queryKeys.creditors.all, "monthly-due"] as const,
    monthlySummary: (id: string) => [...queryKeys.creditors.detail(id), "monthly-summary"] as const,
  },
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/query-keys.ts
git commit -m "feat: add creditor monthly due and monthly summary query keys"
```

---

### Task 7: Add "Monthly Interest Due" Column to Creditors List

**Files:**
- Modify: `src/app/(app)/creditors/page.tsx`
- Modify: `src/app/(app)/creditors/creditors-table.tsx`

- [ ] **Step 1: Update the creditors list page to fetch monthly interest due**

In `src/app/(app)/creditors/page.tsx`, add the import:

```typescript
import { listCreditorsAction, getSystemCapitalAction, getCreditorMonthlyInterestDueAction } from "@/actions/creditor.actions"
```

After the existing `capital` query (around line 39), add:

```typescript
const { data: monthlyDue = {}, isLoading: monthlyDueLoading } = useQuery({
    queryKey: queryKeys.creditors.monthlyDue(),
    queryFn: async () => {
      const result = await getCreditorMonthlyInterestDueAction()
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
    enabled: !!session && isSupervisorOrAbove,
  })
```

Update the `isLoading` line:

```typescript
const isLoading = creditorsLoading || capitalLoading || monthlyDueLoading
```

Update the `CreditorsTable` usage to pass `monthlyDue`:

```tsx
<CreditorsTable creditors={creditors} monthlyDue={monthlyDue} />
```

(Update both usages — the one in the main content and the empty state doesn't use the table so no change there.)

- [ ] **Step 2: Add the column to CreditorsTable**

Replace the entire `src/app/(app)/creditors/creditors-table.tsx` with:

```tsx
"use client"

import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { ButtonLink } from "@/components/ui/button-link"
import { formatDate, formatCurrency } from "@/lib/utils"

type Creditor = {
  id: string
  name: string
  contact: string
  address: string
  createdAt: Date
  updatedAt: Date
}

interface Props {
  creditors: Creditor[]
  monthlyDue: Record<string, string>
}

function getColumns(monthlyDue: Record<string, string>): Column<Creditor>[] {
  return [
    {
      key: "name",
      header: "Name",
      primary: true,
      render: (c) => <span className="font-medium">{c.name}</span>,
    },
    {
      key: "contact",
      header: "Contact",
      render: (c) => c.contact,
    },
    {
      key: "address",
      header: "Address",
      render: (c) => c.address,
    },
    {
      key: "monthlyInterestDue",
      header: "Monthly Interest Due",
      cardLabel: "Interest Due",
      render: (c) => (
        <span className="font-mono tabular-nums">
          {formatCurrency(monthlyDue[c.id] ?? "0")}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "Date Added",
      cardLabel: "Added",
      render: (c) => <span className="font-mono tabular-nums">{formatDate(c.createdAt)}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      hideInCard: false,
      render: (c) => (
        <ButtonLink href={`/creditors/${c.id}`} variant="outline" size="sm">
          View
        </ButtonLink>
      ),
    },
  ]
}

export function CreditorsTable({ creditors, monthlyDue }: Props) {
  return (
    <ResponsiveTable
      columns={getColumns(monthlyDue)}
      rows={creditors}
      getRowKey={(c) => c.id}
      getRowProps={(_c) => ({ "data-testid": "data-row" })}
    />
  )
}
```

- [ ] **Step 3: Verify the page renders**

Run: `npx next build --no-lint 2>&1 | head -30` or check the dev server for `/creditors`.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/creditors/page.tsx src/app/\(app\)/creditors/creditors-table.tsx
git commit -m "feat: add monthly interest due column to creditors list"
```

---

### Task 8: Add Monthly Summary Tab to Creditor Profile

**Files:**
- Modify: `src/app/(app)/creditors/[id]/page.tsx`
- Modify: `src/app/(app)/creditors/[id]/CreditorProfileClient.tsx`

- [ ] **Step 1: Fetch monthly summary in the server page**

In `src/app/(app)/creditors/[id]/page.tsx`, add import:

```typescript
import { getCreditorMonthlySummary } from "@/services/creditor.service"
import type { CreditorRepayment, CreditorInvestment, PaymentPortionsMap, MonthlySummaryRow } from "@/types"
```

Add a variable declaration alongside the existing ones (around line 33):

```typescript
let monthlySummary: MonthlySummaryRow[] = []
```

Inside the try block, after the repayment portions logic (around line 75), add:

```typescript
try {
  monthlySummary = await Effect.runPromise(getCreditorMonthlySummary(id))
} catch {
  // Non-critical — page renders without monthly summary
}
```

Pass `monthlySummary` to the client component:

```tsx
<CreditorProfileClient
  creditorId={id}
  creditor={creditor}
  dashboard={dashboard}
  investments={investments}
  repayments={repayments}
  repaymentPortions={repaymentPortions}
  monthlySummary={monthlySummary}
/>
```

- [ ] **Step 2: Add the Monthly Summary tab to CreditorProfileClient**

Replace the entire `src/app/(app)/creditors/[id]/CreditorProfileClient.tsx` with:

```tsx
"use client"

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AddInvestmentDialog } from "./AddInvestmentDialog"
import { RecordRepaymentDialog } from "./RecordRepaymentDialog"
import type { Creditor, CreditorDashboard, CreditorInvestment, CreditorRepayment, PaymentPortionsMap, MonthlySummaryRow } from "@/types"
import { formatDate, formatCurrency, formatRate } from "@/lib/utils"

interface Props {
  creditorId: string
  creditor: Creditor
  dashboard: CreditorDashboard
  investments: CreditorInvestment[]
  repayments: CreditorRepayment[]
  repaymentPortions: PaymentPortionsMap
  monthlySummary: MonthlySummaryRow[]
}

function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-")
  const date = new Date(Number(year), Number(month) - 1)
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short" })
}

export function CreditorProfileClient({
  creditorId,
  creditor,
  dashboard,
  investments,
  repayments,
  repaymentPortions,
  monthlySummary,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <AddInvestmentDialog creditorId={creditorId} />
        <RecordRepaymentDialog
          creditorId={creditorId}
          investments={investments}
          outstandingBalance={dashboard.outstandingBalance}
        />
      </div>

      <Tabs defaultValue="investments">
        <TabsList>
          <TabsTrigger value="investments">Investments</TabsTrigger>
          <TabsTrigger value="repayments">Repayments</TabsTrigger>
          <TabsTrigger value="monthly-summary">Monthly Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="investments">
          {investments.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No investments recorded for this creditor.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Principal Balance</TableHead>
                    <TableHead className="text-right">Interest Accrued</TableHead>
                    <TableHead className="text-right">Total Repaid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.investments.map((inv) => (
                    <TableRow key={inv.id} data-testid="data-row">
                      <TableCell className="font-mono tabular-nums">{formatDate(inv.investmentDate)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatCurrency(inv.amount)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatRate(inv.interestRateMonthly, 1)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatCurrency(inv.principalBalance)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatCurrency(inv.interestAccrued)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatCurrency(inv.totalRepaid)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="repayments">
          {repayments.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No repayments recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Interest Portion</TableHead>
                    <TableHead className="text-right">Principal Portion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {repayments.map((repayment) => {
                    const portions = repaymentPortions[repayment.id]
                    return (
                      <TableRow key={repayment.id} data-testid="data-row">
                        <TableCell className="font-mono tabular-nums">{formatDate(repayment.repaymentDate)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatCurrency(repayment.amount)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatCurrency(portions?.interestPortion ?? "0")}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatCurrency(portions?.principalPortion ?? "0")}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="monthly-summary">
          {monthlySummary.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No monthly data available yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Interest Due</TableHead>
                    <TableHead className="text-right">Interest Paid</TableHead>
                    <TableHead className="text-right">Principal Paid</TableHead>
                    <TableHead className="text-right">Total Paid</TableHead>
                    <TableHead className="text-right">Remaining Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlySummary.map((row) => (
                    <TableRow key={row.month} data-testid="data-row">
                      <TableCell className="font-mono tabular-nums">{formatMonth(row.month)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatCurrency(row.interestDue)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatCurrency(row.interestPaid)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatCurrency(row.principalPaid)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatCurrency(row.totalPaid)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatCurrency(row.remainingBalance)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

- [ ] **Step 3: Export MonthlySummaryRow from types index**

Check `src/types/index.ts` and add `MonthlySummaryRow` and `CreditorListItem` to the creditor re-exports if they use a barrel file. If the file imports from `./creditor`, the new types will be automatically available.

- [ ] **Step 4: Verify the page renders**

Run: `npx next build --no-lint 2>&1 | head -30` or check the dev server for `/creditors/[any-id]`.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/creditors/\[id\]/page.tsx src/app/\(app\)/creditors/\[id\]/CreditorProfileClient.tsx
git commit -m "feat: add monthly summary tab to creditor profile"
```
