# Phase 8: Quick-Record Workflow - Research

**Researched:** 2026-03-23
**Domain:** React dialog UI, Drizzle ORM search queries, TanStack Query mutation + invalidation, Server Actions
**Confidence:** HIGH

## Summary

Phase 8 adds a quick-record dialog to the /payments page so a loan officer can search for an active loan by customer name, select it from an inline combobox, fill a payment form, submit, and see a receipt link — without navigating away. A "recently-collected" chip list pre-fills the form for repeat collections on bulk days.

All infrastructure is already in place: `recordPaymentAction` handles recording, `PaymentsClient` has TanStack Query setup, `Dialog` / `Popover` / `Input` are already imported in the payments directory, and `useSession` provides the current user ID. The work is additive: new service functions for loan search and recent-loans query, two new Server Actions, two new React components (`QuickRecordDialog`, `LoanSearchCombobox`), and a button wired into `PaymentsClient`.

The sidebar Payments link already has no `disabled: true` flag (it was removed in a prior phase), so STATE.md's note about "last step" is already satisfied — just verify no disabled flag is present at the end of implementation.

**Primary recommendation:** Build the data layer first (service + actions for search and recent loans), then build the dialog component against it. Follow the Popover + Input pattern established in `DailyCollectionsTab.tsx`, and use `queryClient.invalidateQueries({ queryKey: ["payments"] })` for list refresh — exactly as `handleEditSubmit` and `handleDeleteSubmit` already do.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Recently-collected list appears inside the quick-record dialog, above the loan search combobox
- Shows last 5 distinct loans the current user recorded payments for (per-user, not global)
- Displayed as clickable chips: customer name + loan ref per chip
- One tap on a chip selects the loan and pre-fills the form (same as selecting from search)
- Updates immediately after a successful payment — the just-paid loan moves to position 1
- Data source: query payments table filtered by `recordedBy = currentUser`, ordered by `paymentDate DESC`, distinct on `loanId`, limit 5

### Claude's Discretion
- Loan search combobox design (Popover + Input pattern per STATE.md — no cmdk)
- Search result display: what info per result row (customer name, loan ref, outstanding balance)
- Record form fields and layout (amount, payment date, notes)
- Dialog vs Sheet choice for the quick-record modal
- Success state design: where receipt link appears, auto-dismiss timing, toast vs inline
- Payment date default (today or selectable)
- Amount field: plain input or with UGX prefix
- Loading/empty states in search results
- How the payments list refreshes after recording (TanStack Query invalidation)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| QREC-01 | User can record a payment by searching and selecting a loan without leaving the payments page | `searchActiveLoansAction` + `LoanSearchCombobox` + `QuickRecordDialog` — all additive to existing PaymentsClient |
| QREC-02 | User can see a receipt link after successfully recording a payment | `recordPaymentAction` returns `{ data: { id } }` — receipt URL is `/receipts/repayment/[paymentId]`; render link in dialog success state |
| QREC-03 | User can see a list of recently-collected loans for quick repeat selection | New `getRecentlyCollectedLoansAction(userId, limit=5)` wrapping a Drizzle query with DISTINCT ON loanId |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React (Next.js) | project version | Component + state management | Already in use |
| TanStack Query | project version | Client data fetching, cache invalidation | Already used in PaymentsClient |
| Drizzle ORM | project version | Type-safe Postgres queries | Used in all services |
| Effect.js | project version | Service layer wrapper | All services use `Effect.tryPromise` |
| Sonner | project version | Toast notifications | Used on success/error in PaymentsClient |
| base-ui Popover | project version | Combobox container | Established in DailyCollectionsTab |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | project version | Icons (Search, X, ChevronDown) | UI affordances |
| date-fns | project version | Payment date default to today | `format(new Date(), "yyyy-MM-dd")` |
| BigNumber.js | project version | Outstanding balance display | Consistent with rest of codebase |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Popover + Input | cmdk (Command) | cmdk was explicitly rejected in STATE.md due to Radix peer-dependency conflicts — do not use |
| Dialog | Sheet | Claude's discretion; Dialog is simpler for a focused form; Sheet is better for multi-step flows |

**Installation:** No new packages needed. All dependencies already in the project.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── actions/
│   └── payment.actions.ts          # Add searchActiveLoansAction, getRecentlyCollectedLoansAction
├── services/
│   └── payment.service.ts          # Add searchActiveLoans(), getRecentlyCollectedLoans()
├── app/(app)/payments/
│   ├── PaymentsClient.tsx           # Add "Record Payment" button, render QuickRecordDialog
│   ├── QuickRecordDialog.tsx        # New: dialog with LoanSearchCombobox + form + success state
│   └── LoanSearchCombobox.tsx       # New: Popover + Input combobox for active loan search
└── types/index.ts                   # Add ActiveLoanSearchResult type
```

### Pattern 1: Popover + Input Combobox (Established)

**What:** Popover wraps a text input. On input change, call a Server Action for search results, display in PopoverContent. PopoverTrigger uses `render` prop pattern (not `asChild`).
**When to use:** Any searchable dropdown in this codebase (no cmdk).

**Example — PopoverTrigger render prop pattern (from DailyCollectionsTab.tsx):**
```tsx
// Source: src/app/(app)/payments/DailyCollectionsTab.tsx lines 81-103
<Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
  <PopoverTrigger
    render={
      <button
        type="button"
        className="inline-flex ... rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    }
  >
    {label}
  </PopoverTrigger>
  <PopoverContent className="w-auto p-0" align="start">
    {/* content */}
  </PopoverContent>
</Popover>
```

For a combobox where the trigger IS the input (not a button), open the Popover when the input has focus and has content. Control `open` state manually:
```tsx
const [open, setOpen] = useState(false)
const [query, setQuery] = useState("")

function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
  const val = e.target.value
  setQuery(val)
  setOpen(val.length >= 2)  // show results once user types 2+ chars
}
```

### Pattern 2: Server Action for search results

**What:** Non-mutating Server Actions for queries are acceptable for on-demand calls (not paginated, no staleTime needed). Return typed arrays.
**When to use:** Inline search that fires on every keystroke after debounce.

```tsx
// Source: existing pattern in payment.actions.ts
"use server"
export async function searchActiveLoansAction(query: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(searchActiveLoans(query))
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}
```

### Pattern 3: Service function for active loan search

**What:** Drizzle query joining loans + customers, filtering `status = 'active'`, `isNull(loans.deletedAt)`, and `ilike(customers.fullName, '%query%')`.

```ts
// Drizzle ilike pattern (used in listPayments for customerName filter):
// Source: src/services/payment.service.ts uses ilike from drizzle-orm
import { ilike, and, eq, isNull } from "drizzle-orm"

const rows = await db
  .select({
    loanId: loans.id,
    customerName: customers.fullName,
    customerId: customers.id,
    principalAmount: loans.principalAmount,
    // outstanding balance requires joining last payment's principalBalanceAfter
    // simplest: return principalAmount; exact outstanding requires subquery
  })
  .from(loans)
  .innerJoin(customers, eq(loans.customerId, customers.id))
  .where(
    and(
      eq(loans.status, "active"),
      isNull(loans.deletedAt),
      ilike(customers.fullName, `%${query}%`)
    )
  )
  .limit(10)
```

**Outstanding balance note:** The simplest accurate source for outstanding balance is `principalBalanceAfter` from the most recent non-deleted payment for that loan. This requires a subquery or a lateral join. For search result display, returning `principalAmount` (loan's original amount) is a usable approximation for MVP. If exact balance is needed, use a subquery — see `dashboard.service.ts` which already does the max-payment pattern for each active loan.

### Pattern 4: Recently-collected loans query (DISTINCT ON)

**What:** Postgres `DISTINCT ON (loan_id)` with `ORDER BY loan_id, payment_date DESC` gives the most recent payment per loan. Then wrapping that in a CTE and selecting LIMIT 5 ordered by paymentDate DESC gives the last 5 distinct loans.

Drizzle ORM does not natively support `DISTINCT ON` in its select builder. Use `sql` template for this specific query:

```ts
// Source: Drizzle docs — use sql`` for Postgres-specific syntax
import { sql } from "drizzle-orm"

const rows = await db.execute(sql`
  SELECT DISTINCT ON (p.loan_id)
    p.loan_id,
    p.payment_date,
    c.full_name as customer_name
  FROM payments p
  JOIN loans l ON l.id = p.loan_id
  JOIN customers c ON c.id = l.customer_id
  WHERE p.recorded_by = ${userId}
    AND p.deleted_at IS NULL
  ORDER BY p.loan_id, p.payment_date DESC
  LIMIT 5
`)
```

Wait — this gives at most 1 row per loan but will not give you the 5 most-recently-collected distinct loans overall. The correct query is a subquery:

```sql
SELECT DISTINCT ON (loan_id) loan_id, customer_name, payment_date
FROM payments JOIN customers ...
WHERE recorded_by = $userId AND deleted_at IS NULL
ORDER BY loan_id, payment_date DESC
-- then sort the outer result by payment_date DESC LIMIT 5
```

Wrap with a subquery in Drizzle using `sql`:
```ts
const rows = await db.execute(sql`
  SELECT * FROM (
    SELECT DISTINCT ON (p.loan_id)
      p.loan_id,
      c.full_name   AS customer_name,
      p.payment_date
    FROM payments p
    INNER JOIN loans   l ON l.id = p.loan_id
    INNER JOIN customers c ON c.id = l.customer_id
    WHERE p.recorded_by = ${userId}
      AND p.deleted_at IS NULL
    ORDER BY p.loan_id, p.payment_date DESC
  ) sub
  ORDER BY sub.payment_date DESC
  LIMIT 5
`)
```

This is the canonical form for the QREC-03 requirement. Confidence: HIGH (standard Postgres pattern).

### Pattern 5: Dialog + success state with receipt link

**What:** After `recordPaymentAction` succeeds, the dialog enters a "success" view showing a receipt link. Receipt URL is `/receipts/repayment/[paymentId]`. The returned `data.id` is the payment ID.

```tsx
// After successful submission:
const result = await recordPaymentAction({ loanId, amount, paymentDate })
if ("error" in result) {
  toast.error(result.error)
  return
}
// Switch to success state — do NOT close the dialog
setSuccessPaymentId(result.data.id)
queryClient.invalidateQueries({ queryKey: ["payments"] })
// Also update recently-collected list (re-fetch)
queryClient.invalidateQueries({ queryKey: ["recentLoans"] })
```

Success state renders:
```tsx
<div>
  <p>Payment recorded successfully.</p>
  <Link href={`/receipts/repayment/${successPaymentId}`} target="_blank">
    View receipt
  </Link>
  <Button onClick={handleRecordAnother}>Record another</Button>
  <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
</div>
```

### Pattern 6: TanStack Query for recently-collected list

**What:** Use `useQuery` for the recently-collected list with the userId as part of the query key. Invalidate after each successful payment.

```tsx
const { data: recentLoans } = useQuery({
  queryKey: ["recentLoans", session?.user?.id],
  queryFn: async () => {
    if (!session?.user?.id) return []
    const result = await getRecentlyCollectedLoansAction(session.user.id)
    if ("error" in result) return []
    return result.data
  },
  enabled: !!session?.user?.id,
  staleTime: 0,  // always fresh after invalidation
})
```

### Pattern 7: recordPaymentAction needs revalidatePath("/payments") added

The existing `recordPaymentAction` (line 45) only calls `revalidatePath(\`/loans/${input.loanId}\`)`. Phase 8 needs to also add `revalidatePath("/payments")` so the server-rendered initial data is fresh. This is the minimal change to the existing action.

### Anti-Patterns to Avoid
- **Using cmdk Command component:** Rejected in STATE.md due to Radix peer-dependency conflicts. Build combobox from Popover + Input.
- **Closing dialog on success:** Show the receipt link inside the dialog; let user explicitly close or "Record another". Premature close loses the receipt link.
- **Optimistic update for recently-collected:** Invalidate and re-fetch instead. The list is small, fast, and the DISTINCT ON query is inexpensive.
- **DISTINCT ON in Drizzle select builder:** Drizzle's `.distinct()` is `SELECT DISTINCT *`, not `SELECT DISTINCT ON (col)`. Use `db.execute(sql`...`)` for the recently-collected query.
- **Debouncing search in dialog with router.push:** The search is local state, not URL-driven. Debounce with `setTimeout` inside the component, same pattern as `scheduleApply` in PaymentsClient.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Payment recording logic | Custom form with interest calc | `recordPaymentAction` (already exists) | Full Effect.js service with allocation and cascade recalculation |
| Receipt page | Custom receipt renderer | `/receipts/repayment/[paymentId]` (already exists) | Receipt page fully built in Phase 5 |
| Auth session in Server Action | Manual cookie parsing | `auth.api.getSession({ headers: await headers() })` | Established pattern in all actions |
| Toast notifications | Custom notification | Sonner `toast.success` / `toast.error` | Already wired in PaymentsClient |
| Combobox | cmdk Command | Popover + Input (base-ui) | Established pattern; cmdk rejected in STATE.md |

**Key insight:** This phase is almost entirely UI composition. All service-level complexity (payment recording, cascade recalculation, audit logging, email notifications) is already built. The two new service functions are read-only queries of low complexity.

---

## Common Pitfalls

### Pitfall 1: DISTINCT ON syntax in Drizzle
**What goes wrong:** Developer writes `db.select().distinct()` expecting `DISTINCT ON (loan_id)`, gets `SELECT DISTINCT *` (returns one row per unique full row, not per loan).
**Why it happens:** Drizzle's `.distinct()` is not `DISTINCT ON` — they are different SQL clauses.
**How to avoid:** Use `db.execute(sql`SELECT DISTINCT ON ...`)` for the recently-collected query. Test with a user who has recorded multiple payments on the same loan.
**Warning signs:** Recently-collected list shows multiple entries for the same loan.

### Pitfall 2: Search combobox popover leaking outside dialog
**What goes wrong:** A Popover inside a Dialog can have z-index or portal conflicts, causing the PopoverContent to render behind the Dialog overlay.
**Why it happens:** Both Dialog and Popover use portals with different z-index layers.
**How to avoid:** Use `<PopoverContent ... sideOffset={4}>` and test visually. If needed, render PopoverContent with `style={{ zIndex: 9999 }}` or set `modal={false}` on the Popover. Check if the base-ui Popover has a `container` prop to scope the portal.
**Warning signs:** Search results not visible when typing inside the dialog.

### Pitfall 3: recordPaymentAction missing revalidatePath("/payments")
**What goes wrong:** After quick-record, the TanStack Query cache is refreshed (client-side), but the server-side initial data for the page is stale. On hard refresh, the new payment does not appear.
**Why it happens:** `recordPaymentAction` currently only revalidates `/loans/${loanId}`, not `/payments`.
**How to avoid:** Add `revalidatePath("/payments")` to `recordPaymentAction` after the `revalidatePath(\`/loans/${input.loanId}\`)` call.
**Warning signs:** After a quick-record, hard refresh of /payments does not show the new payment.

### Pitfall 4: Recently-collected list uses global payments, not per-user
**What goes wrong:** Forgetting the `WHERE recorded_by = ${userId}` clause gives all users' recent payments.
**Why it happens:** Easy to copy-paste from `getDailyCollections` which has no `recordedBy` filter.
**How to avoid:** Always include `eq(payments.recordedBy, userId)` as a WHERE condition. The `userId` comes from `useSession()` on the client and is passed down to the action.
**Warning signs:** Loan officer sees loans they didn't personally record.

### Pitfall 5: Form state not reset after "Record another"
**What goes wrong:** After clicking "Record another", the previous loan selection, amount, and date remain pre-filled.
**Why it happens:** Component state persists within the open dialog unless explicitly reset.
**How to avoid:** "Record another" handler resets all form state: `setSelectedLoan(null)`, `setAmount("")`, `setPaymentDate(todayStr)`, `setSuccessPaymentId(null)`, `setQuery("")`.
**Warning signs:** Second recording pre-fills with the previous loan.

---

## Code Examples

Verified patterns from existing source:

### TanStack Query invalidation after mutation (from PaymentsClient.tsx)
```tsx
// Source: src/app/(app)/payments/PaymentsClient.tsx lines 290-292
queryClient.invalidateQueries({ queryKey: ["payments"] })
```

### useTransition for mutation loading state (from PaymentsClient.tsx)
```tsx
// Source: src/app/(app)/payments/PaymentsClient.tsx lines 120-121
const [isEditPending, startEditTransition] = useTransition()
startEditTransition(async () => {
  const result = await editPaymentAction(...)
  if ("error" in result) { toast.error(...); return }
  toast.success("Payment updated")
  setEditOpen(false)
  queryClient.invalidateQueries({ queryKey: ["payments"] })
})
```

### ilike filter in service (from payment.service.ts)
```ts
// Source: src/services/payment.service.ts imports
import { ilike, and, eq, isNull, desc, count } from "drizzle-orm"
// Usage: ilike(customers.fullName, `%${input.customerName}%`)
```

### Effect.tryPromise service pattern (from payment.service.ts)
```ts
// Source: src/services/payment.service.ts
export const recordPayment = (
  input: RecordPaymentInput,
  actorId: string
): Effect.Effect<Payment, LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => { /* ... */ },
    catch: (e) => { /* map to typed errors */ },
  })
```

### Server Action pattern (from payment.actions.ts)
```ts
// Source: src/actions/payment.actions.ts lines 26-60
"use server"
export async function recordPaymentAction(input: RecordPaymentInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }
  try {
    const data = await Effect.runPromise(recordPayment(input, session.user.id))
    revalidatePath(`/loans/${input.loanId}`)
    return { data }
  } catch (error) {
    if (error instanceof LoanNotFound) return { error: "Loan not found" }
    return { error: "Internal server error" }
  }
}
```

### Receipt URL pattern
```tsx
// Source: src/app/(app)/receipts/repayment/[paymentId]/page.tsx (confirmed)
// Receipt page exists at /receipts/repayment/[paymentId]
// Payment ID returned from recordPaymentAction as result.data.id
const receiptUrl = `/receipts/repayment/${result.data.id}`
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Record payment via /loans/[id]/payments/new page | Record inline from /payments via dialog | Phase 8 | No navigation required |
| cmdk Command for comboboxes | Popover + Input (base-ui) | STATE.md decision | Avoids Radix peer-dep conflict |
| revalidatePath loan page only | Also revalidatePath("/payments") | Phase 8 change to action | Server cache stays fresh |

**Deprecated/outdated:**
- `disabled: true` on sidebar Payments link: Already removed in the codebase (sidebar.tsx line 54 shows no disabled flag). STATE.md's note to remove it "as the last step" is already done — just verify it remains absent at end of phase.

---

## Open Questions

1. **Outstanding balance in search results**
   - What we know: `principalAmount` is on loans; actual outstanding balance is `principalBalanceAfter` from the latest non-deleted payment
   - What's unclear: Whether to compute it in the search service or just show principal amount
   - Recommendation: Show `principalAmount` as "Principal" in search results to keep the query simple. The most recent `principalBalanceAfter` requires a lateral join or subquery that adds complexity for a small display benefit. Planner should choose based on UX priority.

2. **Debounce delay for loan search**
   - What we know: PaymentsClient uses 300ms debounce for URL filters
   - What's unclear: Whether 300ms is appropriate for an inline dialog combobox (feels slower in a dialog than in a filter bar)
   - Recommendation: Use 200ms for the dialog search; faster feedback is better for the quick-record UX.

3. **Dialog vs Sheet**
   - What we know: Claude's discretion; both Dialog and Sheet are available and used in PaymentsClient
   - What's unclear: Whether the form will feel cramped in a Dialog
   - Recommendation: Use Dialog. The form is small (loan selector, amount, date). Sheets are better for edit flows with many fields (like EditPaymentSheet).

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (unit) + Vitest integration (PGlite) + Cypress E2E |
| Config file | `vitest.config.ts` (unit), `vitest.integration.config.ts` (integration), `cypress.config.ts` (E2E) |
| Quick run command | `pnpm test` (unit), `pnpm test:integration` (integration) |
| Full suite command | `pnpm test && pnpm test:integration && npx cypress run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QREC-01 | Search active loans by customer name returns matching results | integration | `pnpm test:integration` (payment.service.test.ts) | ❌ Wave 0 — add to payment.service.test.ts |
| QREC-01 | Recently-collected query returns last 5 distinct loans for current user | integration | `pnpm test:integration` (payment.service.test.ts) | ❌ Wave 0 |
| QREC-01 | Quick-record dialog opens, loan search results render, form submits | E2E | `npx cypress run --spec cypress/e2e/payments.cy.ts` | ❌ Wave 0 — extend payments.cy.ts |
| QREC-02 | Receipt link appears in dialog success state after recording | E2E | `npx cypress run --spec cypress/e2e/payments.cy.ts` | ❌ Wave 0 |
| QREC-03 | Chip list shows last 5 distinct loans; tap pre-fills form | E2E | `npx cypress run --spec cypress/e2e/payments.cy.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test` (unit suite ~5s)
- **Per wave merge:** `pnpm test && pnpm test:integration`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/services/__integration__/payment.service.test.ts` — extend with `searchActiveLoans` and `getRecentlyCollectedLoans` behaviors (file exists, needs new test cases)
- [ ] `cypress/e2e/payments.cy.ts` — extend with quick-record E2E tests (file exists, needs new describe block)

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `src/app/(app)/payments/PaymentsClient.tsx` — TanStack Query setup, Dialog/Sheet usage, invalidation pattern
- Direct code inspection: `src/actions/payment.actions.ts` — Server Action structure, recordPaymentAction return type
- Direct code inspection: `src/app/(app)/payments/DailyCollectionsTab.tsx` — base-ui Popover render-prop pattern
- Direct code inspection: `src/services/payment.service.ts` — Effect.tryPromise pattern, ilike import usage
- Direct code inspection: `src/lib/db/schema/payments.ts` — payments schema, recordedBy field confirmed
- Direct code inspection: `src/lib/db/schema/loans.ts` — loans schema, status enum confirmed
- Direct code inspection: `.planning/phases/08-quick-record-workflow/08-CONTEXT.md` — locked decisions, canonical refs

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` — no cmdk decision, sidebar disabled removal note, PGlite integration test patterns

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed in codebase, no new packages
- Architecture: HIGH — all patterns sourced from existing code in the same files being extended
- Pitfalls: HIGH — DISTINCT ON pitfall is verified Drizzle behavior; others sourced from code inspection
- Queries: HIGH (search ilike) / MEDIUM (DISTINCT ON subquery — correct but not yet in codebase)

**Research date:** 2026-03-23
**Valid until:** 2026-04-22 (stable stack, 30-day window)
