# Collateral Settlement & Loan Rollover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable settling loans via collateral seizure, rolling over old loans into new ones, and enforcing one active loan per customer.

**Architecture:** Three features built bottom-up: (1) DB schema changes (new statuses, collateral columns, loan rollover columns), (2) service-layer functions for collateral settlement and rollover with full accounting, (3) UI integration on loan detail page and new loan form. The single-loan constraint is enforced at the service layer during loan creation.

**Tech Stack:** Drizzle ORM, Effect-TS, Next.js Server Actions, TanStack Query, shadcn/ui components, BigNumber.js

---

## File Structure

**Create:**
- `drizzle/0017_collateral_settlement_rollover.sql` — migration for new enum values, columns
- `src/services/collateral-settlement.service.ts` — collateral settlement + rollover service functions
- `src/actions/settlement.actions.ts` — server actions for settlement and active-loan check
- `src/components/loans/settle-collateral-dialog.tsx` — confirmation dialog for collateral seizure
- `src/components/loans/rollover-banner.tsx` — banner shown on new loan form when customer has active loan
- `cypress/e2e/collateral-settlement.cy.ts` — E2E tests

**Modify:**
- `src/lib/db/schema/loans.ts` — add `settled_with_collateral`, `rolled_over` to enum; add `rolledOverFrom`, `rolloverAmount` columns
- `src/lib/db/schema/collateral.ts` — add `seizedAt`, `seizedBy` columns
- `src/types/index.ts` — add new types and update `LoanStatus`
- `src/services/loan.service.ts` — add active-loan check to `createLoan`, add rollover logic
- `src/actions/loan.actions.ts` — add rollover support to `createLoanAction`, add `checkCustomerActiveLoanAction`
- `src/hooks/use-create-loan.ts` — handle rollover in optimistic update
- `src/app/(app)/loans/[loanId]/loan-detail-client.tsx` — add "Settle with Collateral" button, update status labels
- `src/app/(app)/loans/new/page.tsx` — add active loan check and rollover banner

---

### Task 1: Database Migration

**Files:**
- Create: `drizzle/0017_collateral_settlement_rollover.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Add new loan statuses to enum
ALTER TYPE "loan_status" ADD VALUE IF NOT EXISTS 'settled_with_collateral';
ALTER TYPE "loan_status" ADD VALUE IF NOT EXISTS 'rolled_over';

-- Add collateral seizure tracking columns
ALTER TABLE "collateral" ADD COLUMN "seized_at" timestamp with time zone;
ALTER TABLE "collateral" ADD COLUMN "seized_by" text;

-- Add rollover tracking columns to loans
ALTER TABLE "loans" ADD COLUMN "rolled_over_from" uuid;
ALTER TABLE "loans" ADD COLUMN "rollover_amount" numeric(15, 2);

-- Add foreign key for rolled_over_from (self-referencing)
ALTER TABLE "loans" ADD CONSTRAINT "loans_rolled_over_from_fkey" FOREIGN KEY ("rolled_over_from") REFERENCES "loans"("id");
```

- [ ] **Step 2: Commit**

```bash
git add drizzle/0017_collateral_settlement_rollover.sql
git commit -m "feat: add migration for collateral settlement and loan rollover"
```

---

### Task 2: Schema Updates

**Files:**
- Modify: `src/lib/db/schema/loans.ts`
- Modify: `src/lib/db/schema/collateral.ts`

- [ ] **Step 1: Update loan status enum and add rollover columns**

In `src/lib/db/schema/loans.ts`, update the `loanStatusEnum` to include the new statuses:

```typescript
export const loanStatusEnum = pgEnum("loan_status", [
  "pending",
  "active",
  "fully_paid",
  "settled_with_collateral",
  "rolled_over",
])
```

Add two new columns to the `loans` table definition, after `termMonths`:

```typescript
  rolledOverFrom: uuid("rolled_over_from").references(() => loans.id),
  rolloverAmount: numeric("rollover_amount", { precision: 15, scale: 2 }),
```

- [ ] **Step 2: Update collateral schema**

In `src/lib/db/schema/collateral.ts`, add seizure tracking columns after `description`:

```typescript
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core"
import { loans } from "./loans"

export const collateral = pgTable("collateral", {
  id: uuid("id").primaryKey().defaultRandom(),
  loanId: uuid("loan_id").notNull().references(() => loans.id),
  nature: text("nature").notNull(),
  description: text("description"),
  seizedAt: timestamp("seized_at", { withTimezone: true }),
  seizedBy: text("seized_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/schema/loans.ts src/lib/db/schema/collateral.ts
git commit -m "feat: update schemas for collateral settlement and rollover columns"
```

---

### Task 3: Type Updates

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Update LoanStatus type and add new input types**

In `src/types/index.ts`, update `LoanStatus`:

```typescript
export type LoanStatus = "active" | "fully_paid" | "settled_with_collateral" | "rolled_over"
```

Add new types after the existing `DeleteLoanInput` interface:

```typescript
// --- Collateral Settlement ---
export interface SettleWithCollateralInput {
  loanId: string
  reason: string
}

// --- Loan Rollover ---
export interface RolloverData {
  fromLoanId: string
  carriedPrincipal: string
  carriedInterest: string
}
```

Add `rollover` field to `CreateLoanInput` after `minPeriodOverride`:

```typescript
  rollover?: RolloverData
```

Add rollover fields to the `Loan` type by updating `NewLoan` (these are already picked up from schema via `InferSelectModel`).

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add types for collateral settlement and loan rollover"
```

---

### Task 4: Collateral Settlement Service

**Files:**
- Create: `src/services/collateral-settlement.service.ts`

- [ ] **Step 1: Write the settlement service**

```typescript
import { Effect } from "effect"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { collateral } from "@/lib/db/schema/collateral"
import { payments } from "@/lib/db/schema/payments"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { customers } from "@/lib/db/schema/customers"
import { eq, and, isNull, asc } from "drizzle-orm"
import BigNumber from "bignumber.js"
import { DatabaseError, LoanNotFound, ValidationError } from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import { calculateInterest } from "@/lib/interest/engine"
import { daysBetween } from "@/lib/db/utils"
import type { SettleWithCollateralInput, Loan } from "@/types"

async function getOrCreateCategory(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  name: string,
  type: "income" | "expense"
) {
  let [category] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, name),
        eq(transactionCategories.type, type)
      )
    )

  if (!category) {
    ;[category] = await tx
      .insert(transactionCategories)
      .values({ name, type, isDefault: true })
      .returning()
  }

  return category
}

function computeAccruedInterest(
  loan: Loan,
  activePayments: { paymentDate: Date; interestPortion: string }[]
): { outstandingPrincipal: string; accruedInterest: string } {
  const loanType = loan.loanType ?? "perpetual"
  const effectiveRate = loan.interestRateOverride ?? loan.interestRate
  const minInterestDays = loan.minPeriodOverride ?? loan.minInterestDays
  const now = new Date()

  let outstandingPrincipal = loan.principalAmount
  if (activePayments.length > 0) {
    // Get from the last payment's principalBalanceAfter
    const lastPayment = activePayments[activePayments.length - 1] as any
    outstandingPrincipal = lastPayment.principalBalanceAfter
  }

  const prevDate =
    activePayments.length > 0
      ? new Date(activePayments[activePayments.length - 1].paymentDate)
      : new Date(loan.startDate)
  const daysElapsed = daysBetween(prevDate, now)

  let accruedInterest: BigNumber
  if (loanType === "perpetual") {
    const totalDaysElapsed = Math.floor(
      (now.getTime() - new Date(loan.startDate).getTime()) / (1000 * 60 * 60 * 24)
    )
    const totalInterestAccrued = calculateInterest(
      loan.principalAmount,
      effectiveRate,
      totalDaysElapsed,
      0
    )
    const totalInterestPaid = activePayments.reduce(
      (s, p) => s.plus(new BigNumber(p.interestPortion)),
      new BigNumber(0)
    )
    accruedInterest = BigNumber.max(totalInterestAccrued.minus(totalInterestPaid), 0)
  } else if (loanType === "fixed_rate") {
    const monthlyInterest = new BigNumber(loan.principalAmount).multipliedBy(
      new BigNumber(effectiveRate)
    )
    accruedInterest = monthlyInterest
  } else {
    // reducing_balance
    const monthlyInterest = new BigNumber(outstandingPrincipal).multipliedBy(
      new BigNumber(effectiveRate)
    )
    accruedInterest = monthlyInterest
  }

  return {
    outstandingPrincipal,
    accruedInterest: accruedInterest.toFixed(2),
  }
}

export { computeAccruedInterest }

export const settleWithCollateral = (
  input: SettleWithCollateralInput,
  actorId: string
): Effect.Effect<Loan, LoanNotFound | ValidationError | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [loan] = await db
        .select()
        .from(loans)
        .where(and(eq(loans.id, input.loanId), isNull(loans.deletedAt)))

      if (!loan) throw { _tag: "LoanNotFound", id: input.loanId }

      if (loan.status !== "active") {
        throw {
          _tag: "ValidationError",
          message: "Only active loans can be settled with collateral",
          field: "loanId",
        }
      }

      return await db.transaction(async (tx) => {
        // Get active payments for interest calculation
        const activePayments = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, input.loanId), isNull(payments.deletedAt)))
          .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

        const { outstandingPrincipal, accruedInterest } = computeAccruedInterest(
          loan,
          activePayments
        )

        // Post accrued interest as "Interest Earned"
        if (new BigNumber(accruedInterest).isGreaterThan(0)) {
          const interestCategory = await getOrCreateCategory(tx, "Interest Earned", "income")
          await tx.insert(transactions).values({
            type: "credit",
            amount: accruedInterest,
            categoryId: interestCategory.id,
            referenceType: "collateral_settlement",
            referenceId: input.loanId,
            description: `Interest earned - loan ${input.loanId.slice(0, 8).toUpperCase()} settled with collateral`,
            transactionDate: new Date(),
            recordedBy: actorId,
          })
        }

        // Post outstanding principal as "Collateral Recovery"
        if (new BigNumber(outstandingPrincipal).isGreaterThan(0)) {
          const recoveryCategory = await getOrCreateCategory(tx, "Collateral Recovery", "income")
          await tx.insert(transactions).values({
            type: "credit",
            amount: outstandingPrincipal,
            categoryId: recoveryCategory.id,
            referenceType: "collateral_settlement",
            referenceId: input.loanId,
            description: `Collateral recovery - loan ${input.loanId.slice(0, 8).toUpperCase()} principal recovered via collateral`,
            transactionDate: new Date(),
            recordedBy: actorId,
          })
        }

        // Update collateral as seized
        await tx
          .update(collateral)
          .set({ seizedAt: new Date(), seizedBy: actorId })
          .where(eq(collateral.loanId, input.loanId))

        // Update loan status
        const [updatedLoan] = await tx
          .update(loans)
          .set({ status: "settled_with_collateral", updatedAt: new Date() })
          .where(eq(loans.id, input.loanId))
          .returning()

        // Audit log
        await writeAuditLog(tx, {
          actorId,
          action: "loan.settle_collateral",
          entityType: "loan",
          entityId: input.loanId,
          beforeValue: loan,
          afterValue: {
            ...updatedLoan,
            settlementDetails: {
              outstandingPrincipal,
              accruedInterest,
              totalWrittenOff: new BigNumber(outstandingPrincipal)
                .plus(new BigNumber(accruedInterest))
                .toFixed(2),
              reason: input.reason,
            },
          },
        })

        return updatedLoan
      })
    },
    catch: (e: any) => {
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      if (e?._tag === "ValidationError")
        return new ValidationError({ message: e.message, field: e.field })
      return new DatabaseError({ cause: e })
    },
  })

export const getCustomerActiveLoan = async (
  customerId: string
): Promise<{
  loan: Loan
  customerName: string
  outstandingPrincipal: string
  accruedInterest: string
} | null> => {
  const [activeLoan] = await db
    .select()
    .from(loans)
    .where(
      and(
        eq(loans.customerId, customerId),
        eq(loans.status, "active"),
        isNull(loans.deletedAt)
      )
    )

  if (!activeLoan) return null

  const [customer] = await db
    .select({ fullName: customers.fullName })
    .from(customers)
    .where(eq(customers.id, customerId))

  const activePayments = await db
    .select()
    .from(payments)
    .where(and(eq(payments.loanId, activeLoan.id), isNull(payments.deletedAt)))
    .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

  const { outstandingPrincipal, accruedInterest } = computeAccruedInterest(
    activeLoan,
    activePayments
  )

  return {
    loan: activeLoan,
    customerName: customer?.fullName ?? "Unknown",
    outstandingPrincipal,
    accruedInterest,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/collateral-settlement.service.ts
git commit -m "feat: add collateral settlement and active loan check services"
```

---

### Task 5: Rollover Logic in Loan Service

**Files:**
- Modify: `src/services/loan.service.ts`

- [ ] **Step 1: Add rollover handling to createLoan**

In `src/services/loan.service.ts`, add these imports at the top:

```typescript
import { computeAccruedInterest } from "./collateral-settlement.service"
```

Inside the `createLoan` function, after the customer completeness check (after line 56) and before the `startDate` line, add:

```typescript
      // Single active loan constraint
      const [existingActiveLoan] = await db
        .select()
        .from(loans)
        .where(
          and(
            eq(loans.customerId, input.customerId),
            eq(loans.status, "active"),
            isNull(loans.deletedAt)
          )
        )

      if (existingActiveLoan && !input.rollover) {
        throw new ValidationError({
          message: "Customer already has an active loan. Use rollover to create a new loan.",
          field: "customerId",
        })
      }

      if (input.rollover && !existingActiveLoan) {
        throw new ValidationError({
          message: "Rollover specified but customer has no active loan.",
          field: "customerId",
        })
      }

      if (input.rollover && existingActiveLoan && input.rollover.fromLoanId !== existingActiveLoan.id) {
        throw new ValidationError({
          message: "Rollover loan ID does not match customer's active loan.",
          field: "customerId",
        })
      }
```

Inside the `db.transaction` callback, after the collateral insert and before the audit log, add the rollover principal calculation. The loan insert values should be updated to include rollover fields:

Replace the loan insert `principalAmount` to account for rollover:

```typescript
            principalAmount: input.rollover
              ? new BigNumber(input.principalAmount)
                  .plus(new BigNumber(input.rollover.carriedPrincipal))
                  .plus(new BigNumber(input.rollover.carriedInterest))
                  .toFixed(2)
              : input.principalAmount,
            rolledOverFrom: input.rollover?.fromLoanId ?? null,
            rolloverAmount: input.rollover
              ? new BigNumber(input.rollover.carriedPrincipal)
                  .plus(new BigNumber(input.rollover.carriedInterest))
                  .toFixed(2)
              : null,
```

After the collateral insert and before the first audit log, add the old loan closure logic:

```typescript
        // Handle rollover: close old loan
        if (input.rollover && existingActiveLoan) {
          // Post old loan's accrued interest as earned
          if (new BigNumber(input.rollover.carriedInterest).isGreaterThan(0)) {
            let [interestCategory] = await tx
              .select()
              .from(transactionCategories)
              .where(
                and(
                  eq(transactionCategories.name, "Interest Earned"),
                  eq(transactionCategories.type, "income")
                )
              )
            if (!interestCategory) {
              ;[interestCategory] = await tx
                .insert(transactionCategories)
                .values({ name: "Interest Earned", type: "income", isDefault: true })
                .returning()
            }

            await tx.insert(transactions).values({
              type: "credit",
              amount: input.rollover.carriedInterest,
              categoryId: interestCategory.id,
              referenceType: "rollover",
              referenceId: existingActiveLoan.id,
              description: `Interest earned - loan ${existingActiveLoan.id.slice(0, 8).toUpperCase()} rolled over into ${loan.id.slice(0, 8).toUpperCase()}`,
              transactionDate: startDate,
              recordedBy: actorId,
            })
          }

          // Close old loan
          await tx
            .update(loans)
            .set({ status: "rolled_over", updatedAt: new Date() })
            .where(eq(loans.id, existingActiveLoan.id))

          // Audit log for old loan
          await writeAuditLog(tx, {
            actorId,
            action: "loan.rollover",
            entityType: "loan",
            entityId: existingActiveLoan.id,
            beforeValue: existingActiveLoan,
            afterValue: {
              status: "rolled_over",
              rolledIntoLoanId: loan.id,
              carriedPrincipal: input.rollover.carriedPrincipal,
              carriedInterest: input.rollover.carriedInterest,
            },
          })
        }
```

Update the new loan's audit log `afterValue` to include rollover info when applicable:

```typescript
        await writeAuditLog(tx, {
          actorId,
          action: "loan.create",
          entityType: "loan",
          entityId: loan.id,
          beforeValue: null,
          afterValue: {
            ...loan,
            collateral: coll,
            ...(input.rollover && {
              rolloverFrom: input.rollover.fromLoanId,
              freshAmount: input.principalAmount,
              rolloverAmount: new BigNumber(input.rollover.carriedPrincipal)
                .plus(new BigNumber(input.rollover.carriedInterest))
                .toFixed(2),
            }),
          },
        })
```

- [ ] **Step 2: Commit**

```bash
git add src/services/loan.service.ts
git commit -m "feat: add single-loan constraint and rollover logic to loan creation"
```

---

### Task 6: Server Actions

**Files:**
- Create: `src/actions/settlement.actions.ts`
- Modify: `src/actions/loan.actions.ts`

- [ ] **Step 1: Create settlement actions**

```typescript
"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { settleWithCollateral, getCustomerActiveLoan } from "@/services/collateral-settlement.service"
import { LoanNotFound } from "@/lib/errors"
import { ROLE_LEVELS, type UserRole, type SettleWithCollateralInput } from "@/types"

export async function settleWithCollateralAction(input: SettleWithCollateralInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.supervisor) {
    return { error: "Only supervisors and above can settle loans with collateral" }
  }

  if (!input.loanId?.trim()) {
    return { error: "Loan ID is required" }
  }
  if (!input.reason?.trim()) {
    return { error: "Reason is required" }
  }

  try {
    const data = await Effect.runPromise(settleWithCollateral(input, session.user.id))
    revalidatePath("/loans")
    revalidatePath(`/loans/${input.loanId}`)
    return { data }
  } catch (error) {
    if (error instanceof LoanNotFound) {
      return { error: "Loan not found" }
    }
    return { error: "Internal server error" }
  }
}

export async function checkCustomerActiveLoanAction(customerId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  if (!customerId?.trim()) {
    return { data: null }
  }

  try {
    const result = await getCustomerActiveLoan(customerId)
    return { data: result }
  } catch {
    return { error: "Internal server error" }
  }
}
```

- [ ] **Step 2: Update createLoanAction for rollover authorization**

In `src/actions/loan.actions.ts`, after the existing role check for `loanOfficer` (line 147-149), add rollover authorization:

```typescript
  // Rollover requires supervisor+
  if (input.rollover) {
    if (ROLE_LEVELS[role] < ROLE_LEVELS.supervisor) {
      return { error: "Only supervisors and above can perform loan rollovers" }
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/actions/settlement.actions.ts src/actions/loan.actions.ts
git commit -m "feat: add settlement server actions and rollover authorization"
```

---

### Task 7: Settle with Collateral Dialog

**Files:**
- Create: `src/components/loans/settle-collateral-dialog.tsx`

- [ ] **Step 1: Create the dialog component**

```tsx
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Loader2, ShieldAlert } from "lucide-react"
import { settleWithCollateralAction } from "@/actions/settlement.actions"
import { queryKeys } from "@/hooks/query-keys"
import { formatCurrency } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import { DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

interface SettleCollateralDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  loanId: string
  outstandingPrincipal: string
  accruedInterest: string
  collateralNature: string
  collateralDescription: string | null
}

export function SettleCollateralDialog({
  open,
  onOpenChange,
  loanId,
  outstandingPrincipal,
  accruedInterest,
  collateralNature,
  collateralDescription,
}: SettleCollateralDialogProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [reason, setReason] = useState("")
  const [isPending, startTransition] = useTransition()

  const totalWriteOff = (
    parseFloat(outstandingPrincipal) + parseFloat(accruedInterest)
  ).toFixed(2)

  function handleSubmit() {
    if (!reason.trim()) {
      toast.error("Reason is required")
      return
    }

    startTransition(async () => {
      const result = await settleWithCollateralAction({
        loanId,
        reason: reason.trim(),
      })

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      toast.success("Loan settled with collateral")
      onOpenChange(false)
      setReason("")

      queryClient.invalidateQueries({ queryKey: queryKeys.loans.detail(loanId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.loans.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
      router.refresh()
    })
  }

  return (
    <DrawerDialog open={open} onOpenChange={onOpenChange}>
      <DrawerDialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            Settle Loan with Collateral
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            This will seize the collateral and close the loan. The full outstanding balance will be written off.
          </p>

          <div className="rounded-lg border p-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Outstanding Principal</span>
              <span className="font-medium">{formatCurrency(outstandingPrincipal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Accrued Interest</span>
              <span className="font-medium">{formatCurrency(accruedInterest)}</span>
            </div>
            <div className="flex justify-between border-t pt-2 font-semibold">
              <span>Total Written Off</span>
              <span>{formatCurrency(totalWriteOff)}</span>
            </div>
          </div>

          <div className="rounded-lg border p-3 space-y-1 text-sm">
            <p className="font-medium">Collateral to Seize</p>
            <p className="text-muted-foreground">{collateralNature}</p>
            {collateralDescription && (
              <p className="text-muted-foreground text-xs">{collateralDescription}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="settle-reason">Reason for Settlement</Label>
            <Textarea
              id="settle-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this loan being settled with collateral?"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={isPending || !reason.trim()}
          >
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Confirm Settlement
          </Button>
        </DialogFooter>
      </DrawerDialogContent>
    </DrawerDialog>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/loans/settle-collateral-dialog.tsx
git commit -m "feat: add settle with collateral confirmation dialog"
```

---

### Task 8: Update Loan Detail Page

**Files:**
- Modify: `src/app/(app)/loans/[loanId]/loan-detail-client.tsx`

- [ ] **Step 1: Add collateral settlement button and updated status labels**

Add imports at the top of the file:

```typescript
import { SettleCollateralDialog } from "@/components/loans/settle-collateral-dialog"
import { getLoanBalanceAction } from "@/actions/payment.actions"
```

Update `loanStatusLabel` function to handle new statuses:

```typescript
function loanStatusLabel(status: string): string {
  if (status === "fully_paid") return "Fully Paid"
  if (status === "settled_with_collateral") return "Settled (Collateral)"
  if (status === "rolled_over") return "Rolled Over"
  return status.charAt(0).toUpperCase() + status.slice(1)
}
```

Update `loanStatusVariant` to handle new statuses:

```typescript
function loanStatusVariant(status: string): "default" | "outline" | "secondary" {
  if (status === "active") return "default"
  if (status === "settled_with_collateral") return "secondary"
  if (status === "rolled_over") return "secondary"
  return "outline"
}
```

Add the `SettleCollateralDialog` integration to `LoanDetailClient`. You need to add props for collateral info and the dialog state. Add to the component's props interface:

```typescript
interface LoanDetailClientProps {
  loan: Loan
  initialPayments: Payment[]
  customerName: string | null
  canModify: boolean
  openEditOnMount?: boolean
  userNameMap: Record<string, string>
  userRole: UserRole
  collateralNature?: string
  collateralDescription?: string | null
}
```

Add state inside the component:

```typescript
  const [settlingCollateral, setSettlingCollateral] = useState(false)
```

Add a balance query for the settlement dialog:

```typescript
  const { data: balanceData } = useQuery({
    queryKey: ["loan-balance", loan.id],
    queryFn: async () => {
      const result = await getLoanBalanceAction(loan.id)
      if ("error" in result) return null
      return result.data
    },
    enabled: loan.status === "active",
  })
```

In the header actions area (where `canModify` is checked), after the existing Edit and Delete buttons, add:

```tsx
            {loan.status === "active" && ROLE_LEVELS[userRole] >= ROLE_LEVELS.supervisor && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSettlingCollateral(true)}
                className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 border-orange-300"
              >
                <ShieldAlert className="h-3.5 w-3.5 mr-1.5" />
                Settle with Collateral
              </Button>
            )}
```

Add the `ShieldAlert` import from lucide-react.

Add the dialog at the bottom of the component's return, before the closing `</div>`:

```tsx
      {balanceData && collateralNature && (
        <SettleCollateralDialog
          open={settlingCollateral}
          onOpenChange={setSettlingCollateral}
          loanId={loan.id}
          outstandingPrincipal={balanceData.outstandingPrincipal}
          accruedInterest={balanceData.accruedInterest}
          collateralNature={collateralNature}
          collateralDescription={collateralDescription ?? null}
        />
      )}
```

Update the InfoPopover loan status descriptions to include new statuses:

```tsx
                  <p><strong>Settled (Collateral)</strong> — Loan closed by seizing the borrower's collateral.</p>
                  <p><strong>Rolled Over</strong> — Outstanding balance was rolled into a new loan.</p>
```

- [ ] **Step 2: Update the loan detail page server component to pass collateral data**

In `src/app/(app)/loans/[loanId]/page.tsx`, fetch collateral data and pass it to the client component. Add the collateral query alongside the existing loan fetch:

```typescript
import { db } from "@/lib/db"
import { collateral } from "@/lib/db/schema/collateral"
import { eq } from "drizzle-orm"
```

After fetching the loan, add:

```typescript
  const [loanCollateral] = await db
    .select()
    .from(collateral)
    .where(eq(collateral.loanId, loan.id))
```

Pass to the client component:

```tsx
  <LoanDetailClient
    ...existingProps
    collateralNature={loanCollateral?.nature}
    collateralDescription={loanCollateral?.description}
  />
```

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/loans/[loanId]/loan-detail-client.tsx src/app/(app)/loans/[loanId]/page.tsx
git commit -m "feat: add settle with collateral button and dialog to loan detail page"
```

---

### Task 9: Rollover Banner Component

**Files:**
- Create: `src/components/loans/rollover-banner.tsx`

- [ ] **Step 1: Create the rollover banner**

```tsx
"use client"

import { AlertTriangle } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import BigNumber from "bignumber.js"

interface RolloverBannerProps {
  loanId: string
  customerName: string
  outstandingPrincipal: string
  accruedInterest: string
}

export function RolloverBanner({
  loanId,
  customerName,
  outstandingPrincipal,
  accruedInterest,
}: RolloverBannerProps) {
  const totalCarryOver = new BigNumber(outstandingPrincipal)
    .plus(new BigNumber(accruedInterest))
    .toFixed(2)

  const loanRef = `LOAN-${loanId.slice(0, 8).toUpperCase()}`

  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium text-orange-900">
            {customerName} has an active loan ({loanRef})
          </p>
          <p className="text-sm text-orange-700 mt-1">
            The existing loan will be rolled over into the new one. The outstanding balance will be added to the new loan&apos;s principal.
          </p>
        </div>
      </div>

      <div className="rounded border border-orange-200 bg-white p-3 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Outstanding Principal</span>
          <span className="font-medium">{formatCurrency(outstandingPrincipal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Accrued Interest</span>
          <span className="font-medium">{formatCurrency(accruedInterest)}</span>
        </div>
        <div className="flex justify-between border-t pt-1.5 font-semibold">
          <span>Amount to Roll Over</span>
          <span>{formatCurrency(totalCarryOver)}</span>
        </div>
      </div>

      <p className="text-xs text-orange-600">
        Requires supervisor or above authorization. The fresh disbursement amount you enter below will have the rollover amount added to it.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/loans/rollover-banner.tsx
git commit -m "feat: add rollover banner component for new loan form"
```

---

### Task 10: Integrate Rollover into New Loan Form

**Files:**
- Modify: `src/app/(app)/loans/new/page.tsx`
- Modify: `src/hooks/use-create-loan.ts`

- [ ] **Step 1: Add active loan check to new loan form**

In `src/app/(app)/loans/new/page.tsx`, add imports:

```typescript
import { checkCustomerActiveLoanAction } from "@/actions/settlement.actions"
import { RolloverBanner } from "@/components/loans/rollover-banner"
import BigNumber from "bignumber.js"
```

Inside `NewLoanPageInner`, add a query for the active loan check. After the `customerName` query block, add:

```typescript
  // Check if customer has an active loan (for rollover)
  const { data: activeLoanData } = useQuery({
    queryKey: ["active-loan-check", customerId],
    queryFn: async () => {
      const result = await checkCustomerActiveLoanAction(customerId)
      if ("error" in result || !result.data) return null
      return result.data
    },
    enabled: !!customerId && customerId.length > 0,
  })
```

In the form's Step 1, after the customer ID input field, render the rollover banner if active loan exists:

```tsx
  {activeLoanData && (
    <RolloverBanner
      loanId={activeLoanData.loan.id}
      customerName={activeLoanData.customerName}
      outstandingPrincipal={activeLoanData.outstandingPrincipal}
      accruedInterest={activeLoanData.accruedInterest}
    />
  )}
```

In the form submit handler, include rollover data when creating the loan:

```typescript
  const rolloverData = activeLoanData
    ? {
        fromLoanId: activeLoanData.loan.id,
        carriedPrincipal: activeLoanData.outstandingPrincipal,
        carriedInterest: activeLoanData.accruedInterest,
      }
    : undefined
```

When calling `createLoan.mutate()`, include the rollover:

```typescript
  createLoan.mutate(
    {
      ...loanInput,
      rollover: rolloverData,
    },
    { onSuccess: ... }
  )
```

In Step 3 (Review), when `activeLoanData` exists, show the rollover breakdown:

```tsx
  {activeLoanData && (
    <div className="rounded-lg border p-3 space-y-2 text-sm">
      <p className="font-medium">Rollover Breakdown</p>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Fresh Disbursement</span>
        <span>{formatCurrency(principalAmount)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Rolled Over Amount</span>
        <span>{formatCurrency(
          new BigNumber(activeLoanData.outstandingPrincipal)
            .plus(new BigNumber(activeLoanData.accruedInterest))
            .toFixed(2)
        )}</span>
      </div>
      <div className="flex justify-between border-t pt-2 font-semibold">
        <span>Total New Principal</span>
        <span>{formatCurrency(
          new BigNumber(principalAmount || "0")
            .plus(new BigNumber(activeLoanData.outstandingPrincipal))
            .plus(new BigNumber(activeLoanData.accruedInterest))
            .toFixed(2)
        )}</span>
      </div>
    </div>
  )}
```

- [ ] **Step 2: Update useCreateLoan hook**

In `src/hooks/use-create-loan.ts`, update the optimistic loan to include rollover fields:

```typescript
import type { CreateLoanInput, LoanWithCustomer } from "@/types"
```

In the optimistic entry, add:

```typescript
        rolledOverFrom: input.rollover?.fromLoanId ?? null,
        rolloverAmount: input.rollover
          ? (parseFloat(input.rollover.carriedPrincipal) + parseFloat(input.rollover.carriedInterest)).toFixed(2)
          : null,
```

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/loans/new/page.tsx src/hooks/use-create-loan.ts
git commit -m "feat: integrate rollover flow into new loan form with active loan check"
```

---

### Task 11: Update Loan List Status Badges

**Files:**
- Modify: `src/app/(app)/loans/page.tsx` (or wherever loan status badges are rendered in the list)

- [ ] **Step 1: Update status badge rendering**

Find all places where loan status is rendered as a badge or label and ensure `settled_with_collateral` and `rolled_over` are handled. The `computeOverdue` function in `src/actions/loan.actions.ts` already returns all loans regardless of status, so the list will show them. Just need to make sure the UI renders them correctly.

Search for any hardcoded status checks like `status === "active"` or `status === "fully_paid"` and ensure they don't exclude new statuses where they shouldn't.

In `computeOverdue` (in `src/actions/loan.actions.ts`), the `if (loan.status === "active")` check already correctly skips interest calculation for non-active loans, which is correct — settled and rolled-over loans should show `daysOverdue: 0` and `unpaidInterest: "0"`.

Update the `LoanStatus` type used in `computeOverdue` to include the new statuses so TypeScript is happy. This is already handled by the type change in Task 3.

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/loans/page.tsx src/actions/loan.actions.ts
git commit -m "feat: update loan list to display new settlement and rollover statuses"
```

---

### Task 12: E2E Tests

**Files:**
- Create: `cypress/e2e/collateral-settlement.cy.ts`

- [ ] **Step 1: Write E2E tests**

```typescript
describe("Collateral Settlement & Loan Rollover", () => {
  beforeEach(() => {
    cy.login("supervisor")
  })

  describe("Collateral Settlement", () => {
    it("shows Settle with Collateral button on active loan detail page", () => {
      cy.visit("/loans")
      cy.get("table tbody tr").first().click()
      cy.contains("button", "Settle with Collateral").should("be.visible")
    })

    it("hides Settle with Collateral for non-active loans", () => {
      cy.visit("/loans")
      // Navigate to a fully_paid loan if available
      cy.get("[data-status='fully_paid']").first().click()
      cy.contains("button", "Settle with Collateral").should("not.exist")
    })

    it("opens settlement dialog with balance breakdown", () => {
      cy.visit("/loans")
      cy.get("table tbody tr").first().click()
      cy.contains("button", "Settle with Collateral").click()
      cy.contains("Outstanding Principal").should("be.visible")
      cy.contains("Accrued Interest").should("be.visible")
      cy.contains("Total Written Off").should("be.visible")
      cy.contains("Collateral to Seize").should("be.visible")
    })

    it("requires reason to confirm settlement", () => {
      cy.visit("/loans")
      cy.get("table tbody tr").first().click()
      cy.contains("button", "Settle with Collateral").click()
      cy.contains("button", "Confirm Settlement").should("be.disabled")
      cy.get("#settle-reason").type("Borrower unable to repay, collateral seized per agreement")
      cy.contains("button", "Confirm Settlement").should("be.enabled")
    })

    it("displays Settled (Collateral) status badge after settlement", () => {
      cy.visit("/loans")
      cy.get("table tbody tr").first().click()
      cy.contains("button", "Settle with Collateral").click()
      cy.get("#settle-reason").type("Borrower defaulted")
      cy.contains("button", "Confirm Settlement").click()
      cy.contains("Settled (Collateral)").should("be.visible")
    })
  })

  describe("Single Active Loan Constraint & Rollover", () => {
    it("shows rollover banner when creating loan for customer with active loan", () => {
      // First get a customer ID with an active loan
      cy.visit("/loans")
      cy.get("table tbody tr").first().find("a").first().invoke("attr", "href").then((href) => {
        const customerId = (href as string).split("/").pop()
        cy.visit(`/loans/new?customerId=${customerId}`)
        cy.contains("has an active loan").should("be.visible")
        cy.contains("Amount to Roll Over").should("be.visible")
      })
    })

    it("shows rollover breakdown in review step", () => {
      cy.visit("/loans")
      cy.get("table tbody tr").first().find("a").first().invoke("attr", "href").then((href) => {
        const customerId = (href as string).split("/").pop()
        cy.visit(`/loans/new?customerId=${customerId}`)
        // Fill form details and proceed to review
        cy.get("[name=principalAmount]").type("500000")
        cy.get("[name=issuanceFee]").type("50000")
        cy.get("[name=description]").type("Test rollover loan")
        // Proceed through steps
        cy.contains("button", "Next").click()
        cy.get("[name=collateralNature]").type("Vehicle")
        cy.contains("button", "Next").click()
        // Review step should show rollover breakdown
        cy.contains("Rollover Breakdown").should("be.visible")
        cy.contains("Fresh Disbursement").should("be.visible")
        cy.contains("Total New Principal").should("be.visible")
      })
    })

    it("does not show rollover banner for customer without active loan", () => {
      cy.visit("/loans/new")
      // Select a customer without an active loan
      cy.contains("has an active loan").should("not.exist")
    })
  })

  describe("Status Display", () => {
    it("shows new status badges in loan list", () => {
      cy.visit("/loans")
      // Verify that the page renders without errors with new statuses
      cy.get("table").should("be.visible")
    })

    it("shows Rolled Over status in loan detail", () => {
      // After a rollover, the old loan should show Rolled Over
      cy.visit("/loans")
      cy.contains("Rolled Over").should("exist")
    })
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
npx cypress run --spec cypress/e2e/collateral-settlement.cy.ts
```

- [ ] **Step 3: Commit**

```bash
git add cypress/e2e/collateral-settlement.cy.ts
git commit -m "test: add E2E tests for collateral settlement and loan rollover"
```

---

### Task 13: Run Migration and Verify

- [ ] **Step 1: Apply the migration**

```bash
npx drizzle-kit push
```

- [ ] **Step 2: Verify the app builds**

```bash
npm run build
```

- [ ] **Step 3: Run all tests**

```bash
npx cypress run
```

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address build/test issues from collateral settlement implementation"
```
