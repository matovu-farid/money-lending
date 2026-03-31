# Codebase Concerns

**Analysis Date:** 2026-03-31

## Tech Debt

**N+1 Query Pattern in Dashboard KPIs:**
- Issue: `getDashboardKPIs()` in `src/services/dashboard.service.ts` loops through all active loans (lines 29-61) and makes a separate database query for payments per loan. With 100+ loans, this creates 100+ queries.
- Files: `src/services/dashboard.service.ts` (lines 14-84)
- Impact: Dashboard load times degrade linearly with loan count. Performance becomes unacceptable at scale (100+ loans).
- Fix approach: Use SQL JOIN with window functions or a single aggregated query to fetch all payments grouped by loanId in one query. Alternatively, use Drizzle's `relational` queries for automatic batching.

**N+1 Query Pattern in Watchlist and Daily Collections:**
- Issue: `getWatchlistData()` in `src/services/watchlist.service.ts` (lines 23-80) and `getLoansDueToday()` in `src/services/daily-collections.service.ts` (lines 51-105) loop through active loans and fetch payments individually.
- Files: `src/services/watchlist.service.ts`, `src/services/daily-collections.service.ts`
- Impact: Watchlist and daily collections pages slow down with portfolio growth. Each page load with 50 loans triggers 50+ queries.
- Fix approach: Batch load all payments with single query, then map in-memory.

**Unsafe Type Assertion in PDF Export:**
- Issue: `src/services/export/pdf.service.ts` uses `(doc as any).lastAutoTable.finalY` (lines 165, 194, 226, 239, 264) without type safety.
- Files: `src/services/export/pdf.service.ts`
- Impact: If jsPDF/autoTable API changes, type checker won't catch it. Runtime errors in PDF generation.
- Fix approach: Create proper TypeScript types for jsPDF extended with autoTable, or use optional chaining with fallbacks.

**Fire-and-Forget Email Errors:**
- Issue: `src/lib/email.ts` catches all errors and swallows them silently (lines 63-64: "Fire-and-forget: log but never throw"). Email failures are not logged.
- Files: `src/lib/email.ts`
- Impact: Verification emails, password resets may silently fail. Users can't create accounts or reset passwords without knowing why.
- Fix approach: Log errors to stderr or monitoring system. Consider retry logic for transient failures.

## Known Bugs

**Potential Race Condition in Payment Recalculation:**
- Symptoms: If two payments are edited simultaneously on the same loan, the second edit's recalculation may use stale payment data.
- Files: `src/services/payment.service.ts` (lines 192-240, `editPayment` function)
- Trigger: Edit payment A, then quickly edit payment B on same loan before first edit completes
- Workaround: Implement pessimistic locking or version-based optimistic locking at database level

**Missing Null Check in Dashboard Activity Feed:**
- Symptoms: If audit log contains invalid entityId references, dashboard activity feed may render partial/broken entries.
- Files: `src/services/dashboard.service.ts` (lines 92-140, `getRecentActivity` function)
- Trigger: Delete a loan then view dashboard activity
- Workaround: Activity entries reference deleted entities; graceful fallback exists but could be clearer

## Security Considerations

**First User Superadmin Bootstrap in Auth Hook:**
- Risk: If database is reset/cleared mid-operation, the next user to register becomes superAdmin even if an admin already exists.
- Files: `src/lib/auth.ts` (lines 57-80)
- Current mitigation: Relies on database count at user creation time; no additional validation
- Recommendations: Add check to prevent this if any user with role "superAdmin" already exists. Log when promotion occurs. Consider making this a manual bootstrap step instead of automatic.

**In-Memory Email Verification Storage (Test-Only Concern):**
- Risk: `pendingVerifications` Map in `src/lib/auth.ts` (line 11) is never cleared. Could leak memory in test environments if many email verifications are created.
- Files: `src/lib/auth.ts`
- Current mitigation: Only active in test/Cypress mode, cleared on process restart
- Recommendations: Add TTL-based cleanup for verification URLs. Limit map size with LRU eviction.

**SQL Injection via Unescaped LIKE Pattern:**
- Risk: Very low - `escapeLikePattern()` in `src/services/payment.service.ts` (lines 24-26) properly escapes % and _, but used only in `searchActiveLoans()`. Other search endpoints may not escape.
- Files: `src/services/payment.service.ts` (line 471: `searchActiveLoans`), `src/app/(app)/payments/LoanSearchCombobox.tsx`
- Current mitigation: Uses parameterized queries via Drizzle; manual escaping is defense-in-depth
- Recommendations: Verify all LIKE searches use `escapeLikePattern()`. Consider adding a linting rule to enforce this.

## Performance Bottlenecks

**Dashboard KPI Calculation Loop Over All Loans:**
- Problem: `getDashboardKPIs()` calculates interest accrual, days overdue for every active loan every call. With 500+ loans, this is expensive (interest calculation is not trivial).
- Files: `src/services/dashboard.service.ts` (lines 29-61)
- Cause: No caching, no incremental computation. Called every time dashboard page loads.
- Improvement path: Cache KPIs for 5-15 minutes. Recalculate only when payments/loans change (via background cron job). Use materialized views in database for pre-aggregated stats.

**Watchlist Calculation Loops Through 100% of Active Loans:**
- Problem: `getWatchlistData()` fetches and calculates interest for every active loan to find ~10-20 overdue ones.
- Files: `src/services/watchlist.service.ts` (lines 15-87)
- Cause: No filtering at SQL layer. Loads all loans into memory, then filters.
- Improvement path: Add SQL query to filter loans where interest accrued > paid (overdue condition) before loading. Calculate only overdue loans' details in JavaScript.

**PDF Export Loops Over All Rows:**
- Problem: `src/services/export/pdf.service.ts` loads entire dataset into memory before writing PDF. Portfolio with 5000+ transactions may OOM.
- Files: `src/services/export/pdf.service.ts`
- Cause: ExcelJS/jsPDF require full dataset in memory
- Improvement path: Stream/paginate PDF generation for large datasets. Generate in chunks, append pages. Consider server-side async PDF generation for large exports.

## Fragile Areas

**Payment Recalculation Logic:**
- Files: `src/services/payment.service.ts` (lines 32-85, `recalculateFromPayment` function)
- Why fragile: Complex date/interest calculations depend on correct ordering and state. Missing edge case handling for:
  - Payments with same date (relies on `createdAt` tiebreaker)
  - Timezone issues (stores dates as UTC, compares with local time in some places)
  - BigNumber precision edge cases (rounding at boundaries)
- Safe modification: Add comprehensive test coverage for edge cases (same-day payments, leap years, interest boundary conditions). Use database ordering guarantees instead of relying on `createdAt`.
- Test coverage: `src/services/__integration__/payment.service.test.ts` covers main flow but limited edge case coverage

**Loan Status State Machine:**
- Files: `src/services/loan.service.ts`, `src/services/payment.service.ts`
- Why fragile: Status transitions (pending→active→fully_paid) are implicit across multiple services. No central state machine.
- Safe modification: Define explicit state transition rules. Add validation to prevent invalid transitions (e.g., fully_paid→active should clear all payments first).
- Test coverage: Integration tests exist but state transition edge cases not explicitly tested

**Interest Calculation Consistency:**
- Files: `src/lib/interest/engine.ts`, `src/services/watchlist.service.ts`, `src/services/dashboard.service.ts`, `src/services/creditor.service.ts`
- Why fragile: Interest calculation logic duplicated across multiple files. Changes in one place don't automatically propagate.
- Safe modification: All calculations must call same function from `src/lib/interest/engine.ts`. Add a validation service that checks watchlist interest = dashboard interest.
- Test coverage: Unit tests exist but cross-service consistency not tested

## Scaling Limits

**Active Loans Fetch in Memory:**
- Current capacity: ~500 loans can be fetched and processed in memory without issues (typical server: 512MB Node heap)
- Limit: 5000+ loans → memory pressure, slow JavaScript processing, long response times (>10s)
- Scaling path: Implement pagination for loan lists. Add materialized views in database. Cache KPIs/watchlist. Use cron jobs for batch calculations.

**Payment Query Growth:**
- Current capacity: Individual loans can have 100+ payments before query response time becomes noticeable
- Limit: Loan with 1000+ payments → payment recalculation O(n) becomes slow
- Scaling path: Archive old payments. Implement payment aggregation/snapshots. Use database indexes on (loanId, paymentDate).

**Audit Log Size:**
- Current capacity: Audit log grows unbounded. With 1000 transactions/day, reaches 30MB/month (uncompressed).
- Limit: 2+ years of data → audit queries slow down, storage grows
- Scaling path: Implement audit log retention policy (keep 1 year, archive 2+ years). Add database partitioning by date.

## Dependencies at Risk

**BigNumber.js for All Monetary Values:**
- Risk: External decimal math library. Adds 15KB to bundle. If maintainance ceases or security issue found, switching is difficult (used everywhere).
- Impact: All payment/interest calculations would need refactoring. No built-in way to use native Number or alternative.
- Migration plan: Consider PostgreSQL's NUMERIC type for calculations server-side instead of JavaScript. Keep BigNumber for display only.

**Drizzle ORM Relational Queries Not Fully Utilized:**
- Risk: Current codebase uses raw `.select().from().where()` patterns. Drizzle's `query` mode with relations could eliminate N+1 queries but requires refactor.
- Impact: N+1 queries remain unfixed. Switching to Drizzle's relational mode later will be harder.
- Migration plan: Gradually migrate service layer to use Drizzle relational queries. Start with dashboard and watchlist services.

**Better-Auth First-User Bootstrap Logic:**
- Risk: Custom database hook in `src/lib/auth.ts` depends on undocumented Better-Auth internals (databaseHooks, db.execute).
- Impact: Better-Auth version bump may break custom hook. Migration path to Better-Auth's built-in role plugin unclear.
- Migration plan: Test Better-Auth upgrades in dev environment before deploying. Consider implementing bootstrap via manual migration instead of hook.

## Missing Critical Features

**No Offline Mode:**
- Problem: All operations require database connectivity. No local caching strategy for read-heavy operations (dashboard, watchlist).
- Blocks: Mobile use cases, offline data entry
- Workaround: Manual offline record-keeping + manual sync later

**No Partial/Offline-First Sync:**
- Problem: Payment edits trigger recalculation of all subsequent payments (expensive). No way to stage changes before committing.
- Blocks: Bulk payment uploads, data import workflows
- Workaround: Manual one-at-a-time entry

**No Search Index:**
- Problem: Customer/loan search is full table scan with LIKE. No full-text search.
- Blocks: Finding customers by phone, address, etc. Slow with 10000+ customers.
- Workaround: Pagination only, exact name matching

## Test Coverage Gaps

**Watchlist Calculation Edge Cases:**
- What's not tested: Timezone handling, leap year interest, simultaneous payment edits affecting daysOverdue calculation
- Files: `src/services/__integration__/watchlist.service.test.ts`
- Risk: Timezone bugs go undetected (e.g., payment recorded in one timezone, overdue calculation in another)
- Priority: High

**Dashboard Activity Feed Nullability:**
- What's not tested: Activity feed with deleted loans/customers, broken references
- Files: `src/services/dashboard.service.ts` (lines 92-140), missing test in `src/services/__integration__/dashboard.service.test.ts`
- Risk: Activity entries render partially if related entity deleted, user confusion
- Priority: Medium

**Payment Recalculation Concurrent Edits:**
- What's not tested: Two rapid edits on same loan, concurrent edit while recalculation in progress
- Files: `src/services/__integration__/payment.service.test.ts`
- Risk: Race condition causes incorrect interest allocation, undetected until audited
- Priority: High

**Interest Calculation Consistency Across Services:**
- What's not tested: Watchlist interest = Dashboard interest = Creditor interest (no cross-service test)
- Files: No integration test comparing all three services' interest calculations
- Risk: Silent divergence where different pages show different numbers
- Priority: Critical

**Export Service Handling of Large Datasets:**
- What's not tested: PDF/Excel export with 5000+ rows, memory usage, generation time
- Files: `src/services/__tests__/pdf.service.test.ts`, `src/services/__tests__/excel.service.test.ts`
- Risk: Memory exhaustion, timeout, partial/corrupted exports
- Priority: Medium

**CSV Export Data Integrity:**
- What's not tested: CSV escaping for special characters, quotes, commas in customer names
- Files: `src/app/(app)/payments/PaymentsClient.tsx` (lines 44-65)
- Risk: CSV malformed if customer name contains comma or quote (e.g., "Smith, John")
- Priority: Low

---

*Concerns audit: 2026-03-31*
