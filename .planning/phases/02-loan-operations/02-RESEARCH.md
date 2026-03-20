# Phase 2: Loan Operations - Research

**Researched:** 2026-03-20
**Domain:** Payment processing, receipt generation, email notifications, cron-based overdue detection
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Payment Edit/Delete Policy**
- Soft delete only — deleted payments keep their row with a `deleted_at` timestamp. Never hard-deleted.
- UI display: Deleted payments appear crossed out in the payment list — no data is ever truly hidden from the user.
- Permissions: The Loan Officer who recorded the payment can edit/delete it. Admins can edit/delete any payment.
- Auto-recalculate: Editing or deleting a payment triggers automatic recalculation of all subsequent payments' interest/principal split and balances.
- Reason required: Every edit and delete requires a reason/note before confirming. Stored in the audit log alongside before/after values.

**Receipt Generation**
- Technology: Browser print with `@media print` CSS. No PDF library needed. Dedicated receipt page with print-optimized layout.
- Print trigger: Manual — after loan issuance or payment recording, show a success state with a "Print Receipt" button. No auto-opening print dialogs.
- Disbursement receipt fields: Business name/logo, date, customer name & contact, loan amount (UGX), interest rate, minimum interest period, collateral details, issued-by officer name, unique receipt number.
- Repayment receipt fields: Business name/logo, date, customer name, loan reference, payment amount, interest paid, principal paid, outstanding balance after payment, received-by officer name, receipt number.
- RCPT-03 enforcement: Receipt print button is disabled (with clear message) if any required customer, loan, or payment detail is missing.

### Claude's Discretion
- Payment recording form layout and field ordering
- Receipt page styling, spacing, and typography within the print-optimized layout
- Email notification HTML template design and copy
- Success/error toast messaging after payment operations
- The INFR-04 cron job implementation approach (lightweight scheduled job for overdue detection)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LOAN-06 | Loan officer can manually record a customer payment (amount, date) | Payment service pattern mirrors `createLoan`; Server Action calling Effect service; atomic tx with audit log |
| LOAN-07 | Loan officer can edit or delete a recorded payment — every CUD written to audit log with actor, timestamp, before/after | Soft-delete columns added to payments schema; `writeAuditLog` extended with reason field; recalculation engine needed |
| LOAN-08 | System allocates payments interest-first, then applies remainder to principal | `calculateInterest()` engine already exists; allocation function calculates interest owed then subtracts from payment |
| LOAN-09 | System accepts any payment amount (no minimum repayment) | No validation floor; if payment < interest owed, all goes to interest and principal is unchanged |
| RCPT-01 | System auto-generates a printable disbursement receipt when a loan is issued | Standalone `/receipts/disbursement/[loanId]` page; `@media print` CSS; completeness guard before enabling print button |
| RCPT-02 | System generates a printable repayment receipt for each recorded payment | Standalone `/receipts/repayment/[paymentId]` page; same print CSS approach |
| RCPT-03 | System blocks receipt printing if any detail is missing | Print button disabled state with descriptive error message; completeness check in Server Component |
| ALRT-02 | System sends email notification to Admin on every payment CUD and loan disbursement — includes actor, loan reference, amount, timestamp | Resend already initialized in `src/lib/auth.ts`; extract to `src/lib/email.ts`; call from Server Actions after successful mutations |
| INFR-04 | Scheduled job (lightweight cron) for overdue loan detection and predictive alerts only | Next.js Route Handler at `/api/cron/overdue` triggered by external scheduler (Vercel Cron or cron-job.org); `calculateDaysOverdue()` engine already available |
</phase_requirements>

---

## Summary

Phase 2 builds on the financial engine and data model from Phase 1. All core infrastructure exists: the interest engine (`calculateInterest`, `calculateDailyRate`, `calculateDaysOverdue`), the payment schema, the audit service, the Resend email client, and the Effect service pattern. This phase wires them together into working user flows.

The three primary work areas are: (1) the payment service — recording, editing, soft-deleting, and the downstream recalculation of balances for subsequent payments; (2) receipt pages — two standalone routes with `@media print` CSS, one for disbursement and one for repayment; and (3) notifications — email alerts via Resend on every payment mutation and loan disbursement, plus the INFR-04 cron endpoint for overdue detection.

The most technically complex task is the recalculation cascade: when a payment is edited or deleted, all subsequent payments must have their `interest_portion`, `principal_portion`, `principal_balance_before`, and `principal_balance_after` recomputed in order. This is a replay of the interest engine over the ordered payment history and must happen in the same transaction as the mutation.

**Primary recommendation:** Build the payment service and allocation logic first — it is the foundation everything else depends on. Receipts and email can be layered on once payments work correctly.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| bignumber.js | ^10.0.2 | All monetary arithmetic in the allocation engine | Already installed; INFR-05 constraint; no native float allowed |
| effect | ^3.21.0 | Service layer wrapping async DB operations | Already installed; INFR-06 constraint; all services return `Effect<S, E, never>` |
| drizzle-orm | installed | Atomic transactions, soft delete updates, Drizzle tx callbacks | Already in use throughout Phase 1 |
| resend | ^6.9.4 | Transactional email for ALRT-02 notifications | Already initialized in `src/lib/auth.ts` |
| vitest | ^4.1.0 | Unit tests for allocation and recalculation engine | Already installed and configured |
| cypress | ^15.12.0 | E2E tests for payment recording and receipt flows | Already installed and used in Phase 1 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| next/cache `revalidatePath` | built-in | Invalidate loan detail page cache after payment mutations | After every payment CUD Server Action |
| `@media print` CSS | browser native | Receipt print layout — no PDF library needed | On the two receipt pages only |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@media print` CSS | @react-pdf/renderer | PDF library has unverified React 19 compatibility (noted as concern in STATE.md); browser print is simpler and fully decided |
| Vercel Cron | cron-job.org or node-cron | Vercel Cron requires `vercel.json`; any external HTTP trigger to a Route Handler works; decision deferred to Claude's discretion |

**Installation:** No new packages required — all dependencies from Phase 1 are sufficient.

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── actions/
│   ├── loan.actions.ts       # extend with disbursement email trigger
│   └── payment.actions.ts    # NEW: recordPayment, editPayment, deletePayment
├── services/
│   ├── payment.service.ts    # NEW: all payment DB + allocation logic
│   └── audit.service.ts      # extend writeAuditLog to accept reason field
├── lib/
│   ├── email.ts              # NEW: extracted from auth.ts; sendAdminEmail()
│   ├── interest/
│   │   └── engine.ts         # extend with allocatePayment() function
│   └── errors.ts             # extend with PaymentNotFound, ReceiptBlockedError
├── app/
│   └── (app)/
│       └── loans/
│           └── [loanId]/
│               ├── page.tsx                      # loan detail — show payments list
│               └── payments/new/page.tsx          # record payment form
│   └── receipts/
│       ├── disbursement/[loanId]/page.tsx        # RCPT-01 print page
│       └── repayment/[paymentId]/page.tsx        # RCPT-02 print page
└── api/
    └── cron/
        └── overdue/route.ts                      # INFR-04 endpoint
```

### Pattern 1: Payment Allocation (Interest-First)

**What:** Given a payment amount and the loan's current state, calculate how much goes to interest vs. principal. If payment is less than interest owed, all goes to interest and principal is unchanged. If payment exceeds interest owed, the remainder reduces principal.

**When to use:** Every call to `recordPayment` and every step in the recalculation cascade.

**Example:**
```typescript
// src/lib/interest/engine.ts — add allocatePayment()
// Source: business rules from 01-CONTEXT.md Loan Ledger Model

import BigNumber from "bignumber.js"
import { calculateInterest } from "./engine"

export type AllocationResult = {
  interestPortion: string
  principalPortion: string
  principalBalanceBefore: string
  principalBalanceAfter: string
}

export function allocatePayment(
  paymentAmount: string,
  principalBalanceBefore: string,
  monthlyRateDecimal: string,
  daysElapsed: number,
  minInterestDays: number,
  carriedForwardUnpaidInterest: string = "0"
): AllocationResult {
  const payment = new BigNumber(paymentAmount)
  const interestOwed = calculateInterest(
    principalBalanceBefore,
    monthlyRateDecimal,
    daysElapsed,
    minInterestDays
  ).plus(new BigNumber(carriedForwardUnpaidInterest))

  if (payment.isLessThanOrEqualTo(interestOwed)) {
    return {
      interestPortion: formatAmount(payment),
      principalPortion: "0.00",
      principalBalanceBefore,
      principalBalanceAfter: principalBalanceBefore, // unchanged
    }
  }

  const principalPortion = payment.minus(interestOwed)
  const principalBalanceAfter = new BigNumber(principalBalanceBefore).minus(principalPortion)

  return {
    interestPortion: formatAmount(interestOwed),
    principalPortion: formatAmount(principalPortion),
    principalBalanceBefore,
    principalBalanceAfter: formatAmount(BigNumber.max(principalBalanceAfter, 0)),
  }
}
```

### Pattern 2: Recalculation Cascade

**What:** When a payment is edited or deleted, fetch all payments for the loan ordered by `payment_date ASC`, replay the allocation engine from the modified/removed payment forward, and update every subsequent payment row in the same transaction.

**When to use:** Inside `editPayment` and `deletePayment` service functions.

**Example:**
```typescript
// src/services/payment.service.ts
// Source: derived from 01-CONTEXT.md payment table columns spec

async function recalculateFromPayment(
  tx: any,
  loanId: string,
  fromPaymentIndex: number,
  paymentsOrdered: Payment[]
): Promise<void> {
  // Walk from `fromPaymentIndex` to end of list
  // For each payment: re-run allocatePayment() with the
  // principalBalanceAfter from the PREVIOUS payment row
  // Then UPDATE the row with new portions and balances
  // CRITICAL: all inside the same `tx` — no separate commits
}
```

### Pattern 3: Soft Delete

**What:** Set `deleted_at = now()`, `deleted_by = actorId`, `delete_reason = reason` on the payment row. Never `DELETE FROM payments`. Subsequent queries must filter `WHERE deleted_at IS NULL` to exclude soft-deleted rows from active calculations.

**When to use:** `deletePayment` service function; all payment list queries.

**Example:**
```typescript
// Schema addition to payments.ts
deletedAt: timestamp("deleted_at", { withTimezone: true }),
deletedBy: text("deleted_by"),
deleteReason: text("delete_reason"),
editReason: text("edit_reason"),  // also for edits
```

### Pattern 4: Server Action calling Effect service

**What:** All mutating operations follow the Phase 1 pattern: `"use server"` file, auth check, runtime string guards, `Effect.runPromise(service(...))`, catch tagged errors, return `{ data }` or `{ error }`.

**When to use:** `payment.actions.ts` for all three operations (record, edit, delete).

```typescript
// src/actions/payment.actions.ts
"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { recordPayment } from "@/services/payment.service"
import { PaymentNotFound, LoanNotFound, DatabaseError } from "@/lib/errors"

export async function recordPaymentAction(input: RecordPaymentInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  // runtime guards on input fields...

  try {
    const data = await Effect.runPromise(
      recordPayment(input, session.user.id)
    )
    revalidatePath(`/loans/${input.loanId}`)
    // fire-and-forget admin email — do NOT await inside the action to avoid
    // blocking the user if email fails; wrap in void sendAdminEmail(...)
    void sendAdminNotification("payment.created", data, session.user)
    return { data }
  } catch (error) {
    if (error instanceof LoanNotFound) return { error: "Loan not found" }
    return { error: "Internal server error" }
  }
}
```

### Pattern 5: Email notification (Resend)

**What:** Extract Resend instance from `src/lib/auth.ts` to a shared `src/lib/email.ts`. `sendAdminEmail()` is a plain async function (not Effect) called fire-and-forget from Server Actions after successful mutations.

**When to use:** After `recordPayment`, `editPayment`, `deletePayment`, and `createLoan`.

```typescript
// src/lib/email.ts
import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendAdminNotification(
  event: "payment.created" | "payment.updated" | "payment.deleted" | "loan.disbursed",
  payload: { actor: string; loanRef: string; amount: string; timestamp: Date }
): Promise<void> {
  // Fetch admin email addresses from DB or env
  // resend.emails.send({ from: ..., to: adminEmails, subject: ..., html: ... })
}
```

### Pattern 6: Receipt Page with `@media print`

**What:** A React Server Component at `/receipts/disbursement/[loanId]` and `/receipts/repayment/[paymentId]`. Fetches data server-side. Renders print-ready layout. Uses CSS `@media print` to hide browser chrome. Print button calls `window.print()`.

```typescript
// app/receipts/disbursement/[loanId]/page.tsx
export default async function DisbursementReceiptPage({
  params,
}: {
  params: Promise<{ loanId: string }>
}) {
  const { loanId } = await params
  // fetch loan + customer + collateral
  // check completeness — if missing fields, render error state with disabled button
  return (
    <>
      <div className="print:hidden">
        <button onClick={() => window.print()}>Print Receipt</button>
      </div>
      <div className="receipt-body">
        {/* receipt fields */}
      </div>
    </>
  )
}
```

### Pattern 7: INFR-04 Cron Endpoint

**What:** A Route Handler at `/api/cron/overdue` that accepts GET requests. Protected by a secret header. Queries all active loans, runs `calculateDaysOverdue()` on each, and flags loans with `days_overdue >= 30`. Does NOT update financial columns — read-only detection only.

```typescript
// app/api/cron/overdue/route.ts
import { type NextRequest } from "next/server"

export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get("x-cron-secret")
  if (cronSecret !== process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  // query active loans, compute overdue, write results (e.g. flagged loan IDs)
  return Response.json({ processed: count, flagged: flaggedIds })
}
```

Triggered via Vercel Cron (`vercel.json`) or external scheduler hitting the endpoint.

### Anti-Patterns to Avoid

- **Effect.runPromise inside a Drizzle tx callback:** Confirmed in Phase 1 decisions — causes runtime errors. Always use `await writeAuditLog(tx, ...)` directly. Never wrap the audit log write in `Effect.runPromise`.
- **Native float arithmetic on monetary values:** Even for comparisons. `payment.isLessThanOrEqualTo(interestOwed)` — always BigNumber.
- **Hard deleting payments:** The schema must allow soft-delete only. All payment history is immutable from a data perspective; soft delete is the only acceptable remove operation.
- **Blocking on email in Server Action:** `sendAdminNotification()` must be fire-and-forget (`void sendAdminNotification(...)`) so that email delivery failure never blocks the user's transaction.
- **Recalculating outside a transaction:** The recalculation cascade and the triggering mutation (edit/delete) must be inside a single `db.transaction()` call. Partial updates leave the database in an inconsistent state.
- **params as sync value in App Router:** In Next.js 16, `params` in page components is a Promise — always `await params` before accessing properties. Confirmed from existing codebase pattern.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDF generation | Custom PDF builder | `@media print` CSS (decided) | Phase 1 STATE.md blocker note — React 19 compatibility unverified for @react-pdf; browser print is zero-dependency and fully decided |
| Email delivery | Custom SMTP client | Resend (already installed) | Handles retries, delivery, SPF/DKIM, already initialized |
| Interest arithmetic | Native JS math | `bignumber.js` (already installed) | Floating point precision errors on UGX amounts; INFR-05 constraint |
| Audit logging | Custom logger | `writeAuditLog(tx, entry)` (already built) | Phase 1 service handles in-transaction writes correctly |
| Receipt number generation | UUID | Loan/payment UUID formatted as short reference | Already have UUID primary keys; format as `LOAN-{first8chars}` for display |

**Key insight:** This phase is almost entirely wiring together Phase 1 primitives. The interest engine, audit service, Resend instance, and Effect pattern are all built. The work is: allocation logic, recalculation cascade, receipt pages, and email calls.

---

## Common Pitfalls

### Pitfall 1: Days elapsed calculation at payment time
**What goes wrong:** Calculating `daysElapsed` as calendar days between payment_date and loan start_date, ignoring that each payment creates a new period. The correct calculation is days since the *last* payment (or loan start date if first payment).
**Why it happens:** Easy to conflate total loan age with the current period length.
**How to avoid:** Always compute `daysElapsed = daysBetween(lastPaymentDate ?? loanStartDate, thisPaymentDate)` using the previous payment's `payment_date` as the period start.
**Warning signs:** Interest amounts that grow monotonically regardless of prior payments.

### Pitfall 2: Recalculation order dependency
**What goes wrong:** Recalculating payments out of chronological order causes cascade errors — each payment's `principalBalanceBefore` depends on the previous payment's `principalBalanceAfter`.
**Why it happens:** DB queries not sorted, or index off-by-one when replaying from the modified payment.
**How to avoid:** Always fetch payments `ORDER BY payment_date ASC, created_at ASC`. Replay from the modified/deleted payment index, not from the beginning (unless required for correctness verification).
**Warning signs:** Balance inconsistencies — `principalBalanceBefore` on row N+1 does not match `principalBalanceAfter` on row N.

### Pitfall 3: Soft-deleted payments included in active calculations
**What goes wrong:** Leaving out the `WHERE deleted_at IS NULL` filter when fetching payments for interest calculation or recalculation causes deleted payments to influence the financial math.
**Why it happens:** Forgetting to add the filter on new queries.
**How to avoid:** Define a shared `activePayments` query helper that always includes the `isNull(payments.deletedAt)` condition via Drizzle.
**Warning signs:** Outstanding balance does not increase after a deletion that should remove a principal reduction.

### Pitfall 4: Email blocking user transaction
**What goes wrong:** `await sendAdminNotification(...)` in a Server Action — if Resend is slow or fails, the user's payment recording appears to hang or error even though the DB write succeeded.
**Why it happens:** Natural instinct to await async side effects.
**How to avoid:** Always `void sendAdminNotification(...)` (fire-and-forget). Log email errors internally but never surface them to the user via the Server Action return value.
**Warning signs:** Payment operations taking 1–3+ seconds intermittently.

### Pitfall 5: Receipt page accessing `params` synchronously
**What goes wrong:** `const { loanId } = params` (not awaited) fails in Next.js 16 App Router where `params` is a Promise.
**Why it happens:** Training data / documentation for older Next.js treated params as sync.
**How to avoid:** Always `const { loanId } = await params` in async server components.
**Warning signs:** Type errors at build time; runtime `params.loanId` is undefined.

### Pitfall 6: Loan status not updated to "active" after first payment
**What goes wrong:** Recording a payment against a "pending" loan without transitioning status to "active" leaves the loan in an incorrect state.
**Why it happens:** Payment and loan status updates in separate queries without awareness of the lifecycle.
**How to avoid:** In the `recordPayment` service transaction, check if loan status is "pending" and update to "active" in the same `db.transaction()`.
**Warning signs:** Loans remain "pending" after payments are recorded; dashboard counts are wrong.

### Pitfall 7: Fully-paid detection off-by-one
**What goes wrong:** After a payment that reduces principal to zero (or below zero due to overpayment), the loan status should transition to "fully_paid". If the check uses native float comparison (`principalBalanceAfter <= 0`) on a string-stored NUMERIC value, false negatives occur.
**Why it happens:** Drizzle returns NUMERIC columns as strings from PostgreSQL; comparing to 0 requires BigNumber.
**How to avoid:** `if (new BigNumber(allocation.principalBalanceAfter).isLessThanOrEqualTo(0)) { status = "fully_paid" }`

---

## Code Examples

### Allocation engine skeleton
```typescript
// src/lib/interest/engine.ts addition
// Source: business rules in .planning/phases/01-foundation/01-CONTEXT.md

export type PaymentAllocation = {
  interestPortion: string       // NUMERIC(15,2) string
  principalPortion: string      // NUMERIC(15,2) string
  principalBalanceBefore: string
  principalBalanceAfter: string
  loanFullyPaid: boolean
}

export function allocatePayment(params: {
  paymentAmount: string
  principalBalanceBefore: string
  monthlyRateDecimal: string
  daysElapsed: number
  minInterestDays: number
}): PaymentAllocation {
  const { paymentAmount, principalBalanceBefore, monthlyRateDecimal, daysElapsed, minInterestDays } = params
  const payment = new BigNumber(paymentAmount)
  const interestOwed = calculateInterest(principalBalanceBefore, monthlyRateDecimal, daysElapsed, minInterestDays)

  if (payment.isLessThanOrEqualTo(interestOwed)) {
    return {
      interestPortion: formatAmount(payment),
      principalPortion: "0.00",
      principalBalanceBefore,
      principalBalanceAfter: principalBalanceBefore,
      loanFullyPaid: false,
    }
  }

  const principalPortion = payment.minus(interestOwed)
  const principalBalanceAfter = BigNumber.max(
    new BigNumber(principalBalanceBefore).minus(principalPortion),
    0
  )

  return {
    interestPortion: formatAmount(interestOwed),
    principalPortion: formatAmount(principalPortion),
    principalBalanceBefore,
    principalBalanceAfter: formatAmount(principalBalanceAfter),
    loanFullyPaid: principalBalanceAfter.isZero(),
  }
}
```

### Payment schema migration (soft delete columns)
```typescript
// src/lib/db/schema/payments.ts — additions
editReason: text("edit_reason"),
deletedAt: timestamp("deleted_at", { withTimezone: true }),
deletedBy: text("deleted_by"),
deleteReason: text("delete_reason"),
```

### Drizzle soft-delete query pattern
```typescript
// Always include this filter in payment queries
import { isNull } from "drizzle-orm"

const activePayments = await tx
  .select()
  .from(payments)
  .where(and(eq(payments.loanId, loanId), isNull(payments.deletedAt)))
  .orderBy(asc(payments.paymentDate), asc(payments.createdAt))
```

### Receipt print CSS pattern
```css
/* globals.css or receipt page inline */
@media print {
  .print-hidden { display: none !important; }
  body { background: white; }
  .receipt-body { max-width: 100%; }
}
```

```tsx
// Receipt button — Tailwind print utilities
<div className="print:hidden flex gap-2">
  <button onClick={() => window.print()}>Print Receipt</button>
</div>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Auto-print on page load | Manual "Print Receipt" button (decided) | Phase 2 context decision | No jarring auto-dialog; user controls when to print |
| Separate rate-period table | Payment table IS the rate-period table | Phase 1 architecture decision | Simpler schema; interest always computed on-demand from payment history |
| PDF libraries for receipts | `@media print` CSS | Phase 2 context decision | Zero new dependency; avoids React 19 compat risk |
| Route Handlers for mutations | Server Actions (decided) | User feedback, Phase 1 | No fetch ceremony; direct function calls from client components |

**Deprecated/outdated:**
- `@react-pdf/renderer`: React 19 compatibility unverified in this environment (STATE.md blocker note). Do not use.
- `effect.js Context.Tag / Layer`: Deferred to Phase 2+ per 01-CONTEXT.md decision. Services still return `Effect<S, E, never>` with `db` closed over module scope. Do NOT introduce full Layer wiring in Phase 2 unless explicitly decided.

---

## Open Questions

1. **Admin email address source for ALRT-02**
   - What we know: Resend sends to a `to` array; the system has users with roles in the DB.
   - What's unclear: Should `sendAdminNotification` query the DB for all users with `role IN ('admin', 'superAdmin')` dynamically, or should there be a configured `ADMIN_ALERT_EMAIL` env var?
   - Recommendation: Query DB for active admin emails dynamically — avoids env var maintenance, stays consistent with role changes. Performance cost is one extra query per mutation event (fire-and-forget, acceptable).

2. **Cron job trigger mechanism (Claude's Discretion)**
   - What we know: Next.js Route Handler at `/api/cron/overdue` is the right approach; external HTTP trigger.
   - What's unclear: Whether to use `vercel.json` cron configuration or document a manual external scheduler setup.
   - Recommendation: Use `vercel.json` cron if Vercel deployment is assumed (most likely); otherwise document `cron-job.org` pointing at the endpoint with `x-cron-secret` header. The Route Handler itself is deployment-agnostic.

3. **Receipt number format**
   - What we know: Must be unique per receipt; UUIDs exist as primary keys.
   - What's unclear: Whether client wants a short human-readable format (e.g., `PAY-A3B2C1D4`) or if UUID is acceptable on the printed receipt.
   - Recommendation: Use first 8 characters of UUID uppercased for display (`LOAN-{id.slice(0,8).toUpperCase()}` and `PAY-{id.slice(0,8).toUpperCase()}`). Unique in practice, human-readable enough for a receipt.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | `vitest.config.ts` (exists) |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` (runs all `src/**/*.test.ts`) |

Cypress 15.12.0 for E2E; run via `pnpm cypress run`.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LOAN-06 | Record payment with correct interest-first allocation | unit | `pnpm test src/lib/interest/__tests__/engine.test.ts` | ✅ (extend engine.test.ts) |
| LOAN-07 | Soft delete sets deleted_at; edit writes audit row with reason | unit | `pnpm test src/services/__tests__/payment.service.test.ts` | ❌ Wave 0 |
| LOAN-08 | Interest-first allocation: payment < interest → all to interest, zero principal reduction | unit | `pnpm test src/lib/interest/__tests__/engine.test.ts` | ✅ (extend) |
| LOAN-09 | Any amount accepted — no minimum validation error | unit | `pnpm test src/lib/interest/__tests__/engine.test.ts` | ✅ (extend) |
| RCPT-01 | Disbursement receipt renders all required fields | E2E | `pnpm cypress run --spec cypress/e2e/receipts.cy.ts` | ❌ Wave 0 |
| RCPT-02 | Repayment receipt shows correct allocation amounts | E2E | `pnpm cypress run --spec cypress/e2e/receipts.cy.ts` | ❌ Wave 0 |
| RCPT-03 | Print button disabled when required fields missing | E2E | `pnpm cypress run --spec cypress/e2e/receipts.cy.ts` | ❌ Wave 0 |
| ALRT-02 | Email sent after payment CUD (manual verification / mock test) | manual-only | N/A — Resend in test mode; verify via console log or mock | N/A |
| INFR-04 | Cron endpoint returns flagged loan IDs; rejects missing secret | unit | `pnpm test src/app/api/cron/__tests__/overdue.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test` (unit suite, ~5 seconds)
- **Per wave merge:** `pnpm test && pnpm cypress run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/services/__tests__/payment.service.test.ts` — covers LOAN-07 (soft delete, audit with reason, recalculation cascade)
- [ ] `src/app/api/cron/__tests__/overdue.test.ts` — covers INFR-04 (endpoint auth, loan query, flagging logic)
- [ ] `cypress/e2e/receipts.cy.ts` — covers RCPT-01, RCPT-02, RCPT-03 (receipt pages render, print button enabled/disabled)
- [ ] Extend `src/lib/interest/__tests__/engine.test.ts` with `allocatePayment()` tests covering LOAN-08/09

---

## Sources

### Primary (HIGH confidence)
- `src/lib/interest/engine.ts` — verified interest engine functions (`calculateInterest`, `calculateDailyRate`, `calculateDaysOverdue`, `formatAmount`)
- `src/services/loan.service.ts` — confirmed service pattern: Effect wrapper, atomic tx, `writeAuditLog` direct await
- `src/services/audit.service.ts` — confirmed `writeAuditLog(tx, entry)` signature
- `src/lib/auth.ts` — confirmed Resend initialized; `pendingVerifications` pattern for test mode
- `src/lib/db/schema/payments.ts` — confirmed existing columns; soft-delete columns not yet present
- `src/lib/errors.ts` — confirmed tagged error classes; PaymentNotFound and ReceiptBlockedError not yet defined
- `node_modules/next/dist/docs/01-app/02-guides/forms.md` — Server Actions pattern for this Next.js version
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md` — `revalidatePath` API confirmed
- `.planning/phases/01-foundation/01-CONTEXT.md` — Loan Ledger Model: payment table columns, allocation rules, minimum period formula
- `.planning/phases/02-loan-operations/02-CONTEXT.md` — all Phase 2 locked decisions

### Secondary (MEDIUM confidence)
- `vitest.config.ts` — confirmed test environment, include patterns, path alias
- `cypress/e2e/loans-list.cy.ts` — confirmed Cypress `db:reset` + `registerAndLogin` test patterns

### Tertiary (LOW confidence)
- None — all claims in this document are verified from direct codebase inspection or official Next.js docs.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified as installed; no new packages needed
- Architecture: HIGH — patterns derived directly from Phase 1 codebase; no speculation
- Pitfalls: HIGH — pitfalls 1, 2, 3, 5, 6, 7 are mechanical code issues verifiable from schema + engine; pitfall 4 is confirmed email-blocking anti-pattern
- Receipt pattern: HIGH — decided in CONTEXT.md; `@media print` is browser-native, zero risk
- Cron approach: MEDIUM — Route Handler approach confirmed; trigger mechanism (Vercel Cron vs. external) left to Claude's discretion

**Research date:** 2026-03-20
**Valid until:** 2026-04-20 (stable stack; locked decisions; 30-day validity)
