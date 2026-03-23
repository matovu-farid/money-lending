# Phase 4: Financial Reporting - Research

**Researched:** 2026-03-21
**Domain:** Financial data modeling, creditor interest accrual, transaction ledger, PDF/Excel export, financial statement generation
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Creditor Registration (CRED-01, CRED-02)
- Registration flow: Mirror customer registration — same form pattern (Name, Address, Contact) plus investment fields (Amount invested, Interest rate, Date)
- Multiple investments: A creditor can make multiple investments over time. Each investment is a separate record with its own amount, date, and interest rate. Interest accrues per-investment on reducing balance.
- Profile page: Creditor profile with edit capability and full investment history

#### Creditor Interest & Repayments (CRED-03, CRED-04, CRED-05)
- Interest engine: Reuse the same reducing-balance engine as borrower loans (`engine.ts`) but write to a separate creditor interest table. A change to borrower interest rates does not affect creditor accruals.
- Dashboard layout: KPI summary cards at top (Total Invested, Interest Accrued, Repayments Made, Outstanding Balance) + investment table below showing per-investment interest breakdown
- Repayment allocation: Interest-first, same as borrower loan payments — creditor repayments allocate to accrued interest first, remainder reduces principal invested. Consistent with the borrower model.

#### System-Wide Capital View (CRED-06)
- Aggregation: Sum across all creditors: total invested, total interest accrued, total repayments made, total outstanding. Updates the existing dashboard `capitalInSystem` KPI (currently stubbed at "0.00").

#### Expense & Income Tracking (FINC-01, FINC-02, FINC-03)
- Separate pages: Dedicated /expenses and /income pages with their own forms and lists — not a combined transaction form
- Categories: Pre-seeded with defaults, admin can add custom categories. Cannot delete categories that have transactions referencing them.
  - Expense defaults: Rent, Salaries, Office Expenses, Interest Payments, DStv
  - Income defaults: Share Capital, Bonuses, Interest Earned
- Auto-posting from engine: When a borrower payment is recorded, the interest portion auto-creates an "Interest Earned" income entry in the transaction log. When a creditor repayment is recorded, the interest portion auto-creates an "Interest Payments" expense entry. Ensures P&L accuracy without manual double-entry.
- Transaction log: Dedicated browsable, filterable page showing all debit/credit entries. This is the single source of truth for P&L calculation.

#### Financial Statements (RPTS-03, RPTS-04)
- Generation: Monthly auto-snapshot at month-end (cron) + on-demand generation for any period. Stored snapshots serve as official records.
- P&L structure: Grouped by category — Income section with each income category as a line item, Expense section with each expense category as a line item. Net Profit at bottom.
- Balance Sheet structure: Three-section standard:
  - Assets: Total loans outstanding (principal)
  - Liabilities: Total creditor balances (invested + accrued interest - repayments)
  - Equity: Share capital + retained earnings (cumulative P&L)
  - Must balance: Assets = Liabilities + Equity

#### Loan Portfolio Report (RPTS-02)
- Content: Active loans with days remaining, interest accrued, status, risk flags
- Integrates with: Existing watchlist data and interest engine calculations

#### Report Export (RPTS-05)
- PDF: Server-side PDF generation. User clicks "Export PDF", gets a downloadable file. Branded header on every PDF — business name, logo, and address.
- Excel: Styled workbook — headers with background color, bold text, column widths set, UGX number formatting with commas, borders on data cells. Ready to print from Excel/LibreOffice without additional configuration.
- Exportable reports: Loan Portfolio, Profit & Loss, Balance Sheet, AND Transaction Log (4 total).

### Claude's Discretion
- Report navigation structure (hub page vs separate pages per report)
- Creditor registration form field ordering and validation UX
- Transaction log filter options (date range, category, type)
- P&L and Balance Sheet on-screen layout and period picker design
- PDF library choice (jsPDF, Puppeteer, or alternatives)
- Excel library choice (exceljs, xlsx, or alternatives)
- Monthly snapshot cron timing and storage format
- Expense/income form layout, date picker, note field behavior

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CRED-01 | Register creditor with Name, Address, Contact, Amount invested, Interest rate | Creditor schema pattern mirrors customers.ts + loans.ts pattern; separate creditors + creditor_investments tables |
| CRED-02 | View and edit creditor profile and full investment history | Same Server Component + client island pattern as customer profile |
| CRED-03 | Daily interest on creditor funds via same reducing-balance engine | `engine.ts` reuse confirmed; separate `creditor_interest_accruals` table avoids coupling with borrower rates |
| CRED-04 | Record repayments made back to creditors | Same `recordPayment` pattern from `payment.service.ts`; separate `creditor_repayments` table |
| CRED-05 | Creditor dashboard: capital invested, interest accrued, repayments, outstanding balance | KPI card pattern from `dashboard.service.ts` + Phase 3 dashboard |
| CRED-06 | System-wide capital view: total funds from all creditors combined | Aggregate query wires to dashboard `capitalInSystem` KPI stub |
| FINC-01 | Transaction log of all debit/credit entries | New `transactions` table with type, amount, category_id, reference; auto-populated via auto-posting hooks |
| FINC-02 | Expense recording with configurable categories | `expense_categories` table + `expenses` table; pre-seeded; categories cannot be deleted if referenced |
| FINC-03 | Income recording with configurable categories | `income_categories` table + `income` table (or unified categories with type discriminator); pre-seeded |
| RPTS-02 | Loan portfolio report: active loans with days remaining, interest accrued, status, risk flags | Reuse `calculateDaysOverdue` + `calculateInterest` from engine.ts; serve as derived query, no snapshot needed |
| RPTS-03 | Monthly P&L statement (Interest Income + Other Income minus Expenses) | Stored snapshot table + on-demand query from `transactions` table; node-cron month-end trigger |
| RPTS-04 | Balance Sheet: Assets (loans outstanding), Liabilities (creditor balances), Equity | Derived query across loans, creditor_investments, creditor_repayments, transactions; snapshot stored |
| RPTS-05 | Export all reports to PDF and Excel | jsPDF 4.2.1 for server-side PDF; ExcelJS 4.4.0 for styled Excel; Route Handler streams binary response |
</phase_requirements>

---

## Summary

Phase 4 is the largest phase in the project — 13 requirements spanning a new entity type (creditors), a double-entry-adjacent transaction ledger, two financial statements, and binary file export. The good news is that the existing codebase provides almost everything needed as a template: the interest engine is reusable verbatim for creditor accrual, the payment service pattern maps directly to creditor repayments, the KPI card pattern covers the creditor dashboard, and Effect.js service conventions are established.

The two genuinely new technical problems are (1) PDF generation and (2) Excel generation. Both require new npm packages. Research confirms **jsPDF 4.2.1** (published 2026-03-17) is the right PDF library — it has dedicated Node.js build files, no browser dependency, and runs safely in a Next.js Route Handler. **ExcelJS 4.4.0** is the right Excel library — it has rich styling APIs (fonts, borders, fills, column widths, number formats) that are required by the Excel spec. Neither `@react-pdf/renderer` nor SheetJS/xlsx is recommended: react-pdf has had React 19 breaking issues, and SheetJS has security vulnerabilities plus inferior styling support.

The transaction log is the accounting source of truth. Auto-posting — inserting into the `transactions` table when a borrower payment is recorded (interest portion → "Interest Earned") or a creditor repayment is recorded (interest portion → "Interest Payments") — must happen inside the same database transaction as the parent operation. This is the only way to guarantee P&L accuracy without manual double-entry.

**Primary recommendation:** Use jsPDF 4.2.1 in a Next.js Route Handler for PDF export, ExcelJS 4.4.0 in a Route Handler for Excel export, and node-cron 4.2.1 for month-end snapshots. Mirror all existing service and schema patterns exactly.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| jsPDF | 4.2.1 | Server-side PDF generation | Has dedicated Node.js build (`jspdf.node.js`); no browser DOM dependency; table layout via jspdf-autotable; latest release 2026-03-17 |
| ExcelJS | 4.4.0 | Styled Excel workbook generation | Full styling API: fills, fonts, borders, number formats, column widths; runs in Node.js; better than SheetJS for styled reports |
| node-cron | 4.2.1 | Month-end snapshot scheduling | Already used in project conceptually (Phase 2 cron endpoint pattern); lightweight; cron expression syntax |
| bignumber.js | 10.0.2 (installed) | Creditor interest arithmetic | Project mandate; all monetary math; already in engine.ts |
| Effect | 3.21.0 (installed) | Service layer error handling | Project convention; all service functions return `Effect<S, E, never>` |
| drizzle-orm | 0.45.1 (installed) | Database queries and transactions | Project convention; NUMERIC(15,2) for all monetary columns |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| jspdf-autotable | ~3.x | Table rendering in PDF | Required for all report PDFs — loan portfolio, P&L, balance sheet, transaction log |
| lucide-react | 0.577.0 (installed) | Report page icons | Already in project |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| jsPDF | Puppeteer | Puppeteer requires headless Chromium (~300MB), heavy for a small project; jsPDF is pure Node.js |
| jsPDF | PDFKit | PDFKit is also viable but requires more manual layout code; jsPDF + autotable is more concise for tabular financial data |
| jsPDF | @react-pdf/renderer | react-pdf has had React 19 breaking issues (issues #2756, #2912, #2935) and is NOT recommended for this React 19 project |
| ExcelJS | xlsx (SheetJS) | SheetJS has security vulnerabilities and inferior styling support; ExcelJS is the correct choice for styled exports |

**Installation:**
```bash
pnpm add jspdf jspdf-autotable exceljs node-cron
pnpm add -D @types/node-cron
```

**Version verification (confirmed against npm registry 2026-03-21):**
- jspdf: 4.2.1 (published 2026-03-17)
- exceljs: 4.4.0 (published 2023-10-19)
- node-cron: 4.2.1 (published 2025-07-10)

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/(app)/
│   ├── creditors/
│   │   ├── page.tsx                    # Creditor list
│   │   ├── new/page.tsx                # Register creditor
│   │   └── [id]/
│   │       ├── page.tsx                # Creditor profile + dashboard
│   │       └── investments/new/page.tsx # Add investment
│   ├── expenses/
│   │   └── page.tsx                    # Expense list + form
│   ├── income/
│   │   └── page.tsx                    # Income list + form
│   ├── transactions/
│   │   └── page.tsx                    # Transaction log (filterable)
│   └── reports/
│       ├── page.tsx                    # Reports hub
│       ├── portfolio/page.tsx          # Loan portfolio report
│       ├── pnl/page.tsx                # P&L statement
│       └── balance-sheet/page.tsx      # Balance sheet
├── app/api/
│   ├── reports/
│   │   ├── portfolio/route.ts          # GET → PDF or Excel stream
│   │   ├── pnl/route.ts                # GET → PDF or Excel stream
│   │   ├── balance-sheet/route.ts      # GET → PDF or Excel stream
│   │   └── transactions/route.ts       # GET → PDF or Excel stream
│   └── cron/
│       └── month-end/route.ts          # POST → snapshot P&L + BS
├── lib/db/schema/
│   ├── creditors.ts                    # creditors table
│   ├── creditor-investments.ts         # creditor_investments table
│   ├── creditor-repayments.ts          # creditor_repayments table
│   ├── expense-categories.ts           # expense_categories table
│   ├── income-categories.ts            # income_categories table
│   ├── transactions.ts                 # transactions (ledger) table
│   └── financial-snapshots.ts          # financial_snapshots table
└── services/
    ├── creditor.service.ts
    ├── transaction.service.ts
    ├── report.service.ts
    └── export/
        ├── pdf.service.ts              # jsPDF generation
        └── excel.service.ts            # ExcelJS generation
```

### Pattern 1: Creditor Interest Accrual (Mirrors Borrower Pattern)
**What:** Reuse `calculateInterest()` from engine.ts with creditor-specific parameters. Compute on-demand from creditor repayment history.
**When to use:** Creditor dashboard KPI calculation, creditor detail page, capitalInSystem aggregation.
**Example:**
```typescript
// Source: src/lib/interest/engine.ts (existing — reuse verbatim)
import { calculateInterest, calculateDailyRate, formatAmount } from "@/lib/interest/engine"
import BigNumber from "bignumber.js"

// Creditor interest accrual — same formula, separate data source
function getCreditorInterestAccrued(
  investmentAmount: string,
  monthlyRateDecimal: string,
  investmentDate: Date,
  repayments: CreditorRepayment[]
): string {
  // Same reducing-balance logic as allocatePayment in engine.ts
  // principalBalance reduces as repayments allocate to principal
  // daysElapsed computed between repayments
  // NO minInterestDays for creditors (business rule: creditors are not borrowers)
  const now = new Date()
  // ... replay repayments like recalculateFromPayment pattern
  return formatAmount(accruedInterest)
}
```

### Pattern 2: Auto-Posting to Transaction Log (Inside Existing DB Transactions)
**What:** When `recordPayment` is called, automatically insert a `transactions` row for the interest portion. When `recordCreditorRepayment` is called, insert a `transactions` row for the interest portion (as expense).
**When to use:** Every payment and creditor repayment operation. Must be inside the same `db.transaction()` call.
**Example:**
```typescript
// Inside recordPayment's db.transaction() callback — after payment insert
// Source: mirrors writeAuditLog pattern from src/services/audit.service.ts
await tx.insert(transactions).values({
  type: "credit",
  amount: allocation.interestPortion,
  categoryId: interestEarnedCategoryId,
  referenceType: "payment",
  referenceId: newPayment.id,
  description: `Interest earned — loan ${loanId}`,
  transactionDate: new Date(input.paymentDate),
  recordedBy: actorId,
})
```

### Pattern 3: Report Export via Route Handler
**What:** Route Handler reads query params (format=pdf|excel, period), queries data, generates binary, streams response.
**When to use:** All 4 report exports (portfolio, P&L, balance sheet, transactions).
**Example:**
```typescript
// Source: Route Handler pattern — src/app/api/reports/pnl/route.ts
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const format = searchParams.get("format") ?? "pdf"
  const period = searchParams.get("period") // e.g., "2026-02"

  // Fetch P&L data via service
  const data = await Effect.runPromise(getPnlData(period))

  if (format === "excel") {
    const buffer = await generatePnlExcel(data)
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="pnl-${period}.xlsx"`,
      },
    })
  }

  const pdfBuffer = generatePnlPdf(data)
  return new Response(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="pnl-${period}.pdf"`,
    },
  })
}
```

### Pattern 4: jsPDF Server-Side with autotable
**What:** Import jsPDF Node.js build, construct document, add branded header, render tables with autotable.
**When to use:** All PDF report generation.
**Example:**
```typescript
// jsPDF 4.x Node.js usage — no browser globals needed
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

function generatePnlPdf(data: PnlData, businessInfo: BusinessInfo): Buffer {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })

  // Branded header
  doc.setFontSize(16)
  doc.text(businessInfo.name, 14, 20)
  doc.setFontSize(10)
  doc.text(businessInfo.address, 14, 27)
  doc.text(`Profit & Loss — ${data.period}`, 14, 34)

  // Income table
  autoTable(doc, {
    startY: 45,
    head: [["Income Category", "Amount (UGX)"]],
    body: data.income.map(row => [row.category, formatUGX(row.amount)]),
    styles: { fontSize: 9 },
  })

  // Expenses table follows...
  const finalY = (doc as any).lastAutoTable.finalY + 10
  autoTable(doc, {
    startY: finalY,
    head: [["Expense Category", "Amount (UGX)"]],
    body: data.expenses.map(row => [row.category, formatUGX(row.amount)]),
  })

  return Buffer.from(doc.output("arraybuffer"))
}
```

### Pattern 5: ExcelJS Styled Workbook
**What:** Create workbook, add styled header rows, set column widths, apply UGX number format, add borders.
**When to use:** All Excel report generation.
**Example:**
```typescript
// Source: ExcelJS 4.4.0 API
import ExcelJS from "exceljs"

async function generatePnlExcel(data: PnlData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Profit & Loss")

  // Header row styling
  sheet.addRow(["Profit & Loss Statement", data.period])
  sheet.getRow(1).font = { bold: true, size: 14 }

  sheet.addRow([]) // spacer

  // Column headers
  const headerRow = sheet.addRow(["Category", "Amount (UGX)"])
  headerRow.eachCell(cell => {
    cell.font = { bold: true }
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A56DB" } }
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } }
    cell.border = {
      bottom: { style: "thin" },
      top: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    }
  })

  // Set column widths
  sheet.getColumn(1).width = 30
  sheet.getColumn(2).width = 20

  // UGX number format with commas
  const ugxFormat = '#,##0.00'

  // Data rows
  for (const row of data.income) {
    const dataRow = sheet.addRow([row.category, parseFloat(row.amount)])
    dataRow.getCell(2).numFmt = ugxFormat
    dataRow.getCell(2).border = { bottom: { style: "thin" } }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
```

### Pattern 6: Financial Snapshot Storage
**What:** Store P&L and Balance Sheet snapshots as JSON in a `financial_snapshots` table. On-demand generation reads live data; snapshots serve as official month-end records.
**When to use:** Month-end cron trigger and manual "close month" action.
**Example schema:**
```typescript
// src/lib/db/schema/financial-snapshots.ts
export const financialSnapshots = pgTable("financial_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),         // "pnl" | "balance_sheet"
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  data: text("data").notNull(),          // JSON stringified
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  generatedBy: text("generated_by").notNull(), // "cron" | userId
})
```

### Anti-Patterns to Avoid
- **Separate transaction log population outside the DB transaction:** Auto-posting to `transactions` must occur inside the same `db.transaction()` call as the parent operation (payment or creditor repayment). Doing it in a follow-up call risks P&L inconsistency if the parent succeeds but the auto-post fails.
- **Computing financials in the cron:** Cron only triggers snapshots — all math is done by service functions on demand. This is a project constraint (PROJECT.md).
- **Effect.runPromise inside Drizzle tx callbacks:** Established pitfall from Phase 1 [01-04]. Use plain `await` for all operations inside `db.transaction()` callbacks, including `writeAuditLog`.
- **Using @react-pdf/renderer:** React 19 compatibility issues exist (GitHub issues #2756, #2912, #2935). Do not use.
- **Using SheetJS (xlsx):** Security vulnerabilities (DoS, prototype pollution) and weak styling API. Do not use.
- **Using native floats for monetary arithmetic:** All monetary values must use BigNumber. This includes creditor interest calculations.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDF table rendering | Custom PDF table layout code | jspdf-autotable | Multi-page tables, column widths, row striping, header repeat — all handled |
| Excel number formatting | String interpolation for UGX | ExcelJS `numFmt` property | Native Excel format renders correctly in LibreOffice and Excel without extra config |
| Excel cell borders | CSS-like border approximation | ExcelJS `cell.border` API | Proper OOXML border encoding; prints correctly |
| Cron scheduling | `setInterval` or manual timer | node-cron | Proper cron expressions, timezone support, avoids drift |
| Creditor interest engine | New interest calculation logic | `engine.ts` `calculateInterest()` | Same math, tested, BigNumber-safe; project requirement that one engine handles both |

**Key insight:** The financial math is already correct and tested. The new work is schema design, service wiring, and binary export — not new algorithms.

---

## Common Pitfalls

### Pitfall 1: Auto-Post Outside Transaction
**What goes wrong:** Insert to `transactions` after the `db.transaction()` completes. If the auto-post fails (network issue, category not found), the P&L is wrong while the payment record is correct.
**Why it happens:** Developer treats auto-posting as a side effect rather than part of the atomic operation.
**How to avoid:** Always call `tx.insert(transactions).values(...)` inside the `db.transaction()` callback, same as `writeAuditLog`.
**Warning signs:** Auto-post function is async and called with `await` after `db.transaction()` returns.

### Pitfall 2: Deleting Categories with Referenced Transactions
**What goes wrong:** Admin deletes a category that has existing transactions; foreign key violation or silent orphan records.
**Why it happens:** Soft delete or no constraint.
**How to avoid:** Add a DB-level `RESTRICT` on the FK from `transactions.category_id` to `categories.id`. Validate in the service before delete: `SELECT count(*) WHERE category_id = ?` and surface a friendly error if > 0.
**Warning signs:** Category delete succeeds but transaction log shows NULL category.

### Pitfall 3: Balance Sheet Not Balancing
**What goes wrong:** Assets ≠ Liabilities + Equity in generated balance sheet.
**Why it happens:** Equity calculation doesn't account for all cumulative P&L periods, or creditor liability formula omits accrued interest not yet repaid.
**How to avoid:** Liabilities = `SUM(creditor_investments.amount) + SUM(creditor_interest_accrued) - SUM(creditor_repayments.amount)`. Equity = Share Capital (sum of "Share Capital" income entries) + Retained Earnings (sum of all P&L net profits from all periods). Test the identity at generation time and log a warning if it doesn't balance.
**Warning signs:** Small rounding differences in UGX values (use BigNumber throughout, only round at display time).

### Pitfall 4: jsPDF 4.x Node.js File System Restrictions
**What goes wrong:** `addImage()` or `addFont()` with file path fails silently or throws with "file system access disabled" error.
**Why it happens:** jsPDF 4.0.0 addressed CVE-2025-68428 by disabling file system access by default in Node.js.
**How to avoid:** Load images/fonts as base64 strings or Buffer, not file paths. Use `fs.readFileSync` first, convert to base64, then pass to jsPDF. Or use the Node.js permission flag if file access is explicitly needed.
**Warning signs:** PDF exports work in browser prototype but fail in Route Handler.

### Pitfall 5: ExcelJS `writeBuffer` is Async
**What goes wrong:** `workbook.xlsx.writeBuffer()` returns a Promise; forgetting `await` produces undefined buffer.
**Why it happens:** Easy to miss since other ExcelJS methods are synchronous.
**How to avoid:** Always `const buffer = await workbook.xlsx.writeBuffer()`.
**Warning signs:** Route Handler returns empty response or 500 with "Response body is not a string or Buffer".

### Pitfall 6: Creditor Interest Has No Minimum Period
**What goes wrong:** Applying `minInterestDays = 30` to creditor accrual, charging minimum 30 days even for short investments.
**Why it happens:** Copying borrower logic verbatim including the `minInterestDays` parameter.
**How to avoid:** Call `calculateInterest(balance, rate, daysElapsed, 0)` for creditors — pass `minInterestDays = 0` so there's no minimum period enforcement. Creditors are investors, not borrowers.
**Warning signs:** Creditor balance shows interest charges for zero-day periods.

### Pitfall 7: Snapshot Data Stale After Category Rename
**What goes wrong:** Stored JSON snapshot references category names; if a category is renamed, historical snapshots show the new name.
**Why it happens:** Snapshot stores category name as string rather than ID.
**How to avoid:** Snapshots store the full computed data as-at generation time (category names included at snapshot time). Category renames are acceptable because snapshots are point-in-time records. Document this as expected behavior.

### Pitfall 8: node-cron Month-End Cron Expression
**What goes wrong:** Cron fires at wrong time, or fires multiple times due to server restarts.
**Why it happens:** Month-end cron with `0 0 28-31 * *` fires on days 28-31 every day, not just the last day. Or multi-instance deployment runs it N times.
**How to avoid:** Use `0 0 L * *` if node-cron v4 supports last-day expression (verify), or implement a DB-level lock: check if a snapshot for the current month already exists before generating. The idempotency guard is more reliable than complex cron expressions.
**Warning signs:** Duplicate snapshot rows for the same period in `financial_snapshots`.

---

## Code Examples

Verified patterns from existing codebase:

### Effect.js Service Pattern (from existing services)
```typescript
// Source: src/services/dashboard.service.ts
export const getCreditorDashboard = (
  creditorId: string
): Effect.Effect<CreditorDashboard, DatabaseError | CreditorNotFound> =>
  Effect.tryPromise({
    try: async () => {
      // ... fetch and compute
    },
    catch: (e: any) => {
      if (e?._tag === "CreditorNotFound") return new CreditorNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })
```

### writeAuditLog Pattern (plain async inside tx)
```typescript
// Source: src/services/payment.service.ts — REQUIRED pattern
// NOT Effect.runPromise() inside tx callback (Pitfall 7 from Phase 1)
await writeAuditLog(tx, {
  actorId,
  action: "creditor_repayment.create",
  entityType: "creditor_repayment",
  entityId: newRepayment.id,
  beforeValue: null,
  afterValue: newRepayment,
})
```

### New Error Types Needed
```typescript
// Add to src/lib/errors.ts
export class CreditorNotFound extends Data.TaggedError("CreditorNotFound")<{ id: string }> {}
export class InvestmentNotFound extends Data.TaggedError("InvestmentNotFound")<{ id: string }> {}
export class CategoryInUseError extends Data.TaggedError("CategoryInUseError")<{ categoryId: string }> {}
export class SnapshotNotFound extends Data.TaggedError("SnapshotNotFound")<{ period: string }> {}
```

### Schema Pattern (mirrors payments.ts)
```typescript
// src/lib/db/schema/creditor-repayments.ts
export const creditorRepayments = pgTable("creditor_repayments", {
  id: uuid("id").primaryKey().defaultRandom(),
  investmentId: uuid("investment_id").notNull().references(() => creditorInvestments.id),
  repaymentDate: timestamp("repayment_date", { withTimezone: true }).notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  interestPortion: numeric("interest_portion", { precision: 15, scale: 2 }).notNull(),
  principalPortion: numeric("principal_portion", { precision: 15, scale: 2 }).notNull(),
  principalBalanceBefore: numeric("principal_balance_before", { precision: 15, scale: 2 }).notNull(),
  principalBalanceAfter: numeric("principal_balance_after", { precision: 15, scale: 2 }).notNull(),
  recordedBy: text("recorded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})
```

### Transaction Log Schema
```typescript
// src/lib/db/schema/transactions.ts
export const transactionTypeEnum = pgEnum("transaction_type", ["credit", "debit"])

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: transactionTypeEnum("type").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  categoryId: uuid("category_id").notNull(), // FK to unified categories or type-specific
  referenceType: text("reference_type"),     // "payment" | "creditor_repayment" | "manual"
  referenceId: text("reference_id"),
  description: text("description"),
  transactionDate: timestamp("transaction_date", { withTimezone: true }).notNull(),
  recordedBy: text("recorded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| @react-pdf/renderer for React PDFs | jsPDF with autotable for server-side PDF | react-pdf broke with React 19 (issues #2756, #2912) | Must use jsPDF Node build in Route Handlers |
| SheetJS (xlsx) for Excel | ExcelJS for styled Excel | SheetJS security CVEs + weak styling | ExcelJS is the correct choice for styled financial reports |
| jsPDF unrestricted file access | jsPDF 4.0+ disables Node.js filesystem by default | CVE-2025-68428 patched in Jan 2026 | Load images/fonts from Buffer, not file paths |

**Deprecated/outdated:**
- `@react-pdf/renderer` below v4.1.0: React 19 incompatible — do not use
- `xlsx` (SheetJS): Security vulnerabilities — do not use
- jsPDF < 4.0: CVE-2025-68428 path traversal vulnerability — use 4.2.1

---

## Open Questions

1. **Business settings source for branded PDF header**
   - What we know: PDF requires business name, logo, and address in header
   - What's unclear: Where are business name/address stored? Likely `settings` table exists; logo is a file upload or static asset
   - Recommendation: Check `src/lib/db/schema/settings.ts` for existing settings table; if logo is needed as base64 for jsPDF, plan a Wave 0 task to read it from `public/` as a static asset

2. **Unified vs. separate categories table for expenses/income**
   - What we know: Context specifies separate expense_categories and income_categories
   - What's unclear: Whether a single `categories` table with a `type` discriminator simplifies the transactions FK
   - Recommendation: Use a single `transaction_categories` table with `type: "expense" | "income"` discriminator. Simplifies the `transactions.category_id` FK and avoids two identical tables. One `categoryInUse` check covers both.

3. **node-cron last-day-of-month expression support**
   - What we know: node-cron 4.2.1 is the installed version candidate
   - What's unclear: Whether v4 supports `L` (last day) in month-day field
   - Recommendation: Use idempotency guard in the snapshot service (check if snapshot for current month already exists) regardless of cron expression. This makes the exact cron trigger less critical.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test && pnpm cypress:run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CRED-03 | Creditor interest accrual — reducing balance, no min period | unit | `pnpm test src/services/__tests__/creditor.service.test.ts` | ❌ Wave 0 |
| CRED-04 | Creditor repayment allocation — interest-first | unit | `pnpm test src/services/__tests__/creditor.service.test.ts` | ❌ Wave 0 |
| FINC-01 | Auto-posting to transaction log on payment record | unit | `pnpm test src/services/__tests__/payment.service.test.ts` | ✅ (extend) |
| FINC-01 | Auto-posting to transaction log on creditor repayment | unit | `pnpm test src/services/__tests__/creditor.service.test.ts` | ❌ Wave 0 |
| RPTS-03 | P&L sum = income categories - expense categories | unit | `pnpm test src/services/__tests__/report.service.test.ts` | ❌ Wave 0 |
| RPTS-04 | Balance sheet identity: Assets = Liabilities + Equity | unit | `pnpm test src/services/__tests__/report.service.test.ts` | ❌ Wave 0 |
| CRED-01 | Creditor registration form E2E | e2e (smoke) | `pnpm cypress:run --spec cypress/e2e/creditors.cy.ts` | ❌ Wave 0 |
| RPTS-05 | PDF export returns binary with correct Content-Type | integration | Route Handler test or Cypress download check | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test && pnpm cypress:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/services/__tests__/creditor.service.test.ts` — covers CRED-03, CRED-04, creditor repayment allocation
- [ ] `src/services/__tests__/report.service.test.ts` — covers RPTS-03 P&L math, RPTS-04 balance sheet identity
- [ ] `cypress/e2e/creditors.cy.ts` — smoke test for creditor registration and dashboard
- [ ] Extend `src/services/__tests__/payment.service.test.ts` — add test for auto-posting to transaction log (FINC-01)

*(Existing test infrastructure covers the interest engine and core services — only creditor/report/transaction tests are new gaps.)*

---

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/lib/interest/engine.ts`, `src/services/payment.service.ts`, `src/services/dashboard.service.ts`, `src/lib/db/schema/payments.ts` — patterns verified by reading source
- npm registry (verified 2026-03-21): jspdf@4.2.1, exceljs@4.4.0, node-cron@4.2.1

### Secondary (MEDIUM confidence)
- [jspdf npm page](https://www.npmjs.com/package/jspdf) — Node.js build files confirmed, CVE-2025-68428 patched in 4.0.0
- [ExcelJS npm page](https://www.npmjs.com/package/exceljs) — styling API capabilities confirmed
- [ExcelJS vs SheetJS comparison](https://npmtrends.com/exceljs-vs-sheetjs-vs-xlsx) — styling capability difference verified
- [react-pdf React 19 compat issue #2756](https://github.com/diegomura/react-pdf/issues/2756) — breaking issues confirmed
- [react-pdf compat page](https://react-pdf.org/compatibility) — React 19 supported from v4.1.0+

### Tertiary (LOW confidence — flagged)
- WebSearch result: node-cron `L` (last-day) expression support — NOT verified against node-cron v4 docs; use idempotency guard as mitigation regardless

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified against npm registry on research date
- Architecture: HIGH — directly derived from existing codebase patterns
- PDF/Excel library choice: MEDIUM-HIGH — npm registry confirmed versions; React 19 compat issues for react-pdf confirmed via GitHub issues
- Pitfalls: HIGH — derived from existing project decisions log and established CVEs
- Validation: HIGH — vitest.config.ts and test file structure directly read from codebase

**Research date:** 2026-03-21
**Valid until:** 2026-04-21 (stable libraries; jsPDF releasing frequently — re-check if > 30 days)
