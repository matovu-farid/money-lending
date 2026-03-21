# Phase 4: Financial Reporting - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Creditor management (registration, investments, interest accrual, repayments), expense and income tracking with configurable categories, a unified transaction log, auto-generated financial statements (Profit & Loss, Balance Sheet), a loan portfolio report, and export of all reports to PDF and Excel. Management can see where all capital is and produce financial statements for accountability.

Requirements: CRED-01, CRED-02, CRED-03, CRED-04, CRED-05, CRED-06, FINC-01, FINC-02, FINC-03, RPTS-02, RPTS-03, RPTS-04, RPTS-05

</domain>

<decisions>
## Implementation Decisions

### Creditor Registration (CRED-01, CRED-02)
- **Registration flow:** Mirror customer registration — same form pattern (Name, Address, Contact) plus investment fields (Amount invested, Interest rate, Date)
- **Multiple investments:** A creditor can make multiple investments over time. Each investment is a separate record with its own amount, date, and interest rate. Interest accrues per-investment on reducing balance.
- **Profile page:** Creditor profile with edit capability and full investment history

### Creditor Interest & Repayments (CRED-03, CRED-04, CRED-05)
- **Interest engine:** Reuse the same reducing-balance engine as borrower loans (`engine.ts`) but write to a separate creditor interest table. A change to borrower interest rates does not affect creditor accruals.
- **Dashboard layout:** KPI summary cards at top (Total Invested, Interest Accrued, Repayments Made, Outstanding Balance) + investment table below showing per-investment interest breakdown
- **Repayment allocation:** Interest-first, same as borrower loan payments — creditor repayments allocate to accrued interest first, remainder reduces principal invested. Consistent with the borrower model.

### System-Wide Capital View (CRED-06)
- **Aggregation:** Sum across all creditors: total invested, total interest accrued, total repayments made, total outstanding. Updates the existing dashboard `capitalInSystem` KPI (currently stubbed at "0.00").

### Expense & Income Tracking (FINC-01, FINC-02, FINC-03)
- **Separate pages:** Dedicated /expenses and /income pages with their own forms and lists — not a combined transaction form
- **Categories:** Pre-seeded with defaults, admin can add custom categories. Cannot delete categories that have transactions referencing them.
  - **Expense defaults:** Rent, Salaries, Office Expenses, Interest Payments, DStv
  - **Income defaults:** Share Capital, Bonuses, Interest Earned
- **Auto-posting from engine:** When a borrower payment is recorded, the interest portion auto-creates an "Interest Earned" income entry in the transaction log. When a creditor repayment is recorded, the interest portion auto-creates an "Interest Payments" expense entry. Ensures P&L accuracy without manual double-entry.
- **Transaction log:** Dedicated browsable, filterable page showing all debit/credit entries. This is the single source of truth for P&L calculation. Useful for auditing and reconciliation.

### Financial Statements (RPTS-03, RPTS-04)
- **Generation:** Monthly auto-snapshot at month-end (cron) + on-demand generation for any period. Stored snapshots serve as official records.
- **P&L structure:** Grouped by category — Income section with each income category as a line item, Expense section with each expense category as a line item. Net Profit at bottom. Matches how expense/income categories are configured.
- **Balance Sheet structure:** Three-section standard:
  - Assets: Total loans outstanding (principal)
  - Liabilities: Total creditor balances (invested + accrued interest - repayments)
  - Equity: Share capital + retained earnings (cumulative P&L)
  - Must balance: Assets = Liabilities + Equity

### Loan Portfolio Report (RPTS-02)
- **Content:** Active loans with days remaining, interest accrued, status, risk flags
- **Integrates with:** Existing watchlist data and interest engine calculations

### Report Export (RPTS-05)
- **PDF:** Server-side PDF generation (library TBD by researcher). User clicks "Export PDF", gets a downloadable file. Branded header on every PDF — business name, logo, and address.
- **Excel:** Styled workbook — headers with background color, bold text, column widths set, UGX number formatting with commas, borders on data cells. Ready to print from Excel/LibreOffice without additional configuration.
- **Exportable reports:** Loan Portfolio, Profit & Loss, Balance Sheet, AND Transaction Log (4 total). Transaction log export useful for auditors and accountants.

### Claude's Discretion
- Report navigation structure (hub page vs separate pages per report)
- Creditor registration form field ordering and validation UX
- Transaction log filter options (date range, category, type)
- P&L and Balance Sheet on-screen layout and period picker design
- PDF library choice (jsPDF, Puppeteer, or alternatives — researcher to investigate)
- Excel library choice (exceljs, xlsx, or alternatives — researcher to investigate)
- Monthly snapshot cron timing and storage format
- Expense/income form layout, date picker, note field behavior

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — Phase 4 covers: CRED-01–06, FINC-01–03, RPTS-02–05

### Interest engine (reuse for creditors)
- `.planning/phases/01-foundation/01-CONTEXT.md` — Loan Ledger Model: payment allocation logic (interest-first), daily rate formula, minimum interest rule, BigNumber usage
- `src/lib/interest/engine.ts` — `calculateDailyRate()`, `calculateInterest()`, `calculateDaysOverdue()`, `calculateLoanSummary()` — reuse for creditor interest accrual

### Prior phase patterns
- `.planning/phases/02-loan-operations/02-CONTEXT.md` — Receipt generation (browser print), payment recording UX, soft-delete pattern
- `.planning/phases/03-operational-management/03-CONTEXT.md` — Dashboard KPI cards layout, capitalInSystem stub, watchlist patterns

### Project constraints
- `.planning/PROJECT.md` — BigNumber arithmetic, Effect.js services, NUMERIC(15,2), Server Actions, no Zod

### Codebase patterns
- `.planning/codebase/CONVENTIONS.md` — Naming, imports, styling
- `.planning/codebase/STRUCTURE.md` — App Router layout, directory structure

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/interest/engine.ts` — Full interest calculation engine. Reuse for creditor interest accrual (CRED-03). Same functions, separate table.
- `src/lib/db/schema/payments.ts` — Payment schema pattern with interest/principal allocation. Model for creditor repayment schema.
- `src/services/dashboard.service.ts` — Dashboard KPIs with `capitalInSystem: "0.00"` stub. Wire to real creditor aggregation.
- `src/services/payment.service.ts` — Payment recording with audit log. Pattern for creditor repayment service.
- `src/components/layout/sidebar.tsx` — Disabled nav items ready: "Creditors" (Landmark icon), "Expenses & Income" (Receipt icon), "Reports" (BarChart3 icon).
- `src/types/index.ts` — `DashboardKPIs` type with `capitalInSystem` field.

### Established Patterns
- Effect.js services: `Effect<S, E, never>` with db closed over module scope
- Server Actions for all mutations (no Route Handlers)
- `writeAuditLog` is plain async inside Drizzle tx callbacks
- Server component + client island: page.tsx fetches via Effect.runPromise, passes props to client component
- KPI cards pattern from dashboard (Phase 3) — reuse for creditor dashboard

### Integration Points
- Creditor pages: new routes at `src/app/(app)/creditors/`
- Expenses page: new route at `src/app/(app)/expenses/`
- Income page: new route at `src/app/(app)/income/`
- Transaction log: new route at `src/app/(app)/transactions/`
- Reports: new routes at `src/app/(app)/reports/`
- Dashboard `capitalInSystem` KPI: wire to real creditor aggregation query
- Sidebar: enable disabled "Creditors", "Expenses & Income", "Reports" items
- Auto-posting: hook into existing `recordPayment` (borrower) and new `recordCreditorRepayment` to auto-create transaction log entries

</code_context>

<specifics>
## Specific Ideas

- Auto-posting interest from loan/creditor payments to the transaction log ensures P&L accuracy without manual double-entry — this is a key accounting integrity decision
- Monthly auto-snapshots serve as official financial records — on-demand reports supplement but don't replace the month-end close
- Styled Excel exports with proper UGX formatting, borders, and headers so the client can print directly without additional setup
- Branded PDF headers (business name, logo, address) for sharing with creditors and accountants

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-financial-reporting*
*Context gathered: 2026-03-21*
