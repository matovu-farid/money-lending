# Cash Management & Account Equation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Track money across three locations (cash, bank, strong room), record deposit location on payments and disbursement source on loans, support fund transfers between locations, and display location-based balances on financial statements.

**Architecture:** New `deposit_location` enum shared by payments and loans. New `fund_transfers` table for inter-location movements. Payment form gets deposit location dropdown. Loan creation form gets disbursement source dropdown. Balance sheet updated to show per-location asset breakdown. Accounting equation: Assets (Cash + Bank + Strong Room + Outstanding Loans) = Equity + Income.

**Tech Stack:** Next.js, Drizzle ORM, React Hook Form, TanStack Query, shadcn/ui

---

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/lib/db/schema/fund-transfers.ts` | `fundTransfers` table + `depositLocationEnum` pgEnum |
| `src/services/fund-transfer.service.ts` | `createFundTransfer`, `listFundTransfers` Effect services |
| `src/actions/fund-transfer.actions.ts` | Server actions for fund transfer CRUD (admin+ only) |
| `src/app/(app)/fund-transfers/page.tsx` | Fund transfers list page with "New Transfer" dialog |
| `cypress/e2e/cash-management.cy.ts` | E2E tests for deposit location, disbursement source, fund transfers, balance sheet |

### Files to Modify
| File | Changes |
|---|---|
| `src/lib/db/schema/payments.ts` | Add `depositLocation` column using shared enum |
| `src/lib/db/schema/loans.ts` | Add `disbursementSource` column using shared enum |
| `src/lib/db/schema/index.ts` | Re-export `fund-transfers` module |
| `src/types/index.ts` | Add `DepositLocation` type, `FundTransfer` types, update input interfaces, update `BalanceSheetData` |
| `src/actions/payment.actions.ts` | Validate `depositLocation` in `recordPaymentAction` |
| `src/services/payment.service.ts` | Include `depositLocation` in payment insert |
| `src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx` | Add deposit location Select dropdown |
| `src/actions/loan.actions.ts` | Validate `disbursementSource` in `createLoanAction` |
| `src/services/loan.service.ts` | Include `disbursementSource` in loan insert |
| `src/app/(app)/loans/new/page.tsx` | Add disbursement source Select dropdown in Step 1 |
| `src/hooks/use-create-loan.ts` | Add `disbursementSource` to optimistic loan object |
| `src/services/report.service.ts` | Calculate per-location balances in `getBalanceSheetData` |
| `src/app/(app)/reports/balance-sheet/BalanceSheetClient.tsx` | Display per-location asset breakdown |
| `src/app/(app)/reports/balance-sheet/page.tsx` | Pass updated `BalanceSheetData` shape |
| `src/components/layout/sidebar.tsx` | Add "Fund Transfers" nav item under Capital group |

---

## Task 1: Create deposit location enum and fund_transfers schema

**Files:**
- Create: `src/lib/db/schema/fund-transfers.ts`
- Modify: `src/lib/db/schema/payments.ts`
- Modify: `src/lib/db/schema/loans.ts`
- Modify: `src/lib/db/schema/index.ts`

- [ ] **Step 1: Create `src/lib/db/schema/fund-transfers.ts` with the shared enum and fund_transfers table**

```typescript
import { pgTable, uuid, numeric, timestamp, text, pgEnum } from "drizzle-orm/pg-core"

export const depositLocationEnum = pgEnum("deposit_location", [
  "cash",
  "bank",
  "strong_room",
])

export const fundTransfers = pgTable("fund_transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromLocation: depositLocationEnum("from_location").notNull(),
  toLocation: depositLocationEnum("to_location").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  transferredBy: text("transferred_by").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})
```

- [ ] **Step 2: Add `depositLocation` column to `src/lib/db/schema/payments.ts`**

Import `depositLocationEnum` from `./fund-transfers` and add the column after `recordedBy`:

```typescript
import { depositLocationEnum } from "./fund-transfers"
```

Add to the table definition:

```typescript
  depositLocation: depositLocationEnum("deposit_location").notNull(),
```

Place it after the `recordedBy` column.

- [ ] **Step 3: Add `disbursementSource` column to `src/lib/db/schema/loans.ts`**

Import `depositLocationEnum` from `./fund-transfers` and add the column after `issuedBy`:

```typescript
import { depositLocationEnum } from "./fund-transfers"
```

Add to the table definition:

```typescript
  disbursementSource: depositLocationEnum("disbursement_source").notNull(),
```

Place it after the `issuedBy` column.

- [ ] **Step 4: Export from `src/lib/db/schema/index.ts`**

Add this line:

```typescript
export * from "./fund-transfers"
```

- [ ] **Step 5: Generate and push migration**

Run:
```bash
npx drizzle-kit generate
npx drizzle-kit push
```

If the push fails because existing rows lack `deposit_location` / `disbursement_source`, add a default in the migration SQL (e.g. `DEFAULT 'cash'`) then push again. After data is backfilled, the `notNull()` constraint holds for all new rows.

---

## Task 2: Update types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add `DepositLocation` type alias**

Add near the top of the types file, after the `LoanStatus` / `CustomerStatus` lines:

```typescript
export type DepositLocation = "cash" | "bank" | "strong_room"
```

- [ ] **Step 2: Add `depositLocation` to `RecordPaymentInput`**

Change the `RecordPaymentInput` interface to include:

```typescript
export interface RecordPaymentInput {
  loanId: string
  paymentDate: string  // ISO 8601
  amount: string       // NUMERIC string
  depositLocation: DepositLocation
  note?: string
}
```

- [ ] **Step 3: Add `disbursementSource` to `CreateLoanInput`**

Add after `collateral`:

```typescript
export interface CreateLoanInput {
  customerId: string
  principalAmount: string
  interestRate: string
  minInterestDays: number
  startDate: string
  collateral: CollateralInput
  disbursementSource: DepositLocation
  interestRateOverride?: string | null
  minPeriodOverride?: number | null
}
```

- [ ] **Step 4: Add FundTransfer types**

Add after the existing report types:

```typescript
// --- Cash Management: Fund Transfer types ---
import type { fundTransfers } from "@/lib/db/schema/fund-transfers"

export type FundTransfer = InferSelectModel<typeof fundTransfers>
export type NewFundTransfer = InferInsertModel<typeof fundTransfers>

export interface CreateFundTransferInput {
  fromLocation: DepositLocation
  toLocation: DepositLocation
  amount: string       // NUMERIC string
  note?: string
}
```

Note: the `fundTransfers` import should be added alongside the other schema imports at the top of the file.

- [ ] **Step 5: Update `BalanceSheetData` to include per-location breakdown**

Replace the existing `BalanceSheetData` interface:

```typescript
export interface BalanceSheetData {
  asOf: string
  assets: {
    cashBalance: string
    bankBalance: string
    strongRoomBalance: string
    totalLoansOutstanding: string
    totalAssets: string
  }
  liabilities: { totalCreditorBalances: string }
  equity: { shareCapital: string; retainedEarnings: string; totalEquity: string }
}
```

- [ ] **Step 6: Add `depositLocation` to `PaymentWithCustomer`**

Update the `PaymentWithCustomer` interface to include:

```typescript
export interface PaymentWithCustomer {
  id: string
  loanId: string
  customerId: string
  customerName: string
  paymentDate: Date
  amount: string
  interestPortion: string
  principalPortion: string
  principalBalanceAfter: string
  recordedBy: string
  depositLocation: DepositLocation
  createdAt: Date
}
```

- [ ] **Step 7: Add `depositLocation` to `DailyCollectionRow`**

Update the `DailyCollectionRow` interface:

```typescript
export interface DailyCollectionRow {
  paymentId: string
  loanId: string
  customerName: string
  amount: string
  interestPortion: string
  principalPortion: string
  paymentDate: Date
  depositLocation: DepositLocation
}
```

---

## Task 3: Update payment recording

**Files:**
- Modify: `src/actions/payment.actions.ts`
- Modify: `src/services/payment.service.ts`
- Modify: `src/app/(app)/loans/[loanId]/payments/new/record-payment-form.tsx`

- [ ] **Step 1: Validate `depositLocation` in `recordPaymentAction`**

In `src/actions/payment.actions.ts`, inside `recordPaymentAction`, add validation after the existing amount/date checks:

```typescript
  const validLocations = ["cash", "bank", "strong_room"]
  if (!input.depositLocation || !validLocations.includes(input.depositLocation)) {
    return { error: "Deposit location is required (cash, bank, or strong_room)" }
  }
```

- [ ] **Step 2: Include `depositLocation` in payment insert in `src/services/payment.service.ts`**

In the `recordPayment` function, add `depositLocation` to the `.values()` call:

Find the insert block:
```typescript
        const [newPayment] = await tx
          .insert(payments)
          .values({
            loanId: input.loanId,
            paymentDate: new Date(input.paymentDate),
            amount: input.amount,
            interestPortion: allocation.interestPortion,
            principalPortion: allocation.principalPortion,
            principalBalanceBefore: allocation.principalBalanceBefore,
            principalBalanceAfter: allocation.principalBalanceAfter,
            recordedBy: actorId,
          })
          .returning()
```

Change to:
```typescript
        const [newPayment] = await tx
          .insert(payments)
          .values({
            loanId: input.loanId,
            paymentDate: new Date(input.paymentDate),
            amount: input.amount,
            interestPortion: allocation.interestPortion,
            principalPortion: allocation.principalPortion,
            principalBalanceBefore: allocation.principalBalanceBefore,
            principalBalanceAfter: allocation.principalBalanceAfter,
            recordedBy: actorId,
            depositLocation: input.depositLocation,
          })
          .returning()
```

- [ ] **Step 3: Add `depositLocation` to the `listPayments` select in `src/services/payment.service.ts`**

In the `listPayments` function's `.select()` block, add:

```typescript
            depositLocation: payments.depositLocation,
```

after the `recordedBy` field.

- [ ] **Step 4: Add deposit location dropdown to `record-payment-form.tsx`**

Add the Select import at the top:

```typescript
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Controller } from "react-hook-form"
```

Update the `PaymentFormValues` interface:

```typescript
interface PaymentFormValues {
  paymentDate: string
  amount: string
  depositLocation: "cash" | "bank" | "strong_room"
  note: string
}
```

Add `depositLocation: "cash"` to the `defaultValues` in `useForm`.

Update the `onSubmit` function to include `depositLocation`:

```typescript
  function onSubmit(data: PaymentFormValues) {
    startTransition(async () => {
      const result = await recordPaymentAction({
        loanId,
        paymentDate: data.paymentDate + "T12:00:00",
        amount: data.amount.trim(),
        depositLocation: data.depositLocation,
        note: data.note.trim() || undefined,
      })
      // ... rest unchanged
    })
  }
```

Add the Select field in the form JSX, between the Amount MoneyInput and the Note textarea:

```tsx
            <div className="space-y-1">
              <Label htmlFor="depositLocation">Deposit Location</Label>
              <Controller
                name="depositLocation"
                control={control}
                rules={{ required: "Deposit location is required" }}
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isPending}
                  >
                    <SelectTrigger id="depositLocation">
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="bank">Bank</SelectItem>
                      <SelectItem value="strong_room">Strong Room</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.depositLocation && (
                <p className="text-sm text-destructive">{errors.depositLocation.message}</p>
              )}
            </div>
```

---

## Task 4: Update loan creation

**Files:**
- Modify: `src/actions/loan.actions.ts`
- Modify: `src/services/loan.service.ts`
- Modify: `src/app/(app)/loans/new/page.tsx`
- Modify: `src/hooks/use-create-loan.ts`

- [ ] **Step 1: Validate `disbursementSource` in `createLoanAction`**

In `src/actions/loan.actions.ts`, inside `createLoanAction`, add validation after the existing collateral check:

```typescript
  const validLocations = ["cash", "bank", "strong_room"]
  if (!input.disbursementSource || !validLocations.includes(input.disbursementSource)) {
    return { error: "Disbursement source is required (cash, bank, or strong_room)" }
  }
```

- [ ] **Step 2: Include `disbursementSource` in loan insert in `src/services/loan.service.ts`**

In the `createLoan` function, add `disbursementSource` to the `.values()` call:

Find:
```typescript
        const [loan] = await tx
          .insert(loans)
          .values({
            customerId: input.customerId,
            principalAmount: input.principalAmount,
            interestRate: input.interestRate,
            minInterestDays: input.minInterestDays,
            startDate,
            status: "active",
            interestRateOverride: input.interestRateOverride ?? null,
            minPeriodOverride: input.minPeriodOverride ?? null,
            issuedBy: actorId,
          })
          .returning()
```

Change to:
```typescript
        const [loan] = await tx
          .insert(loans)
          .values({
            customerId: input.customerId,
            principalAmount: input.principalAmount,
            interestRate: input.interestRate,
            minInterestDays: input.minInterestDays,
            startDate,
            status: "active",
            interestRateOverride: input.interestRateOverride ?? null,
            minPeriodOverride: input.minPeriodOverride ?? null,
            issuedBy: actorId,
            disbursementSource: input.disbursementSource,
          })
          .returning()
```

- [ ] **Step 3: Add disbursement source dropdown to `src/app/(app)/loans/new/page.tsx`**

Add the Select and Controller imports at the top:

```typescript
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Controller } from "react-hook-form"
```

Update `LoanFormValues`:

```typescript
interface LoanFormValues {
  customerId: string
  principalAmount: string
  startDate: string
  interestRateDisplay: string
  disbursementSource: "cash" | "bank" | "strong_room"
  collateralNature: string
  collateralDescription: string
}
```

Add `disbursementSource: "cash"` to `defaultValues`.

Add `"disbursementSource"` to the `step1Fields` array:

```typescript
const step1Fields: (keyof LoanFormValues)[] = ["customerId", "principalAmount", "startDate", "interestRateDisplay", "disbursementSource"]
```

Add the Select field in Step 1's CardContent, after the interest rate input and before the "Next" button:

```tsx
              <div className="space-y-1">
                <Label htmlFor="disbursementSource">Disbursement Source</Label>
                <Controller
                  name="disbursementSource"
                  control={control}
                  rules={{ required: "Disbursement source is required" }}
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger id="disbursementSource">
                        <SelectValue placeholder="Select source" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="bank">Bank</SelectItem>
                        <SelectItem value="strong_room">Strong Room</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.disbursementSource && (
                  <p className="text-sm text-destructive">{errors.disbursementSource.message}</p>
                )}
              </div>
```

Update the `onSubmit` function to include `disbursementSource`:

```typescript
  function onSubmit(data: LoanFormValues) {
    const collateral: CollateralInput = {
      nature: data.collateralNature,
      description: data.collateralDescription.trim() || undefined,
    }

    createLoan.mutate({
      customerId: data.customerId,
      principalAmount: data.principalAmount,
      interestRate: (parseFloat(data.interestRateDisplay) / 100).toFixed(10),
      minInterestDays: 30,
      startDate: new Date(data.startDate).toISOString(),
      collateral,
      disbursementSource: data.disbursementSource,
    })
  }
```

Add a review row for disbursement source in Step 3, after the interest rate row:

```tsx
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Disbursement Source</dt>
                    <dd className="font-medium capitalize">
                      {disbursementSource === "strong_room" ? "Strong Room" : disbursementSource.charAt(0).toUpperCase() + disbursementSource.slice(1)}
                    </dd>
                  </div>
```

Watch the `disbursementSource` value like the other fields:

```typescript
  const disbursementSource = watch("disbursementSource")
```

- [ ] **Step 4: Update optimistic loan in `src/hooks/use-create-loan.ts`**

Add `disbursementSource` to the optimistic object:

```typescript
      const optimistic: LoanWithCustomer = {
        id: `optimistic-${Date.now()}`,
        customerId: input.customerId,
        customerName: "Loading...",
        principalAmount: input.principalAmount,
        interestRate: input.interestRate || "0.10",
        minInterestDays: input.minInterestDays || 30,
        interestRateOverride: input.interestRateOverride ?? null,
        minPeriodOverride: input.minPeriodOverride ?? null,
        startDate: new Date(input.startDate),
        status: "active",
        issuedBy: "",
        disbursementSource: input.disbursementSource,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
```

Note: `LoanWithCustomer` extends `Loan` which is inferred from the schema. Since we added `disbursementSource` to the schema in Task 1, the `Loan` type will already include it. The optimistic object just needs to supply the value.

---

## Task 5: Fund transfer service and actions

**Files:**
- Create: `src/services/fund-transfer.service.ts`
- Create: `src/actions/fund-transfer.actions.ts`

- [ ] **Step 1: Create `src/services/fund-transfer.service.ts`**

```typescript
import { Effect } from "effect"
import { db } from "@/lib/db"
import { fundTransfers } from "@/lib/db/schema/fund-transfers"
import { desc } from "drizzle-orm"
import { DatabaseError } from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import type { CreateFundTransferInput, FundTransfer } from "@/types"

export const createFundTransfer = (
  input: CreateFundTransferInput,
  actorId: string
): Effect.Effect<FundTransfer, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [transfer] = await tx
          .insert(fundTransfers)
          .values({
            fromLocation: input.fromLocation,
            toLocation: input.toLocation,
            amount: input.amount,
            transferredBy: actorId,
            note: input.note?.trim() || null,
          })
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "fund_transfer.create",
          entityType: "fund_transfer",
          entityId: transfer.id,
          beforeValue: null,
          afterValue: transfer,
        })

        return transfer
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const listFundTransfers = (): Effect.Effect<FundTransfer[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db
        .select()
        .from(fundTransfers)
        .orderBy(desc(fundTransfers.createdAt))
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
```

- [ ] **Step 2: Create `src/actions/fund-transfer.actions.ts`**

```typescript
"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { createFundTransfer, listFundTransfers } from "@/services/fund-transfer.service"
import { ROLE_LEVELS, type UserRole } from "@/types"
import type { CreateFundTransferInput } from "@/types"

export async function createFundTransferAction(input: CreateFundTransferInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.admin) {
    return { error: "Forbidden: admin access required" }
  }

  const validLocations = ["cash", "bank", "strong_room"]
  if (!input.fromLocation || !validLocations.includes(input.fromLocation)) {
    return { error: "Invalid source location" }
  }
  if (!input.toLocation || !validLocations.includes(input.toLocation)) {
    return { error: "Invalid destination location" }
  }
  if (input.fromLocation === input.toLocation) {
    return { error: "Source and destination must be different" }
  }
  if (!input.amount?.trim() || !/^\d+(\.\d{1,2})?$/.test(input.amount)) {
    return { error: "Amount must be a valid decimal number" }
  }
  if (parseFloat(input.amount) <= 0) {
    return { error: "Amount must be greater than zero" }
  }

  try {
    const data = await Effect.runPromise(createFundTransfer(input, session.user.id))
    revalidatePath("/fund-transfers")
    revalidatePath("/reports/balance-sheet")
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function listFundTransfersAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  try {
    const data = await Effect.runPromise(listFundTransfers())
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}
```

---

## Task 6: Fund transfer page

**Files:**
- Create: `src/app/(app)/fund-transfers/page.tsx`
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Create `src/app/(app)/fund-transfers/page.tsx`**

```tsx
"use client"

import { useState, useTransition } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm, Controller } from "react-hook-form"
import { Loader2, ArrowRightLeft } from "lucide-react"
import { toast } from "sonner"
import { createFundTransferAction, listFundTransfersAction } from "@/actions/fund-transfer.actions"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { MoneyInput } from "@/components/ui/money-input"
import { PageHeader } from "@/components/ui/page-header"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent } from "@/components/ui/card"
import { formatCurrency, formatDate } from "@/lib/utils"
import type { DepositLocation } from "@/types"

const LOCATION_LABELS: Record<DepositLocation, string> = {
  cash: "Cash",
  bank: "Bank",
  strong_room: "Strong Room",
}

interface TransferFormValues {
  fromLocation: DepositLocation
  toLocation: DepositLocation
  amount: string
  note: string
}

export default function FundTransfersPage() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const { data: transfers = [], isLoading } = useQuery({
    queryKey: ["fund-transfers"],
    queryFn: async () => {
      const result = await listFundTransfersAction()
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
  })

  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<TransferFormValues>({
    defaultValues: {
      fromLocation: "cash",
      toLocation: "bank",
      amount: "",
      note: "",
    },
  })

  const fromLocation = watch("fromLocation")

  function onSubmit(data: TransferFormValues) {
    if (data.fromLocation === data.toLocation) {
      toast.error("Source and destination must be different")
      return
    }

    startTransition(async () => {
      const result = await createFundTransferAction({
        fromLocation: data.fromLocation,
        toLocation: data.toLocation,
        amount: data.amount.trim(),
        note: data.note.trim() || undefined,
      })

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      toast.success("Fund transfer recorded")
      reset()
      setDialogOpen(false)
      await queryClient.invalidateQueries({ queryKey: ["fund-transfers"] })
    })
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Fund Transfers"
          subtitle="Move money between cash, bank, and strong room"
        />
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              New Transfer
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record Fund Transfer</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="fromLocation">From</Label>
                <Controller
                  name="fromLocation"
                  control={control}
                  rules={{ required: "Source is required" }}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={isPending}>
                      <SelectTrigger id="fromLocation">
                        <SelectValue placeholder="Select source" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="bank">Bank</SelectItem>
                        <SelectItem value="strong_room">Strong Room</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.fromLocation && (
                  <p className="text-sm text-destructive">{errors.fromLocation.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="toLocation">To</Label>
                <Controller
                  name="toLocation"
                  control={control}
                  rules={{
                    required: "Destination is required",
                    validate: (v) => v !== fromLocation || "Source and destination must be different",
                  }}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={isPending}>
                      <SelectTrigger id="toLocation">
                        <SelectValue placeholder="Select destination" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="bank">Bank</SelectItem>
                        <SelectItem value="strong_room">Strong Room</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.toLocation && (
                  <p className="text-sm text-destructive">{errors.toLocation.message}</p>
                )}
              </div>

              <MoneyInput
                name="amount"
                control={control}
                label="Amount (UGX)"
                required="Amount is required"
                disabled={isPending}
                id="transferAmount"
              />

              <div className="space-y-1">
                <Label htmlFor="transferNote">Note (optional)</Label>
                <Controller
                  name="note"
                  control={control}
                  render={({ field }) => (
                    <Textarea
                      id="transferNote"
                      placeholder="Reason for transfer..."
                      disabled={isPending}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              </div>

              <Button type="submit" disabled={isPending} className="w-full">
                {isPending ? (
                  <>
                    <Loader2 className="animate-spin mr-2 h-4 w-4" />
                    Recording...
                  </>
                ) : (
                  "Record Transfer"
                )}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
            </div>
          ) : transfers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No fund transfers recorded yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono tabular-nums text-sm">
                      {formatDate(t.createdAt)}
                    </TableCell>
                    <TableCell>{LOCATION_LABELS[t.fromLocation as DepositLocation]}</TableCell>
                    <TableCell>{LOCATION_LABELS[t.toLocation as DepositLocation]}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCurrency(t.amount)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
                      {t.note || "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Add "Fund Transfers" to sidebar nav**

In `src/components/layout/sidebar.tsx`, import `ArrowRightLeft` from lucide-react (add to the existing import), then add the nav item to the Capital group:

```typescript
  {
    label: "Capital",
    items: [
      { label: "Creditors", href: "/creditors", icon: Landmark },
      { label: "Expenses & Income", href: "/expenses", icon: Receipt },
      { label: "Fund Transfers", href: "/fund-transfers", icon: ArrowRightLeft },
    ],
  },
```

---

## Task 7: Update balance sheet / reports

**Files:**
- Modify: `src/services/report.service.ts`
- Modify: `src/app/(app)/reports/balance-sheet/BalanceSheetClient.tsx`
- Modify: `src/app/(app)/reports/balance-sheet/page.tsx`

- [ ] **Step 1: Calculate per-location balances in `getBalanceSheetData` in `src/services/report.service.ts`**

Import `fundTransfers` at the top:

```typescript
import { fundTransfers } from "@/lib/db/schema/fund-transfers"
```

Inside the `getBalanceSheetData` function, after calculating `totalLoansOutstanding`, add per-location balance calculation.

The logic:
- For each location (cash, bank, strong_room):
  - **Add**: sum of payments where `depositLocation` = location (money came in)
  - **Subtract**: sum of loans where `disbursementSource` = location (money went out)
  - **Add**: sum of fund_transfers where `toLocation` = location (money transferred in)
  - **Subtract**: sum of fund_transfers where `fromLocation` = location (money transferred out)

Add this code block after the `totalLoansOutstanding` loop:

```typescript
      // Calculate per-location balances
      const locationBalances: Record<string, BigNumber> = {
        cash: new BigNumber(0),
        bank: new BigNumber(0),
        strong_room: new BigNumber(0),
      }

      // Payments received into each location (active payments only)
      const allPayments = await db
        .select({
          depositLocation: payments.depositLocation,
          amount: payments.amount,
        })
        .from(payments)
        .where(and(
          isNull(payments.deletedAt),
          lte(payments.createdAt, asOfDate)
        ))

      for (const p of allPayments) {
        const loc = p.depositLocation
        if (loc && locationBalances[loc] !== undefined) {
          locationBalances[loc] = locationBalances[loc].plus(new BigNumber(p.amount))
        }
      }

      // Disbursements from each location (all non-deleted loans)
      const allLoans = await db
        .select({
          disbursementSource: loans.disbursementSource,
          principalAmount: loans.principalAmount,
        })
        .from(loans)
        .where(and(
          isNull(loans.deletedAt),
          lte(loans.createdAt, asOfDate)
        ))

      for (const l of allLoans) {
        const loc = l.disbursementSource
        if (loc && locationBalances[loc] !== undefined) {
          locationBalances[loc] = locationBalances[loc].minus(new BigNumber(l.principalAmount))
        }
      }

      // Fund transfers between locations
      const allTransfers = await db
        .select()
        .from(fundTransfers)
        .where(lte(fundTransfers.createdAt, asOfDate))

      for (const t of allTransfers) {
        const amount = new BigNumber(t.amount)
        if (locationBalances[t.fromLocation] !== undefined) {
          locationBalances[t.fromLocation] = locationBalances[t.fromLocation].minus(amount)
        }
        if (locationBalances[t.toLocation] !== undefined) {
          locationBalances[t.toLocation] = locationBalances[t.toLocation].plus(amount)
        }
      }

      const cashBalance = locationBalances.cash
      const bankBalance = locationBalances.bank
      const strongRoomBalance = locationBalances.strong_room
      const totalAssets = totalLoansOutstanding.plus(cashBalance).plus(bankBalance).plus(strongRoomBalance)
```

Update the return statement to use the new `assets` shape:

```typescript
      return {
        asOf,
        assets: {
          cashBalance: formatAmount(cashBalance),
          bankBalance: formatAmount(bankBalance),
          strongRoomBalance: formatAmount(strongRoomBalance),
          totalLoansOutstanding: formatAmount(totalLoansOutstanding),
          totalAssets: formatAmount(totalAssets),
        },
        liabilities: {
          totalCreditorBalances: formatAmount(totalCreditorBalances),
        },
        equity: {
          shareCapital: formatAmount(shareCapital),
          retainedEarnings: formatAmount(retainedEarnings),
          totalEquity: formatAmount(totalEquity),
        },
      }
```

Update the balance check to use `totalAssets`:

```typescript
      const liabilitiesPlusEquity = totalCreditorBalances.plus(totalEquity)
      if (!totalAssets.isEqualTo(liabilitiesPlusEquity)) {
        console.warn(
          `Balance sheet imbalance: Assets=${formatAmount(totalAssets)}, ` +
            `Liabilities+Equity=${formatAmount(liabilitiesPlusEquity)} ` +
            `(diff=${formatAmount(totalAssets.minus(liabilitiesPlusEquity))})`
        )
      }
```

- [ ] **Step 2: Update `BalanceSheetClient.tsx` to show per-location breakdown**

Replace the Assets section in `BalanceSheetClient.tsx`:

```tsx
          {/* Assets */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Assets
            </h3>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-muted">
                  <td className="py-2 pl-4">Cash on Hand</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatCurrency(data.assets.cashBalance)}
                  </td>
                </tr>
                <tr className="border-b border-muted">
                  <td className="py-2 pl-4">Bank</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatCurrency(data.assets.bankBalance)}
                  </td>
                </tr>
                <tr className="border-b border-muted">
                  <td className="py-2 pl-4">Strong Room</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatCurrency(data.assets.strongRoomBalance)}
                  </td>
                </tr>
                <tr className="border-b border-muted">
                  <td className="py-2 pl-4">Loans Outstanding</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatCurrency(data.assets.totalLoansOutstanding)}
                  </td>
                </tr>
                <tr className="font-semibold bg-muted/30">
                  <td className="py-2 px-1">Total Assets</td>
                  <td className="py-2 px-1 text-right font-mono tabular-nums">
                    {formatCurrency(data.assets.totalAssets)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
```

Update the `totalLiabilitiesPlusEquity` calculation and the balance check section at the bottom to compare against `data.assets.totalAssets` instead of `data.assets.totalLoansOutstanding`.

- [ ] **Step 3: Update the fallback data shape in `src/app/(app)/reports/balance-sheet/page.tsx`**

Update the fallback `BalanceSheetData`:

```typescript
    : {
        asOf: period,
        assets: {
          cashBalance: "0",
          bankBalance: "0",
          strongRoomBalance: "0",
          totalLoansOutstanding: "0",
          totalAssets: "0",
        },
        liabilities: { totalCreditorBalances: "0" },
        equity: { shareCapital: "0", retainedEarnings: "0", totalEquity: "0" },
      }
```

---

## Task 8: Update test mocks

**Files:**
- Any existing test files that create payment or loan objects

- [ ] **Step 1: Find and update payment test mocks**

Search for test files that create payment objects (e.g. `{ loanId: ..., amount: ... }`) and add `depositLocation: "cash"` to each mock.

Key files to check:
- `src/services/__tests__/payment.service.test.ts` (if it exists)
- `cypress/support/commands.ts` or fixtures
- Any Vitest test that references `RecordPaymentInput`

- [ ] **Step 2: Find and update loan test mocks**

Search for test files that create loan objects and add `disbursementSource: "cash"` to each mock.

Key files to check:
- `src/services/__tests__/loan.service.test.ts` (if it exists)
- `cypress/e2e/loan-wizard.cy.ts`
- Any Vitest test that references `CreateLoanInput`

- [ ] **Step 3: Fix any TypeScript compilation errors**

Run `npx tsc --noEmit` and fix any remaining type errors caused by the new required fields.

---

## Task 9: Cypress E2E tests

**Files:**
- Create: `cypress/e2e/cash-management.cy.ts`

- [ ] **Step 1: Write E2E tests**

```typescript
describe("Cash Management", () => {
  beforeEach(() => {
    cy.login() // use existing auth helper
  })

  describe("Payment with deposit location", () => {
    it("shows deposit location dropdown on record payment form", () => {
      // Navigate to an active loan's payment form
      cy.visit("/loans")
      cy.get("table tbody tr").first().click()
      cy.contains("Record Payment").click()

      // Verify deposit location dropdown exists with correct options
      cy.get("#depositLocation").should("exist")
      cy.get("#depositLocation").click()
      cy.contains("Cash").should("be.visible")
      cy.contains("Bank").should("be.visible")
      cy.contains("Strong Room").should("be.visible")
    })

    it("defaults deposit location to Cash", () => {
      cy.visit("/loans")
      cy.get("table tbody tr").first().click()
      cy.contains("Record Payment").click()

      cy.get("#depositLocation").should("contain.text", "Cash")
    })
  })

  describe("Loan creation with disbursement source", () => {
    it("shows disbursement source dropdown in Step 1", () => {
      cy.visit("/loans/new?customerId=test-customer-id")

      cy.get("#disbursementSource").should("exist")
      cy.get("#disbursementSource").click()
      cy.contains("Cash").should("be.visible")
      cy.contains("Bank").should("be.visible")
      cy.contains("Strong Room").should("be.visible")
    })

    it("includes disbursement source in review step", () => {
      // Fill Step 1 fields and proceed to step 3
      // Verify disbursement source appears in review
      cy.visit("/loans/new?customerId=test-customer-id")
      cy.get("#principalAmount").type("1000000")
      cy.get("#disbursementSource").click()
      cy.contains("Bank").click()
      cy.contains("button", "Next").click()

      // Step 2: collateral
      cy.get("#collateralNature").type("Land Title")
      cy.contains("button", "Next").click()

      // Step 3: review
      cy.contains("Disbursement Source").should("be.visible")
      cy.contains("Bank").should("be.visible")
    })
  })

  describe("Fund transfers page", () => {
    it("renders fund transfers page from sidebar", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers").should("be.visible")
    })

    it("opens new transfer dialog", () => {
      cy.visit("/fund-transfers")
      cy.contains("button", "New Transfer").click()
      cy.contains("Record Fund Transfer").should("be.visible")
      cy.get("#fromLocation").should("exist")
      cy.get("#toLocation").should("exist")
      cy.get("#transferAmount").should("exist")
    })

    it("validates from and to must differ", () => {
      cy.visit("/fund-transfers")
      cy.contains("button", "New Transfer").click()

      // Set both to cash
      cy.get("#fromLocation").click()
      cy.get("[role=option]").contains("Cash").click()
      cy.get("#toLocation").click()
      cy.get("[role=option]").contains("Cash").click()

      cy.get("#transferAmount").type("100000")
      cy.contains("button", "Record Transfer").click()

      cy.contains("Source and destination must be different").should("be.visible")
    })

    it("sidebar has Fund Transfers link under Capital", () => {
      cy.visit("/dashboard")
      cy.get("[data-testid=sidebar-nav]").contains("Fund Transfers").should("be.visible")
    })
  })

  describe("Balance sheet per-location breakdown", () => {
    it("shows per-location asset rows", () => {
      cy.visit("/reports/balance-sheet")
      cy.contains("Cash on Hand").should("be.visible")
      cy.contains("Bank").should("be.visible")
      cy.contains("Strong Room").should("be.visible")
      cy.contains("Loans Outstanding").should("be.visible")
      cy.contains("Total Assets").should("be.visible")
    })
  })
})
```

- [ ] **Step 2: Run Cypress tests**

```bash
npx cypress run --spec cypress/e2e/cash-management.cy.ts
```

Fix any failures and re-run until all pass.
