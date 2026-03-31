# Architecture

**Analysis Date:** 2026-03-31

## Pattern Overview

**Overall:** Fullstack Next.js with three-tier separation (API/Service layer, UI/React layer, Database layer) using Server Actions as the primary API boundary.

**Key Characteristics:**
- Next.js 16 with App Router using route groups for layout organization (`(app)` and `(auth)`)
- Server Actions ("use server") in `/src/actions/*` as primary backend API surface — no traditional REST API handlers
- Effect library for error handling and async operations with tagged errors
- TanStack React Query for client-side state management and data fetching
- Drizzle ORM for type-safe database access with schema-as-code
- Perpetual loan model: loans never "mature" — payment table is the source of truth for interest rate/period
- Role-based access control enforced at action layer with hierarchical roles (unassigned → loanOfficer → admin → superAdmin)

## Layers

**Database Layer:**
- Purpose: Data persistence and schema definition
- Location: `src/lib/db/`
- Contains: Drizzle schema definitions, migrations, seed scripts
- Depends on: PostgreSQL (via `postgres` npm package)
- Used by: Service layer exclusively

**Service/Domain Layer:**
- Purpose: Business logic, calculations, validation, data transformations
- Location: `src/services/`
- Contains: `*.service.ts` files implementing domain logic (loan, payment, customer, audit, reports, etc.)
- Depends on: Database layer, Effect library for error handling
- Used by: Server Actions exclusively

**Action/API Layer:**
- Purpose: Request validation, authentication, authorization, action invocation
- Location: `src/actions/`
- Contains: Server Action functions ("use server") that call services
- Depends on: Service layer, auth context (`src/lib/auth`), headers
- Used by: Client components via TanStack React Query hooks

**UI/Component Layer:**
- Purpose: Rendering UI, user interactions, form submission
- Location: `src/app/` (pages/layouts) and `src/components/` (reusable components)
- Contains: Next.js pages, route groups, layout hierarchies, React components
- Depends on: Hooks (`src/hooks/`), services (indirect via hooks), UI primitives
- Used by: Browser

**Types/Shared:**
- Purpose: TypeScript definitions shared across layers
- Location: `src/types/index.ts`
- Contains: Entity types (Customer, Loan, Payment, etc.), input DTOs (CreateLoanInput, etc.), API response shapes
- Depends on: Drizzle ORM types (InferSelectModel, InferInsertModel)
- Used by: All layers

## Data Flow

**Create Loan Flow:**

1. User submits form in `src/app/(app)/loans/new/page.tsx`
2. Form submission calls `createLoanAction()` from `src/actions/loan.actions.ts`
3. Action verifies session, checks authorization role (admin+), validates inputs
4. Action calls `createLoan()` from `src/services/loan.service.ts`
5. Service runs Effect pipeline: verify customer exists/complete, check blacklist, insert loan + collateral in transaction, write audit log
6. Service returns Loan + Collateral or throws tagged error (CustomerNotFound, IncompleteLoanRequirements, etc.)
7. Action catches errors, returns { data: Loan } or { error: string }
8. Hook (`useCreateLoan`) unwraps response, updates React Query cache
9. Page revalidates via `revalidatePath("/loans")` in action
10. UI refetches and displays updated loan list

**Record Payment Flow:**

1. User visits `src/app/(app)/loans/[loanId]/payments/new/page.tsx`
2. Form submission calls `recordPaymentAction()` from `src/actions/payment.actions.ts`
3. Action validates session, calls `recordPayment()` from `src/services/payment.service.ts`
4. Service fetches active loan, calculates interest accrued, inserts payment record, updates loan accrual counters
5. Service writes audit log with beforeValue/afterValue for compliance
6. Action revalidates path, returns success or error
7. Client component invalidates React Query cache for watchlist/dashboard

**Watchlist Calculation Flow:**

1. Page loads `src/app/(app)/watchlist/page.tsx` or `src/app/(app)/loans/page.tsx`
2. Hook calls `getWatchlistAction()` from `src/actions/watchlist.actions.ts`
3. Action calls `getWatchlist()` from `src/services/watchlist.service.ts`
4. Service queries all active loans + their payment histories
5. For each loan, calculates:
   - Interest accrued: `calculateInterest(principal, rate, daysSinceStart, minDays=30)`
   - Interest paid: sum of all payments
   - Days overdue: `calculateDaysOverdue(accrued, paid, dailyRate)` using reducing-balance formula
6. Filters: loans with daysOverdue > 0 marked as "overdue"
7. Returns WatchlistEntry[] with daysOverdue, outstanding, status
8. React Query caches with staleTime=60s, gcTime=24h
9. Component renders OverdueBadge and ResponsiveTable

**State Management:**

- **Server State:** React Query owns all remote state (loans, customers, payments). Queries auto-sync with server via revalidatePath invalidations.
- **UI State:** Component local state for UI toggles (open/close dialogs, form errors). Zustand store exists (`src/lib/store.ts`) but currently empty — not used.
- **Cache:** localStorage persists React Query cache across tabs (24h TTL). Dev tools show cache state in React Query DevTools panel.

## Key Abstractions

**Effect-based Error Handling:**
- Purpose: Type-safe error propagation without exceptions
- Examples: `src/services/loan.service.ts`, `src/services/payment.service.ts`
- Pattern: Functions return `Effect.Effect<SuccessType, ErrorTag1 | ErrorTag2>`. Caller uses `Effect.runPromise()` wrapped in try/catch. Errors are tagged unions (CustomerNotFound, ValidationError, etc. defined in `src/lib/errors.ts`).

**TanStack React Query Hooks:**
- Purpose: Encapsulate data fetching logic and cache management
- Examples: `src/hooks/use-watchlist.ts`, `src/hooks/use-dashboard.ts`
- Pattern: Each page has a corresponding hook. Hook calls action, unwraps response using `unwrapAction()`, passes to useQuery. Query key lives in `src/hooks/query-keys.ts` for consistency.

**Input DTOs (Data Transfer Objects):**
- Purpose: Validate and type incoming request data before service processing
- Examples: CreateLoanInput, RecordPaymentInput, UpdateLoanInput in `src/types/index.ts`
- Pattern: Actions receive DTO, validate shape, pass to services. DTOs use string for numeric fields (NUMERIC precision, no float rounding).

**Interest Calculation Engine:**
- Purpose: Calculate interest accrual, daily rates, and days overdue
- Examples: `src/lib/interest/engine.ts` exports calculateInterest(), calculateDailyRate(), calculateDaysOverdue(), calculateLoanSummary()
- Pattern: Pure functions using BigNumber.js for decimal precision. Reducing-balance formula: `interest = principal × dailyRate × effectiveDays`. Daily rate = monthly rate / 30. Effective days = max(elapsed, minInterestDays).

**Audit Logging:**
- Purpose: Immutable record of all mutations for compliance
- Examples: `src/services/audit.service.ts`, called from all CRUD services
- Pattern: writeAuditLog(tx, {actorId, action, entityType, entityId, beforeValue, afterValue}). Always within database transaction. Values JSON-stringified.

**Responsive Table Component:**
- Purpose: Mobile/desktop adaptive table with column configuration
- Examples: `src/components/ui/responsive-table.tsx`, used in loans/payments/customers pages
- Pattern: Column[] array defines header, render function, alignment, mobile visibility. Component switches between table (desktop) and card layout (mobile) based on screen size.

## Entry Points

**Web Root:**
- Location: `src/app/page.tsx`
- Triggers: User navigates to root URL
- Responsibilities: Redirects to `/dashboard`

**App Layout:**
- Location: `src/app/(app)/layout.tsx`
- Triggers: All routes under `/(app)/*`
- Responsibilities: Wraps children with Providers (React Query, Zustand), AppShell (sidebar, top-bar, bottom-tab-bar)

**Auth Layout:**
- Location: `src/app/(auth)/layout.tsx`
- Triggers: All routes under `/(auth)/*`
- Responsibilities: Renders login/register/forgot-password pages without AppShell

**Dashboard:**
- Location: `src/app/(app)/dashboard/page.tsx`
- Triggers: User logs in or navigates to `/dashboard`
- Responsibilities: Displays KPI cards, summary metrics, recent transactions

**Loans List:**
- Location: `src/app/(app)/loans/page.tsx`
- Triggers: Loan officer views all loans
- Responsibilities: Renders responsive table of active/paid loans with detail links, create button

**Loan Detail:**
- Location: `src/app/(app)/loans/[loanId]/page.tsx`
- Triggers: User clicks loan row
- Responsibilities: Shows full loan profile, payment history, collateral, actions (edit, delete, record payment)

**API Routes:**
- Location: `src/app/api/*`
- Contains: Auth handler (`[...all]`), cron handlers (month-end, overdue), report generators (balance-sheet, P&L, portfolio, transactions), test utilities
- Purpose: System-level operations (auth provider integration, scheduled tasks, financial reporting)

## Error Handling

**Strategy:** Tagged union errors using Effect library. No thrown exceptions cross the service boundary.

**Patterns:**

- **Service Level:** Services return `Effect.Effect<T, ErrorTag>`. Error tags defined in `src/lib/errors.ts` as Data.TaggedError subclasses (e.g., `CustomerNotFound`, `ValidationError`, `DatabaseError`). Caller pattern: `Effect.runPromise(service()).catch(error => handle(error))`.

- **Action Level:** Actions call services inside try/catch. If service Error caught, action returns `{ error: "User-friendly message" }`. If success, returns `{ data: result }`. Never throws from action.

- **Component Level:** Hooks use unwrapAction() to convert { data } | { error } to single value. useQuery() throws on error, caught by error boundary or Sonner toast.

- **Common Errors:**
  - CustomerNotFound: Loan officer tries to create loan for non-existent customer
  - IncompleteLoanRequirements: Customer missing fullName, contact, or address
  - ValidationError: Invalid input (principal <= 0, negative rate, etc.)
  - DatabaseError: Transaction failed, constraint violated
  - UnauthorizedError: User not authenticated
  - ForbiddenError: User lacks permission (role too low)

## Cross-Cutting Concerns

**Logging:**

- Framework: Pino (structured logging)
- Configuration: `src/lib/logger.ts`
- Development: Pretty-printed output with colors, timestamps
- Production: JSON format for log aggregation
- Usage: Imports via `import logger from "@/lib/logger"`. Call `logger.info()`, `logger.error()`, etc. No general `console.log()` calls in services.

**Validation:**

- Form level: React Hook Form + custom validators in components
- Input DTO level: TypeScript type checking (no Zod schema in actions)
- Service level: Domain-specific validation (e.g., checkCustomerCompleteness, blacklist checks) via Effect errors
- Database level: Drizzle constraints (notNull, references, defaults)

**Authentication:**

- Provider: Better Auth (`src/lib/auth.ts` — auth instance, `src/lib/auth-client.ts` — client hooks)
- Session: Headers-based via `headers()` from next/headers
- Pattern: Actions call `auth.api.getSession({ headers: await headers() })`. Returns {user: {id, role, email, ...}} or null.

**Authorization:**

- Role hierarchy: `src/types/index.ts` defines ROLE_LEVELS: {unassigned:0, loanOfficer:1, admin:2, superAdmin:3}
- Enforcement: Each action checks `session?.user.role` and compares against ROLE_LEVELS[required] >= ROLE_LEVELS[actual]. Returns ForbiddenError if insufficient.
- Examples: Admin-only actions like updateLoan, deleteLoan require `ROLE_LEVELS[role] >= ROLE_LEVELS.admin`

**Transaction Safety:**

- Pattern: Database mutations always wrapped in `db.transaction(async tx => {...})`. Audit log written within same transaction. If rollback occurs, audit also rolls back.
- Example: `src/services/loan.service.ts` createLoan() inserts loan + collateral + audit log in single transaction

---

*Architecture analysis: 2026-03-31*
