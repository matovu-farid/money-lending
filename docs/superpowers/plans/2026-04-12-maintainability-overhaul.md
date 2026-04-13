# Maintainability Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the 6 biggest maintainability headaches: action boilerplate, validation duplication, god component, test mock bloat, inconsistent error handling, and brittle Effect error extraction.

**Architecture:** Deepen `withAction` to absorb the try/catch+Effect+revalidate ceremony from all 14 action files. Extract shared validators. Split the 1200-line LoanDetailClient into focused sub-components. Create shared test factories.

**Tech Stack:** TypeScript, Effect-TS, Vitest, React, Next.js

---

### Task 1: Enhance `withAction` to absorb Effect + error handling boilerplate

Currently every action manually does:
```ts
try {
  const data = await Effect.runPromise(someEffect(input))
  revalidatePath("/path")
  return { data }
} catch (error) {
  if (getErrorTag(error) === "SomeError") return { error: "..." }
  return { error: "Internal server error" }
}
```

We'll add an `effect` mode to `withAction` that handles this automatically.

**Files:**
- Modify: `src/lib/with-action.ts`
- Modify: `src/lib/action-utils.ts` (no changes to getErrorTag — it stays as escape hatch)

- [ ] **Step 1: Write failing test for effect-mode withAction**

Create `src/lib/__tests__/with-action.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"
import { Data } from "effect"

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}))
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

import { auth } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { withAction } from "../with-action"

const mockGetSession = vi.mocked(auth.api.getSession)
const mockRevalidatePath = vi.mocked(revalidatePath)

class TestNotFound extends Data.TaggedError("TestNotFound")<{ id: string }> {}
class TestDbError extends Data.TaggedError("TestDbError")<{ cause: unknown }> {}

const fakeSession = {
  user: { id: "u1", name: "Test", email: "t@t.com", role: "admin" },
  session: { id: "s1" },
} as any

describe("withAction effect mode", () => {
  beforeEach(() => vi.clearAllMocks())

  it("runs Effect and returns { data } on success", async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    const action = withAction<string, { data: { id: string } }>({
      effect: (_, input) => Effect.succeed({ id: input }),
      revalidate: ["/items"],
    })
    const result = await action("abc")
    expect(result).toEqual({ data: { id: "abc" } })
    expect(mockRevalidatePath).toHaveBeenCalledWith("/items")
  })

  it("maps tagged errors to user-facing messages", async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    const action = withAction<string, { data: any } | { error: string }>({
      effect: (_, id) => Effect.fail(new TestNotFound({ id })),
      errors: { TestNotFound: "Item not found" },
    })
    const result = await action("x")
    expect(result).toEqual({ error: "Item not found" })
  })

  it("returns generic error for unmapped tags", async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    const action = withAction<string, any>({
      effect: (_, _id) => Effect.fail(new TestDbError({ cause: "boom" })),
    })
    const result = await action("x")
    expect(result).toEqual({ error: "Internal server error" })
  })

  it("supports dynamic revalidation paths with input", async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    const action = withAction<string, any>({
      effect: (_, id) => Effect.succeed({ id }),
      revalidate: (input) => [`/items`, `/items/${input}`],
    })
    await action("123")
    expect(mockRevalidatePath).toHaveBeenCalledWith("/items")
    expect(mockRevalidatePath).toHaveBeenCalledWith("/items/123")
  })

  it("still supports the classic callback mode", async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    const action = withAction<string, { data: string }>({
      action: async (_session, input) => ({ data: input }),
    })
    const result = await action("hello")
    expect(result).toEqual({ data: "hello" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/with-action.test.ts`
Expected: FAIL — `effect` and `revalidate` options don't exist yet.

- [ ] **Step 3: Implement effect mode in withAction**

Replace `src/lib/with-action.ts` with:

```ts
"use server"

import { Effect } from "effect"
import { getSession, requireRole } from "@/lib/action-utils"
import { getErrorTag } from "@/lib/action-utils"
import { revalidatePath } from "next/cache"
import type { UserRole } from "@/types"

export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>

// --- Classic mode (existing) ---
interface ActionOptionsWithInput<TInput, TResult> {
  minRole?: UserRole
  forbiddenMessage?: string
  action: (session: Session, input: TInput) => Promise<TResult>
}

interface ActionOptionsNoInput<TResult> {
  minRole?: UserRole
  forbiddenMessage?: string
  action: (session: Session) => Promise<TResult>
}

// --- Effect mode (new) ---
interface EffectOptionsWithInput<TInput, TData> {
  minRole?: UserRole
  forbiddenMessage?: string
  effect: (session: Session, input: TInput) => Effect.Effect<TData, any>
  errors?: Record<string, string>
  revalidate?: string[] | ((input: TInput) => string[])
}

interface EffectOptionsNoInput<TData> {
  minRole?: UserRole
  forbiddenMessage?: string
  effect: (session: Session) => Effect.Effect<TData, any>
  errors?: Record<string, string>
  revalidate?: string[]
}

// Overloads: classic mode
export function withAction<TResult>(
  opts: ActionOptionsNoInput<TResult>,
): () => Promise<TResult | { error: string }>
export function withAction<TInput, TResult>(
  opts: ActionOptionsWithInput<TInput, TResult>,
): (input: TInput) => Promise<TResult | { error: string }>

// Overloads: effect mode
export function withAction<TData>(
  opts: EffectOptionsNoInput<TData>,
): () => Promise<{ data: TData } | { error: string }>
export function withAction<TInput, TData>(
  opts: EffectOptionsWithInput<TInput, TData>,
): (input: TInput) => Promise<{ data: TData } | { error: string }>

// Implementation
export function withAction<TInput, TResult>(
  opts: any,
): (input?: TInput) => Promise<TResult | { data: any } | { error: string }> {
  return async (input?: TInput) => {
    const session = await getSession()
    if (!session) return { error: "Unauthorized" }

    if (opts.minRole) {
      const forbidden = requireRole(session, opts.minRole, opts.forbiddenMessage)
      if (forbidden) return { error: forbidden }
    }

    // Classic mode — delegate to user's action callback
    if ("action" in opts) {
      return (opts.action as (session: Session, input?: TInput) => Promise<TResult>)(session, input as TInput)
    }

    // Effect mode — run Effect, handle errors, revalidate
    try {
      const data = await Effect.runPromise(
        opts.effect(session, input as TInput)
      )

      // Revalidate paths on success
      if (opts.revalidate) {
        const paths = typeof opts.revalidate === "function"
          ? opts.revalidate(input as TInput)
          : opts.revalidate
        for (const path of paths) {
          revalidatePath(path)
        }
      }

      return { data }
    } catch (error) {
      const tag = getErrorTag(error)
      if (tag && opts.errors?.[tag]) {
        return { error: opts.errors[tag] }
      }
      return { error: "Internal server error" }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/with-action.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests pass (classic mode unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/lib/with-action.ts src/lib/__tests__/with-action.test.ts
git commit -m "feat: add effect mode to withAction — absorbs try/catch/revalidate boilerplate"
```

---

### Task 2: Migrate action files to effect mode

Convert all 14 action files from manual try/catch to the new `effect` mode. Each file follows the same mechanical transformation.

**Files:**
- Modify: `src/actions/customer.actions.ts`
- Modify: `src/actions/expense.actions.ts`
- Modify: `src/actions/income.actions.ts`
- Modify: `src/actions/creditor.actions.ts`
- Modify: `src/actions/notification.actions.ts`
- Modify: `src/actions/dashboard.actions.ts`
- Modify: `src/actions/settings.actions.ts`
- Modify: `src/actions/fund-transfer.actions.ts`
- Modify: `src/actions/daily-collections.actions.ts`
- Modify: `src/actions/settlement.actions.ts`
- Modify: `src/actions/loan.actions.ts` (only the simple actions — `listLoansAction`, `updateLoanAction`, `deleteLoanAction`, `getLocationBalancesAction`)
- Modify: `src/actions/payment.actions.ts` (only the simple actions — `recordPaymentAction`, `listPaymentsAction`, `searchActiveLoansAction`, `getRecentlyCollectedLoansAction`, `getLoanBalanceAction`, `getPaymentPortionsAction`)

Do NOT convert:
- `createLoanAction` — has complex multi-step validation + role branching
- `markPaymentWrongAction` / `unmarkPaymentWrongAction` — has complex transaction logic
- `chat.actions.ts` — uses custom auth pattern
- `rate-change-request.actions.ts` — mixed auth patterns with complex DB transactions

**Transformation pattern:**

Before:
```ts
export const listCustomersAction = withAction({
  action: async () => {
    try {
      const data = await Effect.runPromise(listCustomers())
      return { data }
    } catch (error) {
      if (getErrorTag(error) === "DatabaseError") {
        return { error: "Database error" }
      }
      return { error: "Internal server error" }
    }
  },
})
```

After:
```ts
export const listCustomersAction = withAction({
  effect: () => listCustomers(),
  errors: { DatabaseError: "Database error" },
})
```

- [ ] **Step 1: Migrate `customer.actions.ts` simple actions**

Migrate `listCustomersAction`, `getCustomerAction`, `searchCustomersAction`. Keep `createCustomerAction` and `changeCustomerStatusAction` in classic mode (they have inline validation that returns early).

Example — `listCustomersAction`:
```ts
export const listCustomersAction = withAction({
  effect: () => listCustomers(),
  errors: { DatabaseError: "Database error" },
})
```

Example — `getCustomerAction`:
```ts
export const getCustomerAction = withAction<string, any>({
  effect: (_session, id) => getCustomer(id),
  errors: { CustomerNotFound: "Customer not found" },
})
```

Example — `searchCustomersAction`:
```ts
export const searchCustomersAction = withAction<CustomerSearchParams, any>({
  effect: (_session, params) => searchCustomers(params),
  errors: { DatabaseError: "Database error" },
})
```

Remove the `Effect` import from this file if no remaining actions use `Effect.runPromise` directly. Remove the `getErrorTag` import if no remaining actions use it.

- [ ] **Step 2: Migrate `expense.actions.ts`**

Convert all 6 actions. Pattern: replace manual try/catch with `effect` + `errors` + `revalidate`.

For actions with `revalidatePath` calls, use the `revalidate` option:
```ts
export const recordExpenseAction = withAction<RecordExpenseInput, any>({
  effect: (_session, input) => recordExpense(input),
  revalidate: ["/transactions"],
  errors: { DatabaseError: "Database error" },
})
```

- [ ] **Step 3: Migrate `income.actions.ts`**

Same pattern as expense — 4 actions.

- [ ] **Step 4: Migrate `creditor.actions.ts`**

6 actions. For `updateCreditorWrapped` which takes `{ id, input }`, keep the wrapper function pattern:
```ts
export async function updateCreditorAction(id: string, input: UpdateCreditorInput) {
  return updateCreditorWrapped({ id, input })
}

const updateCreditorWrapped = withAction<{ id: string; input: UpdateCreditorInput }, any>({
  effect: (_session, { id, input }) => updateCreditor(id, input),
  revalidate: ({ id }) => ["/creditors", `/creditors/${id}`],
  errors: { CreditorNotFound: "Creditor not found" },
})
```

- [ ] **Step 5: Migrate `notification.actions.ts`, `dashboard.actions.ts`, `settings.actions.ts`, `fund-transfer.actions.ts`, `daily-collections.actions.ts`**

All straightforward — each action becomes 3-5 lines.

- [ ] **Step 6: Migrate simple actions in `loan.actions.ts` and `payment.actions.ts`**

Only convert the simple Effect-wrapping actions listed above. Leave complex ones untouched.

For actions with session-dependent revalidation (like `recordPaymentAction` which calls `sendAdminNotification`), keep in classic mode — the notification side-effect doesn't fit the effect pattern cleanly.

Actually, `recordPaymentAction` and `editPaymentAction` / `deletePaymentAction` have `sendAdminNotification` calls — keep those in classic mode too.

Convert only:
- `loan.actions.ts`: `getLocationBalancesAction`, `listLoansAction`, `listLoansWithOverdueAction`, `listActiveLoansWithOverdueAction`
- `payment.actions.ts`: `listPaymentsAction`, `searchActiveLoansAction`, `getRecentlyCollectedLoansAction`, `getLoanBalanceAction`, `getPaymentPortionsAction`

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass. The action tests mock the service layer, so the internal implementation change (Effect mode vs manual try/catch) doesn't break them.

- [ ] **Step 8: Commit**

```bash
git add src/actions/
git commit -m "refactor: migrate simple actions to withAction effect mode — removes ~200 lines of try/catch boilerplate"
```

---

### Task 3: Centralize shared validators

Extract duplicated validation logic (NIN, phone, required fields, amounts) into `src/lib/validators.ts`.

**Files:**
- Create: `src/lib/validators.ts`
- Create: `src/lib/__tests__/validators.test.ts`
- Modify: `src/actions/customer.actions.ts` (use shared validators)
- Modify: `src/components/customers/customer-form-fields.tsx` (use shared validators)

- [ ] **Step 1: Write failing tests for validators**

Create `src/lib/__tests__/validators.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { validateNIN, validateUgandanPhone, validateFullName, validateRequired, validatePositiveDecimal } from "../validators"

describe("validateNIN", () => {
  it("accepts valid NIN", () => {
    expect(validateNIN("CM97027102X4CU")).toBeNull()
  })
  it("accepts lowercase (auto-uppercased)", () => {
    expect(validateNIN("cm97027102x4cu")).toBeNull()
  })
  it("rejects short NIN", () => {
    expect(validateNIN("CM9702")).not.toBeNull()
  })
  it("rejects empty", () => {
    expect(validateNIN("")).not.toBeNull()
    expect(validateNIN(undefined)).not.toBeNull()
  })
})

describe("validateUgandanPhone", () => {
  it("accepts 07XXXXXXXX", () => {
    expect(validateUgandanPhone("0771234567")).toBeNull()
  })
  it("accepts +2567XXXXXXXX", () => {
    expect(validateUgandanPhone("+256771234567")).toBeNull()
  })
  it("accepts with spaces", () => {
    expect(validateUgandanPhone("077 123 4567")).toBeNull()
  })
  it("rejects too short", () => {
    expect(validateUgandanPhone("07712")).not.toBeNull()
  })
})

describe("validateFullName", () => {
  it("requires at least two words", () => {
    expect(validateFullName("John")).not.toBeNull()
    expect(validateFullName("John Doe")).toBeNull()
  })
  it("rejects empty", () => {
    expect(validateFullName("")).not.toBeNull()
  })
})

describe("validateRequired", () => {
  it("rejects empty/blank", () => {
    expect(validateRequired("", "Field")).not.toBeNull()
    expect(validateRequired("  ", "Field")).not.toBeNull()
  })
  it("accepts non-empty", () => {
    expect(validateRequired("hello", "Field")).toBeNull()
  })
})

describe("validatePositiveDecimal", () => {
  it("accepts valid decimal", () => {
    expect(validatePositiveDecimal("100.50", "Amount")).toBeNull()
  })
  it("rejects zero", () => {
    expect(validatePositiveDecimal("0", "Amount")).not.toBeNull()
  })
  it("rejects non-numeric", () => {
    expect(validatePositiveDecimal("abc", "Amount")).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/validators.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement validators**

Create `src/lib/validators.ts`:

```ts
const NIN_PATTERN = /^[CA][MF]\d{8}[A-Z0-9]{4}$/
const PHONE_PATTERN = /^(07\d{8}|\+2567\d{8})$/

export function validateNIN(value: string | undefined | null): string | null {
  const trimmed = value?.trim()?.toUpperCase()
  if (!trimmed || !NIN_PATTERN.test(trimmed)) {
    return "Valid NIN is required (e.g. CM97027102X4CU)"
  }
  return null
}

export function validateUgandanPhone(value: string | undefined | null): string | null {
  const cleaned = value?.trim()?.replace(/\s/g, "")
  if (!cleaned || !PHONE_PATTERN.test(cleaned)) {
    return "Valid Ugandan mobile number is required (e.g. 0771234567)"
  }
  return null
}

export function validateFullName(value: string | undefined | null): string | null {
  const trimmed = value?.trim()
  if (!trimmed || trimmed.split(/\s+/).length < 2) {
    return "Full name with first and last name is required"
  }
  return null
}

export function validateRequired(
  value: string | undefined | null,
  fieldName: string,
): string | null {
  if (!value?.trim()) return `${fieldName} is required`
  return null
}

export function validatePositiveDecimal(
  value: string | undefined | null,
  fieldName: string,
): string | null {
  if (!value?.trim() || !/^\d+(\.\d{1,2})?$/.test(value)) {
    return `${fieldName} must be a valid decimal number`
  }
  if (parseFloat(value) <= 0) {
    return `${fieldName} must be greater than zero`
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/validators.test.ts`
Expected: PASS

- [ ] **Step 5: Update `createCustomerAction` to use shared validators**

In `src/actions/customer.actions.ts`, replace inline validation:

Before:
```ts
if (!input.fullName?.trim() || input.fullName.trim().split(/\s+/).length < 2) {
  return { error: "Full name with first and last name is required" }
}
if (!input.nin?.trim() || !/^[CA][MF]\d{8}[A-Z0-9]{4}$/.test(input.nin.trim().toUpperCase())) {
  return { error: "Valid NIN is required (e.g. CM97027102X4CU)" }
}
if (!input.contact?.trim() || !/^(07\d{8}|\+2567\d{8})$/.test(input.contact.trim().replace(/\s/g, ""))) {
  return { error: "Valid Ugandan mobile number is required (e.g. 0771234567)" }
}
if (!input.address?.trim() || input.address.trim().length < 5) {
  return { error: "Address is required (at least 5 characters)" }
}
```

After:
```ts
import { validateFullName, validateNIN, validateUgandanPhone, validateRequired } from "@/lib/validators"

// inside action:
const nameErr = validateFullName(input.fullName)
if (nameErr) return { error: nameErr }
const ninErr = validateNIN(input.nin)
if (ninErr) return { error: ninErr }
const phoneErr = validateUgandanPhone(input.contact)
if (phoneErr) return { error: phoneErr }
if (!input.address?.trim() || input.address.trim().length < 5) {
  return { error: "Address is required (at least 5 characters)" }
}
```

- [ ] **Step 6: Update `customer-form-fields.tsx` to use shared validators for client-side hints**

Import `validateNIN` and `validateUgandanPhone` from `@/lib/validators` and use in the form field `validate` prop instead of inline regex. Since this is a client component and validators are plain functions (no "use server"), they work on both sides.

- [ ] **Step 7: Remove duplicate `validatePositiveDecimal` and `validateRequired` from `action-utils.ts`**

These now live in `validators.ts`. Update all imports across actions:
- `src/actions/loan.actions.ts` — change import from `@/lib/action-utils` to `@/lib/validators`
- `src/actions/payment.actions.ts` — same
- Any other files importing `validatePositiveDecimal` or `validateRequired` from `action-utils`

Keep `getSession`, `getUserRole`, `requireRole`, `getErrorTag`, `getErrorField` in `action-utils.ts` — those are auth/error concerns.

- [ ] **Step 8: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/validators.ts src/lib/__tests__/validators.test.ts src/actions/ src/lib/action-utils.ts src/components/customers/customer-form-fields.tsx
git commit -m "refactor: centralize validators — single source of truth for NIN, phone, name, amount validation"
```

---

### Task 4: Split LoanDetailClient into focused sub-components

The 1199-line god component handles: loan info display, payment table, payment edit/delete dialogs, loan edit/delete dialogs, rate change dialog, penalty management, collateral settlement. Split into:

1. `loan-info-cards.tsx` — the loan details grid (principal, rate, dates, type cards)
2. `payment-table.tsx` — payment history table with running balance
3. `loan-dialogs.tsx` — all drawer dialogs (edit/delete payment, edit/delete loan, rate change)

The parent `loan-detail-client.tsx` remains as orchestrator (~200 lines) — holds state, queries, handlers, and composes the sub-components.

**Files:**
- Create: `src/app/(app)/loans/[loanId]/loan-info-cards.tsx`
- Create: `src/app/(app)/loans/[loanId]/payment-table.tsx`
- Create: `src/app/(app)/loans/[loanId]/loan-dialogs.tsx`
- Modify: `src/app/(app)/loans/[loanId]/loan-detail-client.tsx`

- [ ] **Step 1: Extract `LoanInfoCards` component**

Create `src/app/(app)/loans/[loanId]/loan-info-cards.tsx`.

This component renders lines 426-643 of the current `loan-detail-client.tsx` — the grid of info cards (Principal, Interest Rate, Start Date, Issuance Fee, Loan Type, Term). It also includes the penalty management UI (lines 464-558) and rate change request button (lines 559-576).

Props:
```ts
interface LoanInfoCardsProps {
  loan: Loan
  userRole: UserRole
  penaltyActive: boolean
  pendingRateRequest: RateChangeRequest | undefined
  userNameMap: Record<string, string>
  // Penalty actions
  isWaivingPenalty: boolean
  onWaivePenalty: () => void
  adjustingPenalty: boolean
  penaltyMultiplierInput: string
  onOpenPenaltyAdjust: () => void
  onClosePenaltyAdjust: () => void
  onSetPenaltyMultiplierInput: (v: string) => void
  isAdjustingPenalty: boolean
  onAdjustPenalty: () => void
  // Rate change
  onOpenRateChange: () => void
}
```

Move the JSX for the 6 info cards into this component. Keep imports minimal — only UI components and formatters needed.

- [ ] **Step 2: Extract `PaymentTable` component**

Create `src/app/(app)/loans/[loanId]/payment-table.tsx`.

This renders lines 753-874 — the payment history section with the table, empty state, and per-row dropdown menus.

Props:
```ts
interface PaymentTableProps {
  payments: Payment[]
  currentPortions: PaymentPortionsMap
  runningBalanceMap: Record<string, string>
  outstandingBalance: string
  customerName: string | null
  loanRef: string
  loanStatus: string
  loanId: string
  userNameMap: Record<string, string>
  onEditPayment: (payment: Payment) => void
  onDeletePayment: (payment: Payment) => void
}
```

- [ ] **Step 3: Extract `LoanDialogs` component**

Create `src/app/(app)/loans/[loanId]/loan-dialogs.tsx`.

This renders lines 887-1184 — all 5 DrawerDialog components:
1. Edit Payment dialog
2. Delete Payment dialog
3. Edit Loan dialog
4. Delete Loan dialog
5. Rate Change Request dialog

Props: all the dialog state + submit handlers from the parent.

```ts
interface LoanDialogsProps {
  // Payment edit
  editingPayment: Payment | null
  editAmount: string
  editDate: string
  editReason: string
  isEditPending: boolean
  onEditSubmit: () => void
  onClosePaymentEdit: () => void
  onSetEditAmount: (v: string) => void
  onSetEditDate: (v: string) => void
  onSetEditReason: (v: string) => void
  // Payment delete
  deletingPayment: Payment | null
  deleteReason: string
  isDeletePending: boolean
  onDeleteSubmit: () => void
  onClosePaymentDelete: () => void
  onSetDeleteReason: (v: string) => void
  // Loan edit
  editingLoan: boolean
  loanPrincipal: string
  loanInterestRate: string
  loanStartDate: string
  loanEditReason: string
  isLoanEditPending: boolean
  onLoanEditSubmit: () => void
  onCloseLoanEdit: () => void
  onSetLoanPrincipal: (v: string) => void
  onSetLoanInterestRate: (v: string) => void
  onSetLoanStartDate: (v: string) => void
  onSetLoanEditReason: (v: string) => void
  // Loan delete
  deletingLoan: boolean
  loanDeleteReason: string
  isLoanDeletePending: boolean
  onLoanDeleteSubmit: () => void
  onCloseLoanDelete: () => void
  onSetLoanDeleteReason: (v: string) => void
  // Rate change
  requestingRateChange: boolean
  newRate: string
  isRateChangePending: boolean
  currentRate: string
  userRole: UserRole
  onRateChangeSubmit: () => void
  onCloseRateChange: () => void
  onSetNewRate: (v: string) => void
}
```

- [ ] **Step 4: Refactor `loan-detail-client.tsx` to compose sub-components**

The parent shrinks to ~250 lines:
- All hooks, state, queries, handlers stay in parent
- Render returns: Header + `<LoanInfoCards>` + Amortization Schedule + Principal Balance Card + `<PaymentTable>` + Simulator + `<LoanDialogs>` + SettleCollateralDialog

The amortization schedule (lines 646-685) and principal balance card (lines 688-751) stay inline since they're already compact and only appear once.

- [ ] **Step 5: Run full test suite + verify the app builds**

Run: `npx vitest run && npx next build`
Expected: Tests pass. Build succeeds. No runtime errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/loans/\[loanId\]/
git commit -m "refactor: split LoanDetailClient (1199 lines) into focused sub-components"
```

---

### Task 5: Create shared test mock factories

The 11 action test files each duplicate 20-50 lines of `vi.mock()` setup. Create a shared factory that provides pre-configured mocks.

**Files:**
- Create: `src/actions/__tests__/test-utils.ts`
- Modify: `src/actions/__tests__/creditor.actions.test.ts` (migrate to shared factory as proof of concept)

- [ ] **Step 1: Create shared test factory**

Create `src/actions/__tests__/test-utils.ts`:

```ts
import { vi } from "vitest"

/**
 * Standard mock setup for action tests.
 * Call this at the TOP of your test file, before any imports.
 *
 * Usage:
 *   vi.mock("@/lib/auth", ...)  // still needed per-file due to hoisting
 *   vi.mock("next/headers", ...)
 *   vi.mock("next/cache", ...)
 *   vi.mock("@/services/your-service", ...)
 *
 *   import { setupActionMocks } from "./test-utils"
 *   const { mockGetSession, mockRevalidatePath, fakeSession, lowRoleSession } = setupActionMocks()
 */

import { auth } from "@/lib/auth"
import { revalidatePath } from "next/cache"

export function setupActionMocks() {
  const mockGetSession = vi.mocked(auth.api.getSession)
  const mockRevalidatePath = vi.mocked(revalidatePath)

  const fakeSession = {
    user: { id: "u1", name: "Test User", email: "test@test.com", role: "admin" },
    session: { id: "s1" },
  } as any

  const lowRoleSession = {
    user: { id: "u2", name: "Low Role", email: "low@test.com", role: "unassigned" },
    session: { id: "s2" },
  } as any

  const loanOfficerSession = {
    user: { id: "u3", name: "Officer", email: "officer@test.com", role: "loanOfficer" },
    session: { id: "s3" },
  } as any

  return {
    mockGetSession,
    mockRevalidatePath,
    fakeSession,
    lowRoleSession,
    loanOfficerSession,
  }
}

/**
 * Standard vi.mock() declarations that every action test needs.
 * These MUST be called at the module level (not inside describe/it).
 */
export function declareStandardMocks() {
  vi.mock("@/lib/auth", () => ({
    auth: { api: { getSession: vi.fn() } },
  }))
  vi.mock("next/headers", () => ({
    headers: vi.fn().mockResolvedValue(new Headers()),
  }))
  vi.mock("next/cache", () => ({
    revalidatePath: vi.fn(),
  }))
}
```

Note: `vi.mock()` calls are hoisted by Vitest, so `declareStandardMocks()` won't work as a regular function call. Instead, each test file still needs the 3 standard `vi.mock()` calls at the top. The value of `setupActionMocks()` is consolidating the `vi.mocked()` wrappers and session fixtures.

Update the factory to remove `declareStandardMocks` — it can't work due to hoisting. The shared value is in `setupActionMocks()`.

- [ ] **Step 2: Migrate `creditor.actions.test.ts` as proof of concept**

Replace the per-file mock setup:
```ts
// Before: 30 lines of manual setup
const mockGetSession = vi.mocked(auth.api.getSession)
const mockRevalidatePath = vi.mocked(revalidatePath)
const fakeSession = { ... } as any
const lowRoleSession = { ... } as any

// After: 1 line
import { setupActionMocks } from "./test-utils"
const { mockGetSession, mockRevalidatePath, fakeSession, lowRoleSession } = setupActionMocks()
```

- [ ] **Step 3: Run creditor test to verify**

Run: `npx vitest run src/actions/__tests__/creditor.actions.test.ts`
Expected: PASS

- [ ] **Step 4: Migrate remaining test files**

Apply the same pattern to all 10 other test files:
- `chat.actions.test.ts`
- `daily-collections.actions.test.ts`
- `dashboard.actions.test.ts`
- `expense.actions.test.ts`
- `fund-transfer.actions.test.ts`
- `income.actions.test.ts`
- `notification.actions.test.ts`
- `rate-change-request.actions.test.ts`
- `settings.actions.test.ts`
- `settlement.actions.test.ts`

Each file: replace manual `vi.mocked()` wrappers and session fixtures with `setupActionMocks()`. Keep the service-specific `vi.mock()` calls.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/actions/__tests__/
git commit -m "refactor: shared test factory for action tests — reduces ~150 lines of duplicated mock setup"
```

---

### Task 6: Clean up `action-utils.ts` after migrations

After Tasks 1-3, `action-utils.ts` should only contain auth-related functions. Remove the now-migrated validators and verify clean separation.

**Files:**
- Modify: `src/lib/action-utils.ts`

- [ ] **Step 1: Verify no remaining imports of `validatePositiveDecimal` / `validateRequired` from `action-utils`**

Run: `grep -r "from.*action-utils.*validate" src/`

If any hits remain, update those imports to `@/lib/validators`.

- [ ] **Step 2: Remove `validatePositiveDecimal` and `validateRequired` from `action-utils.ts`**

The file should now contain only:
- `getSession()`
- `getUserRole()`
- `requireRole()`
- `getErrorTag()`
- `getErrorField()`

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/action-utils.ts
git commit -m "refactor: remove migrated validators from action-utils — now in lib/validators"
```
