# Architecture Patterns

**Domain:** Money Lending / Financial Management System
**Researched:** 2026-03-19

## Recommended Architecture

Next.js 16 App Router, full-stack monolith. Server Components handle data fetching directly. Route Handlers expose the API surface for mutations and cron triggers. A dedicated service layer holds all financial business logic, keeping it independent of the HTTP layer and testable in isolation. PostgreSQL stores all financial state.

```
┌──────────────────────────────────────────────────────────────┐
│                     Presentation Layer                       │
│  src/app/ — React Server Components + Client Components      │
│  Pages: customers, loans, payments, reports, admin           │
├──────────────────────────────────────────────────────────────┤
│                     API Layer                                │
│  src/app/api/ — Next.js Route Handlers                       │
│  /api/loans, /api/payments, /api/customers, /api/creditors   │
│  /api/cron/daily-interest (POST, secured by secret header)   │
│  /api/webhooks/clerk (login activity)                        │
├──────────────────────────────────────────────────────────────┤
│                   Service Layer                              │
│  src/lib/services/                                           │
│  LoanService, InterestEngine, PaymentProcessor               │
│  CreditorService, ReportService, NotificationService         │
├──────────────────────────────────────────────────────────────┤
│                 Data Access Layer                            │
│  src/lib/db/ — Prisma ORM + PostgreSQL                       │
│  Typed models: Customer, Loan, Payment, Creditor, ...        │
└──────────────────────────────────────────────────────────────┘
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| Route Handlers (`/api/*`) | Validate input, authenticate request, delegate to service, return HTTP response | Service Layer |
| `LoanService` | Loan issuance, status transitions, validation safeguards | `InterestEngine`, `PaymentProcessor`, Prisma |
| `InterestEngine` | Reducing balance interest calculation, daily accrual batch, 30-day minimum period rule | Prisma (reads/writes `InterestAccrual`) |
| `PaymentProcessor` | Allocate payment to interest-first then principal, update loan balance, emit receipt data | `InterestEngine` (to determine outstanding interest), Prisma |
| `CreditorService` | Creditor investment tracking, reuses `InterestEngine` for creditor accrual | Prisma, `InterestEngine` |
| `ReportService` | Aggregate queries for P&L, balance sheet, portfolio view | Prisma (read-only) |
| `NotificationService` | Email on money-in/out, 5-day due date alerts, overdue flagging | External email provider (e.g. Resend) |
| Cron Endpoint (`/api/cron/daily-interest`) | Invoked once daily by system cron; calls `InterestEngine.runDailyBatch()` | `InterestEngine` |
| `CronJobLog` table | Idempotency record for cron runs — prevents double-accrual on retries | Written by Cron Endpoint |

---

## Database Schema Patterns

### Core Principle: Store Accrued Interest Explicitly

Do not recalculate interest from scratch on every query. Store daily accrual as rows in an `InterestAccrual` table. This makes audit trails exact, reports fast, and the daily cron the single source of truth.

### Entity Overview

```
Customer (1) ──── (many) Loan
Loan     (1) ──── (many) Payment
Loan     (1) ──── (many) InterestAccrual
Loan     (1) ──── (1)    Guarantor        (per-loan, not per-customer)
Loan     (1) ──── (1)    Collateral       (per-loan)
Creditor (1) ──── (many) CreditorInvestment
CreditorInvestment (1) ── (many) InterestAccrual  (reuses same table with discriminator)
Transaction (standalone) ── references Loan or Expense or Income source
AuditLog    (immutable append-only)
CronJobLog  (idempotency guard)
```

### Key Tables (Prisma-flavoured pseudoschema)

```prisma
model Customer {
  id            String   @id @default(cuid())
  fullName      String
  phone         String?
  email         String?
  address       String
  status        CustomerStatus  @default(ACTIVE)  // ACTIVE | BLACKLISTED | INACTIVE
  createdAt     DateTime @default(now())
  loans         Loan[]
}

model Loan {
  id              String      @id @default(cuid())
  customerId      String
  customer        Customer    @relation(fields: [customerId], references: [id])
  principalAmount Decimal     @db.Decimal(15, 2)  // original disbursed amount
  outstandingBalance Decimal  @db.Decimal(15, 2)  // reduces as principal is paid
  interestRate    Decimal     @db.Decimal(5, 4)   // e.g. 0.1000 = 10% per month
  dailyRate       Decimal     @db.Decimal(10, 8)  // derived: interestRate / 30
  status          LoanStatus  @default(PENDING)
  // PENDING | ACTIVE | PARTIALLY_PAID | FULLY_PAID | DEFAULTED
  issuedAt        DateTime?
  dueAt           DateTime?   // issuedAt + 30 days
  fullyPaidAt     DateTime?
  minimumInterestDays Int     @default(30)
  accruedInterestBalance Decimal @db.Decimal(15, 2) @default(0)
  // running total of unpaid interest — updated by daily cron
  guarantor       Guarantor?
  collateral      Collateral?
  payments        Payment[]
  interestAccruals InterestAccrual[]
  createdAt       DateTime    @default(now())
  createdByUserId String      // Clerk user ID
}

model Payment {
  id               String   @id @default(cuid())
  loanId           String
  loan             Loan     @relation(fields: [loanId], references: [id])
  amountPaid       Decimal  @db.Decimal(15, 2)
  interestApplied  Decimal  @db.Decimal(15, 2)  // portion allocated to interest
  principalApplied Decimal  @db.Decimal(15, 2)  // portion allocated to principal
  balanceBefore    Decimal  @db.Decimal(15, 2)  // snapshot for receipt
  balanceAfter     Decimal  @db.Decimal(15, 2)  // snapshot for receipt
  paidAt           DateTime @default(now())
  recordedByUserId String
  receiptNumber    String   @unique  // auto-generated, human-readable
}

model InterestAccrual {
  id            String   @id @default(cuid())
  loanId        String?
  loan          Loan?    @relation(fields: [loanId], references: [id])
  creditorInvestmentId String?  // populated when this is creditor-side accrual
  date          DateTime @db.Date  // the calendar date this accrual is for
  principalAtDate Decimal @db.Decimal(15, 2)  // balance used to calculate
  dailyRate     Decimal  @db.Decimal(10, 8)
  interestAmount Decimal @db.Decimal(15, 2)   // = principalAtDate * dailyRate
  @@unique([loanId, date])  // idempotency: one accrual per loan per day
  @@unique([creditorInvestmentId, date])
}

model Guarantor {
  id       String @id @default(cuid())
  loanId   String @unique
  loan     Loan   @relation(fields: [loanId], references: [id])
  fullName String
  phone    String
  address  String
}

model Collateral {
  id          String @id @default(cuid())
  loanId      String @unique
  loan        Loan   @relation(fields: [loanId], references: [id])
  nature      String  // "Land Title", "Motor Vehicle Log Book", etc.
  description String?
}

model Creditor {
  id          String   @id @default(cuid())
  fullName    String
  phone       String?
  email       String?
  address     String
  createdAt   DateTime @default(now())
  investments CreditorInvestment[]
}

model CreditorInvestment {
  id              String   @id @default(cuid())
  creditorId      String
  creditor        Creditor @relation(fields: [creditorId], references: [id])
  amount          Decimal  @db.Decimal(15, 2)
  interestRate    Decimal  @db.Decimal(5, 4)
  outstandingBalance Decimal @db.Decimal(15, 2)
  startedAt       DateTime
  status          InvestmentStatus @default(ACTIVE)
  accruedInterestBalance Decimal @db.Decimal(15, 2) @default(0)
  interestAccruals InterestAccrual[]
}

model Transaction {
  id          String          @id @default(cuid())
  type        TransactionType // DEBIT | CREDIT
  category    String          // "Loan Disbursement", "Repayment", "Salary", "Rent", etc.
  amount      Decimal         @db.Decimal(15, 2)
  description String?
  referenceId String?         // loanId, creditorInvestmentId, or null for manual entries
  occurredAt  DateTime        @default(now())
  recordedByUserId String
}

model AuditLog {
  id         String   @id @default(cuid())
  entityType String   // "Loan", "Payment", "Customer", etc.
  entityId   String
  action     String   // "CREATED", "STATUS_CHANGED", "PAYMENT_RECORDED", etc.
  before     Json?    // snapshot before change
  after      Json?    // snapshot after change
  userId     String
  occurredAt DateTime @default(now())
}

model CronJobLog {
  id          String   @id @default(cuid())
  jobName     String   // "daily-interest"
  runDate     DateTime @db.Date  // the date this run was FOR (not when it ran)
  status      String   // "COMPLETED" | "FAILED" | "PARTIAL"
  loansProcessed Int   @default(0)
  errors      Json?
  startedAt   DateTime
  completedAt DateTime?
  @@unique([jobName, runDate])  // prevents double-run for same date
}
```

### Numeric Precision

Use `Decimal` (`NUMERIC` in PostgreSQL) for all monetary values, never `Float`. Floating point arithmetic causes cent-level rounding errors that compound over time in a lending system. `Decimal(15, 2)` supports up to 999 trillion with 2 decimal places. Interest rates use `Decimal(5, 4)` (e.g., `0.1000`) and daily rates use `Decimal(10, 8)` for precision across the division.

---

## Data Flow for Key Operations

### 1. Loan Issuance

```
Loan Officer fills form
  → POST /api/loans
  → Route Handler: validate input, check Clerk auth + role
  → LoanService.issueLoan(dto)
      → verify customer exists and is ACTIVE
      → verify guarantor + collateral present (safeguard)
      → compute dailyRate = interestRate / 30
      → create Loan (status: ACTIVE), Guarantor, Collateral in DB transaction
      → create Transaction (DEBIT, "Loan Disbursement")
      → write AuditLog entry
  → Return loan record + disbursement receipt data
  → Frontend renders printable receipt
```

### 2. Daily Interest Run (Cron)

```
System cron fires at 00:05 daily (server-side cron or external scheduler)
  → POST /api/cron/daily-interest
    Authorization: Bearer CRON_SECRET (verified by handler)
  → Check CronJobLog for today's date → if already COMPLETED, return 200 (idempotent)
  → Write CronJobLog (status: RUNNING)
  → InterestEngine.runDailyBatch(runDate)
      → Query all loans WHERE status IN (ACTIVE, PARTIALLY_PAID)
      → For each loan:
          → Check if InterestAccrual already exists for (loanId, runDate) → skip if yes
          → Calculate dailyInterest = outstandingBalance * dailyRate
          → Insert InterestAccrual row
          → Increment Loan.accruedInterestBalance by dailyInterest
      → Query all CreditorInvestments WHERE status = ACTIVE (same pattern)
      → Auto-flag overdue loans: WHERE dueAt < runDate AND status != FULLY_PAID
  → Update CronJobLog (status: COMPLETED, loansProcessed: N)
  → Return 200
```

The `@@unique([loanId, date])` constraint on `InterestAccrual` acts as a hard idempotency guard independent of `CronJobLog`. A retry cannot double-accrue.

### 3. Payment Recording

```
Loan Officer enters payment amount
  → POST /api/payments
  → Route Handler: validate, auth check
  → PaymentProcessor.recordPayment(loanId, amountPaid)
      → Load loan (with accruedInterestBalance, outstandingBalance)
      → Enforce minimum interest period:
          → if daysActive < minimumInterestDays:
              interestOwed = minimumInterest - totalInterestPaid (floor, not negative)
          → else:
              interestOwed = loan.accruedInterestBalance
      → Allocate payment:
          → interestApplied = min(amountPaid, interestOwed)
          → principalApplied = amountPaid - interestApplied
      → Update Loan:
          → accruedInterestBalance -= interestApplied
          → outstandingBalance -= principalApplied
          → Recalculate status:
              → outstandingBalance == 0 → FULLY_PAID
              → outstandingBalance < principalAmount → PARTIALLY_PAID
      → Create Payment record (with before/after balance snapshots)
      → Create Transaction (CREDIT, "Repayment")
      → Write AuditLog
      → Trigger NotificationService.onPaymentReceived (email admin)
  → Return payment record + repayment receipt data
```

---

## Service Layer Design

### `InterestEngine` — Core Calculation Rules

```typescript
// src/lib/services/interest-engine.ts

// Reducing balance: interest is calculated on the CURRENT outstanding principal
// not the original loan amount.
// dailyInterest = outstandingBalance * (monthlyRate / 30)

// Minimum interest period: even if borrower repays in 5 days, they owe
// at least 30 days of interest. This is enforced in PaymentProcessor,
// not in the daily accrual (which just records actual days elapsed).
```

The engine exposes:
- `runDailyBatch(date)` — called by cron
- `calculateProjectedBalance(loanId, paymentAmount)` — for the repayment simulator
- `calculateDaysRemaining(loanId)` — balance-to-days converter

### `PaymentProcessor` — Allocation Rules

Interest-first allocation is a non-negotiable business rule. The processor enforces:
1. All outstanding accrued interest must be cleared before any principal reduction
2. Minimum interest period floor (admin-configurable, default 30 days)
3. Atomic DB transaction wrapping payment creation + balance updates

### `ReportService` — Aggregate Queries Only

The report service issues only read queries. It never mutates state. Report generation is decoupled from all loan/payment operations.

---

## Cron Job Architecture in Next.js

Next.js does not have a built-in scheduler. The recommended pattern for a self-hosted Node.js deployment is:

**Option A (Recommended for self-hosted): System cron + secured Route Handler**

```
# /etc/cron.d/money-lending  (or system crontab)
5 0 * * * curl -s -X POST https://your-domain.com/api/cron/daily-interest \
  -H "Authorization: Bearer $CRON_SECRET" \
  >> /var/log/lending-cron.log 2>&1
```

The Route Handler at `/api/cron/daily-interest`:
1. Validates `Authorization: Bearer <CRON_SECRET>` header (env var, never public)
2. Returns 200 immediately if today's `CronJobLog` shows COMPLETED
3. Calls `InterestEngine.runDailyBatch(today)`
4. Logs result to `CronJobLog`

This is stateless, retryable, and auditable. The cron secret prevents accidental or malicious triggers.

**Option B: `node-cron` via `instrumentation.ts`**

```typescript
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const cron = await import('node-cron')
    cron.schedule('5 0 * * *', async () => {
      // call InterestEngine.runDailyBatch() directly
    })
  }
}
```

`instrumentation.ts` `register()` runs once at server startup (confirmed in Next.js 16.2.0 docs). This works but is harder to monitor, test, and retry independently. Use only if external cron scheduling is unavailable.

**Recommendation:** Option A. It is observable (logs in cron output + `CronJobLog` table), independently retryable, and decoupled from the Next.js process lifecycle.

---

## Audit Logging Pattern

Every state-mutating operation writes an `AuditLog` row as part of the same database transaction. This is not optional — financial systems require an immutable record of who changed what and when.

```typescript
// Pattern: always inside the same Prisma transaction
await prisma.$transaction([
  prisma.loan.update({ where: { id }, data: { status: 'FULLY_PAID' } }),
  prisma.auditLog.create({
    data: {
      entityType: 'Loan',
      entityId: id,
      action: 'STATUS_CHANGED',
      before: { status: 'PARTIALLY_PAID' },
      after: { status: 'FULLY_PAID' },
      userId: clerkUserId,
    }
  })
])
```

The `AuditLog` table is append-only. No application code ever updates or deletes audit rows. This is enforced by convention — do not expose update/delete endpoints for this table.

---

## Patterns to Follow

### Pattern: Immutable Payment Records

Once a `Payment` row is created, it is never updated. Corrections are handled by creating a reversal entry (a separate payment with a negative flag or a manual transaction adjustment) and a corresponding `AuditLog` entry. This preserves the full financial history.

### Pattern: Snapshot Balances on Payment

The `Payment` record stores `balanceBefore` and `balanceAfter`. This means a receipt can always be regenerated accurately from the database, even after subsequent payments change the loan balance. Do not recalculate receipt values at render time.

### Pattern: Decimal Arithmetic via Prisma/PostgreSQL

Prisma maps `Decimal` fields to the `Decimal.js` library in Node.js, which provides arbitrary-precision arithmetic. All interest calculations must use `Decimal` operations, never native JavaScript `number` arithmetic.

### Pattern: Single Source of Truth for Balances

`Loan.outstandingBalance` and `Loan.accruedInterestBalance` are the authoritative balances. They are updated transactionally on every payment and every daily accrual. Do not recalculate running balances by summing historical records — that approach is slow and error-prone. The daily cron and payment processor maintain these as live columns.

---

## Anti-Patterns to Avoid

### Anti-Pattern: Float for Money

**What:** `amount: Float` in schema or `parseFloat()` in calculation code
**Why bad:** `0.1 + 0.2 !== 0.3` in IEEE 754. Over hundreds of accrual days, rounding errors compound into real money discrepancies.
**Instead:** `Decimal` in schema, `Decimal.js` in calculation code.

### Anti-Pattern: Recalculate Interest from Raw History

**What:** Deriving loan balance/interest by summing all `InterestAccrual` rows on every request
**Why bad:** O(n) query per loan where n is days active (a 2-year loan = 730 rows). Unacceptable for dashboards showing 100+ loans.
**Instead:** Maintain running balance columns (`accruedInterestBalance`, `outstandingBalance`) updated transactionally. Use `InterestAccrual` rows only for audit/history views.

### Anti-Pattern: Business Logic in Route Handlers

**What:** Loan allocation, interest calculation, and status transition logic inside `app/api/*/route.ts`
**Why bad:** Untestable without HTTP, duplicated when logic is needed in cron, and brittle when rules change.
**Instead:** Route handlers are thin — validate, auth-check, call a service function, return response.

### Anti-Pattern: Skipping the Minimum Interest Period in Daily Accrual

**What:** Stopping accrual after 30 days if the borrower hasn't paid
**Why bad:** The 30-day minimum is a *payment floor*, not an accrual cap. Interest continues to accrue every day regardless.
**Instead:** Daily accrual runs indefinitely on active loans. The minimum period rule is enforced only at payment allocation time — the borrower must pay at least 30 days' interest even if they repay early.

### Anti-Pattern: Unguarded Cron Endpoint

**What:** `GET /api/cron/daily-interest` with no auth, or using a predictable token
**Why bad:** Anyone who discovers the URL can trigger mass interest writes or drain server resources.
**Instead:** `CRON_SECRET` env variable, verified on every request. Reject all requests that don't present it.

---

## Suggested Build Order (Dependencies)

Build order is dictated by data dependencies. Each phase must be stable before the next can be built correctly.

```
1. Database schema + Prisma setup
   └── All other layers depend on this

2. Customer entity (CRUD + status)
   └── Loans cannot be issued without a customer

3. Core Loan Engine
   a. Loan issuance (create loan + guarantor + collateral)
   b. InterestEngine (daily accrual calculation)
   c. Cron endpoint + CronJobLog (runs the engine daily)
   └── Payment processor depends on having accrued interest

4. Payment Processor
   └── Requires: loan engine, accrued interest balance
   └── Generates: Payment records, receipt data

5. Creditor Management
   └── Reuses InterestEngine — build after loan engine is proven correct

6. Transaction Log + Expense/Income Tracking
   └── Standalone, but enriched once loan/payment data exists

7. Receipts (disbursement + repayment)
   └── Requires: loan + payment records with balance snapshots

8. Notifications + Alerts
   └── Requires: loan status, due dates, payment events

9. Reporting (Dashboard, P&L, Balance Sheet)
   └── Requires: all financial data to be present and correct

10. Admin Panel (role assignment, settings override)
    └── Settings affect loan engine behavior — build once engine is stable
```

---

## Scalability Considerations

| Concern | At current scale (100 loans) | If scale grows (10K+ loans) |
|---------|------------------------------|------------------------------|
| Daily interest cron | Single batch, sequential loop is fine | Chunk into batches of 500, process with `Promise.allSettled` |
| Balance queries | Direct column reads — fast | Still fast, columns are indexed by default |
| Report generation | Aggregate queries — acceptable latency | Add materialized views or background pre-computation |
| `InterestAccrual` table growth | ~100 rows/day = 36K/year | ~10K rows/day = 3.6M/year — add index on `(loanId, date)`, partition by year |

---

## Sources

- Next.js 16.2.0 Route Handlers documentation (official, verified): `https://nextjs.org/docs/app/api-reference/file-conventions/route`
- Next.js 16.2.0 `after()` function documentation (official, verified): `https://nextjs.org/docs/app/api-reference/functions/after`
- Next.js 16.2.0 Instrumentation documentation (official, verified): `https://nextjs.org/docs/app/guides/instrumentation`
- Next.js 16.2.0 Self-hosting guide re: cron and `after` support (official, verified): `https://nextjs.org/docs/app/guides/self-hosting`
- Project requirements: `.planning/PROJECT.md`
- Existing codebase analysis: `.planning/codebase/ARCHITECTURE.md`
- Reducing balance interest calculation logic: domain knowledge (MEDIUM confidence — standard financial formula, widely documented)
- PostgreSQL `NUMERIC` type for monetary values: domain standard practice (HIGH confidence)
