# Phase 8: Quick-Record Workflow - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Record a payment for any active loan directly from the /payments page without navigating away. User searches for a loan via inline combobox, submits payment in a modal dialog, sees a receipt link on success, and can quickly re-select from recently-collected loans for bulk collection days. Loan search, payment form, receipt link, and recently-collected list are all within scope. Editing/deleting payments and daily collections are separate phases (6 and 7).

</domain>

<decisions>
## Implementation Decisions

### Recently-collected list
- Appears inside the quick-record dialog, above the loan search combobox
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — QREC-01 through QREC-03 define all Phase 8 requirements
- `.planning/ROADMAP.md` §Phase 8 — Success criteria, plan breakdown (08-01 data layer, 08-02 UI)

### Existing patterns
- `src/actions/payment.actions.ts` — `recordPaymentAction` is the existing Server Action for recording payments; reuse directly (add revalidation for /payments)
- `src/services/payment.service.ts` — `recordPayment` Effect service with interest allocation and cascade recalculation
- `src/app/(app)/payments/PaymentsClient.tsx` — Integration point: add quick-record trigger button here; tab architecture (list | daily) already in place
- `src/app/(app)/payments/DailyCollectionsTab.tsx` — Sibling component showing daily view; quick-record should be accessible from both tabs

### State decisions
- `.planning/STATE.md` §Accumulated Context — No `cmdk` — loan search combobox built from `<Popover>` + `<Input>` to avoid Radix peer-dependency conflicts
- `.planning/STATE.md` §Accumulated Context — Sidebar `disabled: true` removal is the last step of Phase 8, not the first

### Prior phase context
- `.planning/phases/06-global-payments-list/06-CONTEXT.md` — Phase 6 decisions on PaymentsClient patterns, TanStack Query usage
- `.planning/phases/07-daily-collections-view/07-CONTEXT.md` — Phase 7 tab architecture, DailyCollectionsTab integration

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `recordPaymentAction`: Fully functional Server Action with auth, validation, Effect service call, email notification — reuse as-is, add `revalidatePath("/payments")`
- `RecordPaymentInput` type: `{ loanId, amount, paymentDate }` — already defined in `src/types`
- `PaymentsClient.tsx`: TanStack Query setup with `queryClient.invalidateQueries` pattern — use for list refresh after recording
- UI components: Dialog, Sheet, Popover, Input, Button, Label — all available in `src/components/ui/`
- `formatNumberWithCommas()`, `formatDate()` in `lib/utils.ts`
- `useSession()` from `@/lib/auth-client` — provides current user ID for filtering recent loans

### Established Patterns
- TanStack Query for client-side data fetching (payments, expenses, income)
- Server Actions wrapping Effect.js service calls
- Popover + Input for searchable dropdowns (STATE.md decision — no cmdk)
- `useTransition` for mutation loading states
- Toast notifications via Sonner on success/error
- base-ui primitives with render prop pattern (not asChild)

### Integration Points
- New component: `QuickRecordDialog` rendered from PaymentsClient (accessible from both tabs)
- New component: `LoanSearchCombobox` using Popover + Input pattern
- New Server Action: `searchActiveLoansAction(query: string)` — searches active loans by customer name
- New service function: `searchActiveLoans(query)` — active loans with customer name ILIKE match
- New Server Action or query: `getRecentlyCollectedLoans(userId, limit)` — last 5 distinct loans paid by this user
- `recordPaymentAction` needs `revalidatePath("/payments")` added after success
- Sidebar nav: enable Payments link (remove `disabled: true`) as final step

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Follow existing payments page patterns for consistency.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-quick-record-workflow*
*Context gathered: 2026-03-23*
