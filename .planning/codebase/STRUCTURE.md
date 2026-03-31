# Codebase Structure

**Analysis Date:** 2026-03-31

## Directory Layout

```
money-lending/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (app)/                    # Protected routes (requires auth)
│   │   │   ├── admin/                # Admin panel
│   │   │   ├── customers/            # Customer management (list, detail, new)
│   │   │   ├── dashboard/            # Dashboard home
│   │   │   ├── loans/                # Loan pages
│   │   │   │   ├── [loanId]/         # Loan detail + payments
│   │   │   │   └── new/              # Create loan form
│   │   │   ├── payments/             # Global payments list + quick record
│   │   │   ├── creditors/            # Creditor/investor management
│   │   │   ├── expenses/             # Expense tracking
│   │   │   ├── income/               # Income tracking
│   │   │   ├── watchlist/            # Overdue loans watchlist
│   │   │   ├── receipts/             # Receipt printing (disbursement, repayment)
│   │   │   ├── transactions/         # Transaction log
│   │   │   ├── reports/              # Financial reports
│   │   │   ├── layout.tsx            # App layout (with Providers, AppShell)
│   │   │   └── loading.tsx           # Fallback spinner
│   │   ├── (auth)/                   # Public auth routes
│   │   │   ├── login/
│   │   │   ├── register/
│   │   │   ├── forgot-password/
│   │   │   ├── reset-password/
│   │   │   ├── verify-email/
│   │   │   └── layout.tsx            # Auth layout (no AppShell)
│   │   ├── pending-approval/         # Wait-for-admin page
│   │   ├── api/                      # Route handlers
│   │   │   ├── auth/[...all]/        # Better Auth integration
│   │   │   ├── cron/
│   │   │   │   ├── month-end/        # Month-end snapshot job
│   │   │   │   └── overdue/          # Overdue detection job
│   │   │   └── reports/              # Report generation endpoints
│   │   │       ├── balance-sheet/
│   │   │       ├── pnl/
│   │   │       ├── portfolio/
│   │   │       └── transactions/
│   │   ├── layout.tsx                # Root layout (HTML, fonts, theme)
│   │   ├── page.tsx                  # Root (redirects to /dashboard)
│   │   └── favicon.ico
│   │
│   ├── actions/                      # Server Actions ("use server")
│   │   ├── loan.actions.ts
│   │   ├── payment.actions.ts
│   │   ├── customer.actions.ts
│   │   ├── daily-collections.actions.ts
│   │   ├── watchlist.actions.ts
│   │   ├── dashboard.actions.ts
│   │   ├── creditors/actions.ts
│   │   ├── user.actions.ts
│   │   ├── notification.actions.ts
│   │   └── settings.actions.ts
│   │
│   ├── services/                     # Domain logic (no HTTP/UI awareness)
│   │   ├── loan.service.ts           # Loan CRUD, calculations
│   │   ├── payment.service.ts        # Payment recording
│   │   ├── customer.service.ts
│   │   ├── creditor.service.ts
│   │   ├── daily-collections.service.ts
│   │   ├── watchlist.service.ts      # Overdue calculation
│   │   ├── dashboard.service.ts
│   │   ├── audit.service.ts          # Audit trail
│   │   ├── category.service.ts
│   │   ├── transaction.service.ts
│   │   ├── notification.service.ts
│   │   ├── report.service.ts         # Financial reporting
│   │   ├── export/
│   │   │   ├── pdf.service.ts        # PDF generation
│   │   │   └── excel.service.ts      # Excel export
│   │   ├── __tests__/                # Unit tests (Vitest)
│   │   │   ├── loan.service.test.ts
│   │   │   ├── payment.service.test.ts
│   │   │   ├── *.service.test.ts     # One test per service
│   │   │   └── ...
│   │   └── __integration__/          # Integration tests (Vitest)
│   │       ├── setup.ts              # Test database setup
│   │       ├── loan.service.test.ts
│   │       └── ...
│   │
│   ├── components/                   # Reusable UI components
│   │   ├── ui/                       # Base UI (buttons, inputs, etc.)
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── form.tsx
│   │   │   ├── input.tsx
│   │   │   ├── select.tsx
│   │   │   ├── table.tsx
│   │   │   ├── responsive-table.tsx  # Mobile/desktop table
│   │   │   ├── badge.tsx
│   │   │   ├── spinner.tsx
│   │   │   ├── sonner.tsx            # Toast provider
│   │   │   ├── drawer-dialog.tsx     # Mobile-responsive dialog
│   │   │   └── ... (shadcn/ui adapted)
│   │   ├── layout/                   # App shell components
│   │   │   ├── app-shell.tsx         # Layout wrapper
│   │   │   ├── sidebar.tsx           # Navigation sidebar
│   │   │   ├── top-bar.tsx           # Header
│   │   │   ├── bottom-tab-bar.tsx    # Mobile footer nav
│   │   │   ├── more-sheet.tsx        # Mobile menu drawer
│   │   │   └── ...
│   │   ├── providers.tsx             # React Query + Zustand setup
│   │   ├── notifications/
│   │   │   └── notification-bell.tsx
│   │   ├── watchlist/
│   │   │   └── overdue-badge.tsx
│   │   ├── loans/
│   │   │   └── simulator-panel.tsx
│   │   ├── dashboard/
│   │   │   └── kpi-card.tsx
│   │   ├── customers/
│   │   │   └── customer-search-bar.tsx
│   │   └── ...
│   │
│   ├── hooks/                        # React hooks (custom + query hooks)
│   │   ├── query-keys.ts             # TanStack Query key factory
│   │   ├── query-utils.ts            # unwrapAction() helper
│   │   ├── use-watchlist.ts
│   │   ├── use-dashboard.ts
│   │   ├── use-customers.ts
│   │   ├── use-payments.ts
│   │   ├── use-daily-collections.ts
│   │   ├── use-create-loan.ts
│   │   ├── use-create-customer.ts
│   │   ├── use-customer.ts
│   │   ├── use-notifications.ts
│   │   ├── use-admin-users.ts
│   │   ├── __tests__/                # Hook unit tests
│   │   └── ...
│   │
│   ├── lib/                          # Shared utilities and config
│   │   ├── db/
│   │   │   ├── index.ts              # Drizzle instance (db object)
│   │   │   ├── schema/               # Drizzle schema definitions
│   │   │   │   ├── index.ts
│   │   │   │   ├── loans.ts
│   │   │   │   ├── payments.ts
│   │   │   │   ├── customers.ts
│   │   │   │   ├── collateral.ts
│   │   │   │   ├── creditors.ts
│   │   │   │   ├── creditor-investments.ts
│   │   │   │   ├── creditor-repayments.ts
│   │   │   │   ├── transactions.ts
│   │   │   │   ├── transaction-categories.ts
│   │   │   │   ├── notifications.ts
│   │   │   │   ├── audit.ts
│   │   │   │   ├── settings.ts
│   │   │   │   ├── auth.ts
│   │   │   │   ├── financial-snapshots.ts
│   │   │   │   └── ...
│   │   │   └── seed-categories.ts    # Category seeding
│   │   ├── auth.ts                   # Better Auth instance
│   │   ├── auth-client.ts            # Better Auth client hooks
│   │   ├── logger.ts                 # Pino logger setup
│   │   ├── errors.ts                 # Tagged error classes (Effect)
│   │   ├── permissions.ts            # Permission helpers
│   │   ├── utils.ts                  # General utilities (format, parse)
│   │   ├── interest/                 # Interest calculation engine
│   │   │   ├── index.ts
│   │   │   ├── engine.ts             # Core calculations
│   │   │   └── __tests__/
│   │   │       └── engine.test.ts
│   │   ├── email.ts                  # Email sending (Resend)
│   │   ├── emails/                   # Email template components
│   │   │   └── index.ts
│   │   ├── msw/                      # Mock Service Worker (dev mocks)
│   │   │   ├── handlers.ts
│   │   │   └── server.ts
│   │   ├── store.ts                  # Zustand store (currently empty)
│   │   ├── __tests__/                # Utility tests
│   │   │   ├── errors.test.ts
│   │   │   ├── permissions.test.ts
│   │   │   └── utils.test.ts
│   │
│   ├── types/
│   │   └── index.ts                  # All TypeScript types, DTOs, response shapes
│   │
│   └── proxy.ts                      # Proxy utilities (internal)
│
├── cypress/                          # End-to-end tests (Cypress)
│   ├── e2e/                          # Test specs
│   │   ├── admin-panel.cy.ts
│   │   ├── customers.cy.ts
│   │   ├── expenses.cy.ts
│   │   ├── income.cy.ts
│   │   ├── loans.cy.ts
│   │   ├── payments.cy.ts
│   │   ├── optimistic-rollback.cy.ts
│   │   └── ...
│   ├── support/                      # Cypress commands, helpers
│   ├── downloads/                    # Downloaded files during tests
│   ├── videos/                       # Test recordings
│   └── screenshots/                  # Failure screenshots
│
├── drizzle/                          # Database migrations
│   ├── meta/
│   └── *.sql                         # Migration files
│
├── .planning/                        # Planning documents
│   ├── codebase/                     # Codebase analysis
│   │   ├── ARCHITECTURE.md           # This file
│   │   ├── STRUCTURE.md
│   │   ├── CONVENTIONS.md
│   │   ├── TESTING.md
│   │   ├── STACK.md
│   │   ├── INTEGRATIONS.md
│   │   └── CONCERNS.md
│   ├── milestones/                   # Version-based plans
│   ├── quick/                        # Quick task plans
│   └── phases/                       # Feature phase plans
│
├── public/                           # Static assets
│   └── ...
│
├── logs/                             # Application logs (runtime)
│
├── next.config.ts                    # Next.js config
├── tsconfig.json                     # TypeScript config
├── vitest.config.ts                  # Vitest (unit/integration tests)
├── vitest.integration.config.ts      # Vitest integration-specific config
├── cypress.config.ts                 # Cypress E2E config
├── tailwind.config.ts                # Tailwind CSS v4 config
├── postcss.config.mjs                # PostCSS for Tailwind
├── eslint.config.mjs                 # ESLint rules
├── package.json
├── pnpm-lock.yaml
├── CLAUDE.md                         # Claude Code instructions
├── AGENTS.md                         # AI agent instructions
├── DESIGN.md                         # Design system docs
└── README.md
```

## Directory Purposes

**src/app:**
- Entry point for all pages and layouts
- Route groups `(app)` and `(auth)` control which layout applies
- Route parameters like `[loanId]` create dynamic routes

**src/actions:**
- Server Action functions that form the API boundary
- Each action validates session + permissions, calls service, returns { data } or { error }
- Named `*.actions.ts` for clarity

**src/services:**
- Pure business logic with no HTTP/React/auth awareness
- Each service is a `*.service.ts` file focused on one domain (loan, payment, etc.)
- Returns Effect<Success, ErrorTag> for type-safe error handling
- Always run mutation services inside transactions

**src/components:**
- UI components split by category (ui/, layout/, domain-specific like loans/, customers/)
- UI components are mostly dumb — take data + callbacks as props
- Layout components (AppShell, Sidebar, TopBar) control app chrome

**src/hooks:**
- Custom React hooks for querying and mutations
- Query hooks: fetch data and cache in React Query
- Mutation hooks: call actions and invalidate cache (rarely used, mostly inline)
- query-keys.ts: All React Query keys centralized

**src/lib/db:**
- Drizzle schema definitions (one file per entity/table)
- schema/index.ts exports all schema
- db instance (`db` object) in index.ts — import as `import { db } from "@/lib/db"`

**src/lib:**
- Config files (auth, logger, email)
- Utility functions (errors, permissions, formatting)
- Interest calculation engine
- Not for business logic — that lives in services/

**src/types/index.ts:**
- Single source of truth for all TypeScript definitions
- Entity types from Drizzle (Loan, Customer, Payment, etc.)
- Input DTOs (CreateLoanInput, RecordPaymentInput, etc.)
- API response shapes (ApiResponse<T>)
- Constants (ROLE_LEVELS, LoanStatus enum, etc.)

## Key File Locations

**Entry Points:**
- `src/app/page.tsx`: Root redirect to /dashboard
- `src/app/(app)/layout.tsx`: App shell (sidebar, top-bar, providers)
- `src/app/(auth)/layout.tsx`: Auth pages (no shell)
- `src/app/(app)/dashboard/page.tsx`: Main dashboard

**Configuration:**
- `src/lib/db/index.ts`: Drizzle instance + connection
- `src/lib/auth.ts`: Better Auth setup
- `src/lib/logger.ts`: Pino logger config
- `src/lib/errors.ts`: Error definitions

**Core Logic:**
- `src/services/loan.service.ts`: Loan CRUD + calculations
- `src/services/payment.service.ts`: Payment recording + interest accrual
- `src/services/watchlist.service.ts`: Overdue detection
- `src/lib/interest/engine.ts`: Interest formulas

**Testing:**
- `src/services/__tests__/*`: Unit tests for services
- `src/services/__integration__/*`: Database integration tests
- `src/hooks/__tests__/*`: Hook tests
- `cypress/e2e/*`: End-to-end tests

## Naming Conventions

**Files:**
- Directories: kebab-case (`src/app/(app)/loans/new/`)
- React components: PascalCase (`Sidebar.tsx`, `page.tsx`)
- Services: camelCase with .service suffix (`loan.service.ts`)
- Actions: camelCase with .actions suffix (`loan.actions.ts`)
- Hooks: camelCase with use prefix (`use-watchlist.ts`)
- Tests: match source file, add .test or .cy suffix (`loan.service.test.ts`, `loans.cy.ts`)

**Functions:**
- Server Actions: camelCase ending in "Action" (`createLoanAction`, `recordPaymentAction`)
- Service functions: camelCase, verb-first (`createLoan`, `recordPayment`, `listLoans`)
- Hooks: camelCase, starting with "use" (`useWatchlist`, `useDashboard`)
- React components: PascalCase (`export default function Dashboard() {}`)
- Utilities: camelCase (`formatCurrency`, `calculateDaysOverdue`)

**Variables:**
- Constants: UPPER_SNAKE_CASE (`ROLE_LEVELS`, `MIN_INTEREST_DAYS`)
- Local variables: camelCase (`loanId`, `interestRate`)
- Types/Interfaces: PascalCase (`Loan`, `CreateLoanInput`, `WatchlistEntry`)

**Directories:**
- Route groups: parentheses (`(app)`, `(auth)`)
- Dynamic segments: square brackets (`[loanId]`, `[id]`)
- Grouped features: kebab-case (`daily-collections`, `creditors`)
- Types of files: descriptive plural (`components`, `services`, `hooks`, `actions`)

## Where to Add New Code

**New Feature (e.g., "Add expense tracking"):**
- Service: `src/services/expense.service.ts` — export createExpense, deleteExpense, listExpenses
- Action: `src/app/(app)/expenses/actions.ts` — createExpenseAction, etc.
- Pages: `src/app/(app)/expenses/page.tsx` (list), `src/app/(app)/expenses/new/page.tsx` (form)
- Components: `src/components/expenses/` for domain-specific UI
- Types: Add ExpenseInput, Expense types to `src/types/index.ts`
- Hooks: `src/hooks/use-expenses.ts` if page-level query needed
- Tests: `src/services/__tests__/expense.service.test.ts` for unit tests

**New Component:**
- Shared UI: `src/components/ui/my-component.tsx`
- Domain-specific: `src/components/{feature}/my-component.tsx`
- Layout: `src/components/layout/my-component.tsx`

**New Utility Function:**
- General helpers: `src/lib/utils.ts`
- Domain-specific: create new file like `src/lib/calculations.ts` or `src/lib/validators.ts`

**New Page Route:**
- Protected page: Create under `src/app/(app)/{feature}/page.tsx`
- Auth page: Create under `src/app/(auth)/{feature}/page.tsx`
- Use layout.tsx in route group to control which AppShell applies

**New Database Schema:**
- Add table definition file: `src/lib/db/schema/{entity}.ts`
- Export table from `src/lib/db/schema/index.ts`
- Create migration: `drizzle push` generates SQL in `drizzle/` folder
- Add types to `src/types/index.ts` using InferSelectModel/InferInsertModel

**New API Route Handler:**
- System-level only (cron, webhooks, auth): `src/app/api/{category}/route.ts`
- Prefer Server Actions over API routes for normal CRUD

## Special Directories

**cypress/**
- Purpose: End-to-end tests using Cypress
- Generated: Videos and screenshots created on test runs
- Committed: Only .cy.ts spec files, support code; videos/screenshots in .gitignore

**drizzle/**
- Purpose: Database migrations
- Generated: SQL files auto-generated by `drizzle-kit generate`
- Committed: All SQL files and meta snapshot.json

**.planning/**
- Purpose: Planning and analysis documents
- Committed: All .md files — docs, milestones, phases
- Generated: None (manual or agent-created)

**logs/**
- Purpose: Runtime application logs (Pino writes here)
- Generated: Yes
- Committed: No (.gitignore)

**node_modules/, .next/**
- Purpose: Build artifacts and dependencies
- Generated: Yes
- Committed: No (.gitignore)

---

*Structure analysis: 2026-03-31*
