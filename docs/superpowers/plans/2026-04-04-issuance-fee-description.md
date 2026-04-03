# Loan Issuance Fee & Required Description

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a required issuance fee (minimum 50,000 UGX) and required description field to loans, visible on forms, detail pages, receipts, and income reports.

**Architecture:** Two new columns on the loans table (issuanceFee, description). Form changes in loan creation step 1. Fee recorded as income transaction on loan creation. Displayed on loan detail and receipts.

**Tech Stack:** Next.js, Drizzle ORM, React Hook Form, TanStack Query, shadcn/ui

---

## Files to Modify

| File | Changes |
|---|---|
| `src/lib/db/schema/loans.ts` | Add `issuanceFee` and `description` columns |
| `src/types/index.ts` | Add fields to `CreateLoanInput`, `UpdateLoanInput` |
| `src/actions/loan.actions.ts` | Validate issuanceFee and description in `createLoanAction` |
| `src/services/loan.service.ts` | Include new fields in insert + auto-post fee as income transaction |
| `src/app/(app)/loans/new/page.tsx` | Add issuanceFee and description inputs to form |
| `src/hooks/use-create-loan.ts` | Add new fields to optimistic `LoanWithCustomer` object |
| `src/app/(app)/loans/[loanId]/loan-detail-client.tsx` | Display issuance fee and description |
| `src/app/(app)/receipts/disbursement/[loanId]/page.tsx` | Show fee and description on receipt |
| `src/services/__tests__/loan.service.test.ts` | Add new fields to test mocks |
| `src/services/__integration__/loan.service.test.ts` | Add new fields to test inputs |
| `src/services/__integration__/payment.service.test.ts` | Add new fields to loan creation helpers |
| `src/services/__integration__/report.service.test.ts` | Add new fields to loan creation helpers |
| `src/services/__integration__/notification.service.test.ts` | Add new fields to loan creation helpers |
| `src/services/__integration__/dashboard.service.test.ts` | Add new fields to loan creation helpers |
| `src/services/__integration__/daily-collections.service.test.ts` | Add new fields to loan creation helpers |
| `cypress/e2e/loan-wizard.cy.ts` | Add issuance fee and description to existing tests, add new validation tests |

---

## Task 1: Add schema columns

- [ ] Modify `src/lib/db/schema/loans.ts` to add two new columns
- [ ] Generate and push migration

### Code

**`src/lib/db/schema/loans.ts`** — full file after changes:

```typescript
import { pgTable, uuid, numeric, integer, timestamp, text, pgEnum, index } from "drizzle-orm/pg-core"
import { customers } from "./customers"

export const loanStatusEnum = pgEnum("loan_status", ["active", "fully_paid"])

export const loans = pgTable("loans", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  principalAmount: numeric("principal_amount", { precision: 15, scale: 2 }).notNull(),
  issuanceFee: numeric("issuance_fee", { precision: 15, scale: 2 }).notNull(),
  description: text("description").notNull(),
  interestRate: numeric("interest_rate", { precision: 5, scale: 4 }).notNull(),
  minInterestDays: integer("min_interest_days").notNull().default(30),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  status: loanStatusEnum("status").notNull().default("active"),
  interestRateOverride: numeric("interest_rate_override", { precision: 5, scale: 4 }),
  minPeriodOverride: integer("min_period_override"),
  issuedBy: text("issued_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("idx_loans_customer_id").on(table.customerId),
])
```

### Migration

```bash
npx drizzle-kit generate
npx drizzle-kit push
```

---

## Task 2: Update types

- [ ] Add `issuanceFee` and `description` to `CreateLoanInput`
- [ ] Add `issuanceFee` and `description` to `UpdateLoanInput`
- [ ] `LoanWithCustomer` and `Loan` are inferred from schema — they auto-update

### Code

**`src/types/index.ts`** — `CreateLoanInput` changes (replace the existing interface):

```typescript
export interface CreateLoanInput {
  customerId: string
  principalAmount: string   // string for NUMERIC precision -- no float
  issuanceFee: string        // string NUMERIC, minimum "50000"
  description: string        // required loan description/purpose
  interestRate: string      // string decimal e.g. "0.10" for 10%/month, defaults to "0.10"
  minInterestDays: number   // defaults to 30
  startDate: string         // ISO 8601 datetime string
  collateral: CollateralInput
  interestRateOverride?: string | null  // admin-only override
  minPeriodOverride?: number | null     // admin-only override
}
```

**`src/types/index.ts`** — `UpdateLoanInput` changes (replace the existing interface):

```typescript
export interface UpdateLoanInput {
  loanId: string
  principalAmount?: string    // NUMERIC string
  interestRate?: string       // decimal string e.g. "0.10"
  startDate?: string          // ISO 8601
  issuanceFee?: string        // NUMERIC string
  description?: string        // loan description/purpose
  reason: string              // required for audit
}
```

---

## Task 3: Update server action + service

- [ ] Validate `issuanceFee` (required, valid decimal, >= 50000) and `description` (required, non-empty) in `createLoanAction`
- [ ] Include `issuanceFee` and `description` in `createLoan` service insert values
- [ ] Auto-post issuance fee as income transaction in the same database transaction
- [ ] Update `listLoans` select to include the new columns

### Code

**`src/actions/loan.actions.ts`** — add validation in `createLoanAction` after the existing collateral validation (line ~148), before the `loanInput` construction:

```typescript
  // --- Add after line 148 (after collateral nature validation) ---
  if (!input.issuanceFee?.trim() || !/^\d+(\.\d{1,2})?$/.test(input.issuanceFee)) {
    return { error: "Issuance fee must be a valid decimal number" }
  }
  if (parseFloat(input.issuanceFee) < 50000) {
    return { error: "Issuance fee must be at least 50,000 UGX" }
  }
  if (!input.description?.trim()) {
    return { error: "Loan description is required" }
  }
```

**`src/services/loan.service.ts`** — update the `createLoan` function to include new fields in the insert and auto-post the issuance fee as an income transaction.

Add imports at the top:

```typescript
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
```

Update the insert values inside `createLoan` (in the `db.transaction` callback):

```typescript
        const [loan] = await tx
          .insert(loans)
          .values({
            customerId: input.customerId,
            principalAmount: input.principalAmount,
            issuanceFee: input.issuanceFee,
            description: input.description,
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

After collateral insert and audit log, add the income transaction for the issuance fee:

```typescript
        // Auto-post issuance fee as income transaction
        // Find or assume an "Issuance Fees" income category
        let [feeCategory] = await tx
          .select()
          .from(transactionCategories)
          .where(
            and(
              eq(transactionCategories.name, "Issuance Fees"),
              eq(transactionCategories.type, "income")
            )
          )

        if (!feeCategory) {
          ;[feeCategory] = await tx
            .insert(transactionCategories)
            .values({ name: "Issuance Fees", type: "income", isDefault: true })
            .returning()
        }

        await tx.insert(transactions).values({
          type: "credit",
          amount: input.issuanceFee,
          categoryId: feeCategory.id,
          referenceType: "loan",
          referenceId: loan.id,
          description: `Issuance fee for loan ${loan.id.slice(0, 8).toUpperCase()}`,
          transactionDate: startDate,
          recordedBy: actorId,
        })
```

**`src/services/loan.service.ts`** — update `listLoans` select to include the new columns:

```typescript
        .select({
          id: loans.id,
          customerId: loans.customerId,
          principalAmount: loans.principalAmount,
          issuanceFee: loans.issuanceFee,
          description: loans.description,
          interestRate: loans.interestRate,
          minInterestDays: loans.minInterestDays,
          startDate: loans.startDate,
          status: loans.status,
          interestRateOverride: loans.interestRateOverride,
          minPeriodOverride: loans.minPeriodOverride,
          issuedBy: loans.issuedBy,
          createdAt: loans.createdAt,
          updatedAt: loans.updatedAt,
          deletedAt: loans.deletedAt,
          customerName: customers.fullName,
        })
```

Also update `updateLoan` to handle the new optional fields in `setObj`:

```typescript
      if (input.issuanceFee !== undefined) {
        setObj.issuanceFee = input.issuanceFee
      }
      if (input.description !== undefined) {
        setObj.description = input.description
      }
```

---

## Task 4: Update loan creation form

- [ ] Add `issuanceFee` and `description` to `LoanFormValues` interface
- [ ] Add fields to `step1Fields` validation array
- [ ] Add `MoneyInput` for issuanceFee in Step 1 (with min 50000 validation)
- [ ] Add textarea for description in Step 1
- [ ] Add both to Step 3 review summary
- [ ] Pass both fields in `onSubmit`

### Code

**`src/app/(app)/loans/new/page.tsx`** — update `LoanFormValues`:

```typescript
interface LoanFormValues {
  customerId: string
  principalAmount: string
  issuanceFee: string
  description: string
  startDate: string
  interestRateDisplay: string
  collateralNature: string
  collateralDescription: string
}
```

Update `defaultValues` in `useForm`:

```typescript
    defaultValues: {
      customerId: prefilledCustomerId,
      principalAmount: "",
      issuanceFee: "",
      description: "",
      startDate: todayISODate(),
      interestRateDisplay: "10",
      collateralNature: "",
      collateralDescription: "",
    },
```

Update `step1Fields`:

```typescript
  const step1Fields: (keyof LoanFormValues)[] = ["customerId", "principalAmount", "issuanceFee", "description", "startDate", "interestRateDisplay"]
```

Add watch for new fields (after existing watches):

```typescript
  const issuanceFee = watch("issuanceFee")
  const description = watch("description")
```

Add MoneyInput for issuanceFee in Step 1 (after the existing `principalAmount` MoneyInput):

```tsx
              <MoneyInput
                name="issuanceFee"
                control={control}
                label="Issuance Fee (UGX)"
                required="Issuance fee is required"
                id="issuanceFee"
                rules={{
                  validate: (v: string) => {
                    const n = parseFloat(v)
                    if (isNaN(n) || n < 50000) return "Minimum issuance fee is 50,000 UGX"
                    return true
                  },
                }}
              />
```

Add textarea for description in Step 1 (after the issuance fee input):

```tsx
              <div className="space-y-1">
                <Label htmlFor="description">Loan Description / Purpose</Label>
                <textarea
                  id="description"
                  className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring min-h-[80px] resize-y"
                  placeholder="Describe the purpose of this loan..."
                  {...register("description", {
                    required: "Loan description is required",
                  })}
                />
                {errors.description && (
                  <p className="text-sm text-destructive">{errors.description.message}</p>
                )}
              </div>
```

Update `onSubmit` to pass new fields:

```typescript
  function onSubmit(data: LoanFormValues) {
    const collateral: CollateralInput = {
      nature: data.collateralNature,
      description: data.collateralDescription.trim() || undefined,
    }

    createLoan.mutate({
      customerId: data.customerId,
      principalAmount: data.principalAmount,
      issuanceFee: data.issuanceFee,
      description: data.description.trim(),
      interestRate: (parseFloat(data.interestRateDisplay) / 100).toFixed(10),
      minInterestDays: 30,
      startDate: new Date(data.startDate).toISOString(),
      collateral,
    })
  }
```

Add to Step 3 review summary (after the "Principal Amount" row):

```tsx
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Issuance Fee</dt>
                    <dd className="font-medium font-mono tabular-nums">{formatCurrency(issuanceFee)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Description</dt>
                    <dd className="font-medium">{description}</dd>
                  </div>
```

---

## Task 5: Update use-create-loan hook

- [ ] Add `issuanceFee` and `description` to the optimistic `LoanWithCustomer` object

### Code

**`src/hooks/use-create-loan.ts`** — update the `optimistic` object in `onMutate`:

```typescript
      const optimistic: LoanWithCustomer = {
        id: `optimistic-${Date.now()}`,
        customerId: input.customerId,
        customerName: "Loading...",
        principalAmount: input.principalAmount,
        issuanceFee: input.issuanceFee,
        description: input.description,
        interestRate: input.interestRate || "0.10",
        minInterestDays: input.minInterestDays || 30,
        interestRateOverride: input.interestRateOverride ?? null,
        minPeriodOverride: input.minPeriodOverride ?? null,
        startDate: new Date(input.startDate),
        status: "active",
        issuedBy: "",
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
```

---

## Task 6: Update loan detail page

- [ ] Display issuance fee and description in the loan details grid

### Code

**`src/app/(app)/loans/[loanId]/loan-detail-client.tsx`** — add a new card in the details grid (after the Start Date card, still inside the `grid grid-cols-1 sm:grid-cols-3` div). Change grid to `sm:grid-cols-2 lg:grid-cols-3` to accommodate more cards:

Add an Issuance Fee card:

```tsx
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Banknote className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Issuance Fee</span>
          </div>
          <p className="text-2xl font-semibold font-mono tabular-nums tracking-tight">
            {formatCurrency(loan.issuanceFee)}
          </p>
        </div>
```

Add a Description section below the grid (before the Principal Balance Card):

```tsx
      {/* Loan Description */}
      {loan.description && (
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Description</p>
          <p className="text-sm">{loan.description}</p>
        </div>
      )}
```

---

## Task 7: Update receipts

- [ ] Add issuance fee and description to the disbursement receipt
- [ ] Repayment receipt unchanged

### Code

**`src/app/(app)/receipts/disbursement/[loanId]/page.tsx`** — add rows to the Loan Details table (after the "Min. Interest Period" row):

```tsx
                <tr>
                  <td className="py-1 text-gray-500 align-top">Issuance Fee</td>
                  <td className="py-1 text-right font-mono tabular-nums">
                    {formatCurrency(loan.issuanceFee)}
                  </td>
                </tr>
                {loan.description && (
                  <tr>
                    <td className="py-1 text-gray-500 align-top">Description</td>
                    <td className="py-1 text-right">{loan.description}</td>
                  </tr>
                )}
```

---

## Task 8: Update test files

- [ ] Add `issuanceFee` and `description` to all test mocks that create loans

### Code

**`src/services/__tests__/loan.service.test.ts`** — update `baseLoanInput`:

```typescript
const baseLoanInput = {
  customerId: "cust-1",
  principalAmount: "500000.00",
  issuanceFee: "50000.00",
  description: "Business expansion loan",
  interestRate: "0.10",
  minInterestDays: 30,
  startDate: "2026-03-19T00:00:00.000Z",
  collateral: { nature: "Land Title", description: "Plot 42, Kampala" },
}
```

Update `mockLoan`:

```typescript
const mockLoan = {
  id: "loan-1",
  customerId: "cust-1",
  principalAmount: "500000.00",
  issuanceFee: "50000.00",
  description: "Business expansion loan",
  interestRate: "0.10",
  minInterestDays: 30,
  startDate: new Date("2026-03-19T00:00:00.000Z"),
  status: "active",
  interestRateOverride: null,
  minPeriodOverride: null,
  issuedBy: "actor-1",
}
```

**`src/services/__integration__/loan.service.test.ts`** — update `baseLoanInput` function:

```typescript
function baseLoanInput(customerId: string) {
  return {
    customerId,
    principalAmount: "1000000.00",
    issuanceFee: "50000.00",
    description: "Integration test loan",
    interestRate: "0.10",
    minInterestDays: 30,
    startDate: "2026-04-01T00:00:00.000Z",
    collateral: { nature: "Land Title", description: "Plot 42, Kampala" },
  }
}
```

**All other integration test files** (`payment.service.test.ts`, `report.service.test.ts`, `notification.service.test.ts`, `dashboard.service.test.ts`, `daily-collections.service.test.ts`) — find every `baseLoanInput` or inline `createLoan` call and add `issuanceFee: "50000.00"` and `description: "Test loan"` to the input object. The pattern is always the same — add the two fields alongside the existing `principalAmount` and `interestRate`.

---

## Task 9: Cypress E2E tests

- [ ] Update existing loan wizard tests to include issuance fee and description
- [ ] Add new validation test: fee below 50,000 rejected
- [ ] Add new validation test: empty description rejected

### Code

**`cypress/e2e/loan-wizard.cy.ts`** — update the "navigates through all 3 wizard steps" test to fill in the new fields in Step 1:

After `cy.get("#principalAmount").type("1000000")`, add:

```typescript
    cy.get("#issuanceFee").type("50000")
    cy.get("#description").type("Working capital for retail business")
```

Update the "shows interest calculation preview on Step 3" test similarly — add fee and description in Step 1.

Update the "issues a loan and redirects to customer profile" test — add fee and description in Step 1:

```typescript
    // Step 1
    cy.get("#principalAmount").type("500000")
    cy.get("#issuanceFee").type("75000")
    cy.get("#description").type("Agriculture inputs loan")
    cy.contains("button", "Next").click()
```

Update the "validates Step 1 fields" test to check for new validation messages:

```typescript
  it("validates Step 1 fields", () => {
    cy.visit("/loans/new")

    // Try advancing with empty fields
    cy.contains("button", "Next").click()

    cy.contains("Customer is required")
    cy.contains("Amount must be greater than 0")
    cy.contains("Issuance fee is required")
    cy.contains("Loan description is required")
  })
```

Add new test for minimum fee validation:

```typescript
  it("rejects issuance fee below 50,000 UGX", () => {
    cy.visit(`/loans/new?customerId=${customerId}`)

    cy.get("#principalAmount").type("500000")
    cy.get("#issuanceFee").type("30000")
    cy.get("#description").type("Some loan purpose")
    cy.contains("button", "Next").click()

    cy.contains("Minimum issuance fee is 50,000 UGX")
  })
```

Add new test for description in Step 3 review:

```typescript
  it("shows issuance fee and description in Step 3 review", () => {
    cy.visit(`/loans/new?customerId=${customerId}`)

    // Step 1
    cy.get("#principalAmount").type("1000000")
    cy.get("#issuanceFee").type("60000")
    cy.get("#description").type("Purchase of farming equipment")
    cy.contains("button", "Next").click()

    // Step 2
    cy.get("#collateralNature").click()
    cy.get("[role=option]").contains("Land Title").click()
    cy.get("[data-base-ui-inert]").should("not.exist")
    cy.contains("button", "Next").click()

    // Step 3 — verify new fields appear in review
    cy.contains("Issuance Fee")
    cy.contains("60,000")
    cy.contains("Description")
    cy.contains("Purchase of farming equipment")
  })
```

Update the "Back buttons navigate between steps correctly" test to fill in fee and description before proceeding past Step 1:

```typescript
    // Step 1 → Step 2
    cy.get("#principalAmount").type("500000")
    cy.get("#issuanceFee").type("50000")
    cy.get("#description").type("Test loan")
    cy.contains("button", "Next").click()
    cy.contains("Step 2 of 3")

    // Step 2 → Step 1
    cy.contains("button", "Back").click()
    cy.contains("Step 1 of 3")
    // Amount should be preserved
    cy.get("#principalAmount").should("have.value", "500000")
    cy.get("#issuanceFee").should("have.value", "50000")
    cy.get("#description").should("have.value", "Test loan")
```

---

## Verification

After all tasks are complete, run:

```bash
npx vitest run src/services/__tests__/loan.service.test.ts
npx vitest run src/services/__integration__/loan.service.test.ts
npx cypress run --spec cypress/e2e/loan-wizard.cy.ts
```

All tests must pass before considering the feature complete.
