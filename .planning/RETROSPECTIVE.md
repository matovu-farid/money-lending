# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-03-22
**Phases:** 5 | **Plans:** 27 | **Commits:** 175

### What Was Built
- Full loan lifecycle: customer onboarding → loan issuance → payment recording → receipt printing
- Reducing-balance Interest Engine with BigNumber precision and 30-day minimum period enforcement
- Better Auth RBAC with 3-tier role hierarchy (Super Admin → Admin → Loan Officer)
- Executive dashboard, borrower watchlist, repayment simulator, in-app notifications
- Creditor capital tracking with same engine as borrower loans
- Expense/income ledger, transaction log, P&L and Balance Sheet with PDF/Excel export
- Optimistic UI with TanStack Query and React 19 useTransition loading states

### What Worked
- Phased dependency graph: each phase built on proven infrastructure from the previous one
- Interest Engine TDD in Phase 1 paid off — zero calculation bugs through Phases 2-5
- Server Actions over Route Handlers eliminated fetch boilerplate and kept code simple
- BigNumber-only policy for monetary arithmetic prevented all float-precision issues
- writeAuditLog as plain async (not Effect) inside Drizzle transactions avoided runtime errors
- 4-day build timeline from zero to complete MVP

### What Was Inefficient
- INFR-01/05/06 requirements never formally checked off despite being functionally complete
- Phase 5 UX requirements plan checkboxes in ROADMAP left unchecked (cosmetic, not functional)
- base-ui API surprises (no asChild, render prop pattern) required multiple mid-phase discoveries
- Better Auth type complexity required several `as any` casts

### Patterns Established
- Server Actions return void / throw on error — no error-in-result pattern
- writeAuditLog as plain async inside db.transaction (not Effect.runPromise — Pitfall 7)
- Fire-and-forget email notifications (never await, never block)
- Server Component + client island pattern: page.tsx fetches via Effect.runPromise, passes props
- buttonVariants + Link for link-styled buttons (base-ui Button has no asChild)
- PopoverTrigger/TooltipTrigger render prop pattern (base-ui, not Radix)

### Key Lessons
1. Effect.runPromise inside Drizzle tx callbacks causes runtime errors — always use plain async for in-transaction side effects
2. Better Auth RBAC plugin API differs from docs — verify against installed package, not training data
3. base-ui primitives (shadcn@latest) have different APIs than Radix — no asChild, render prop required
4. Perpetual loans (no maturity) simplify the model significantly — payment table is the sole source of truth
5. TanStack Query is overkill for most forms — useTransition handles 90% of loading state needs

### Cost Observations
- Model mix: primarily opus for planning/execution
- Sessions: ~10 across 4 days
- Notable: parallel agent execution for plan steps significantly reduced wall-clock time

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Commits | Phases | Key Change |
|-----------|---------|--------|------------|
| v1.0 | 175 | 5 | Initial build — established all patterns |

### Top Lessons (Verified Across Milestones)

1. TDD for financial calculation engines prevents downstream bugs across all consuming phases
2. Plain async (not Effect) for side effects inside Drizzle transactions
3. Server Actions + useTransition is the right default; TanStack Query only for optimistic list mutations
