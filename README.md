# Money Lending Management System

A production web platform for running a money-lending business end to end: customer loans with daily reducing-balance interest, investor (creditor) capital tracking, expense and income ledgers, watchlists, and financial reporting (P&L, Balance Sheet).

## What it does

- **Loans.** Register customers, issue loans with daily interest on a reducing balance, and collect repayments with printable receipts.
- **Investors (creditors).** Track investor capital coming in, interest accrued, and payouts back.
- **Risk monitoring.** Auto-watchlists for borrowers nearing default, predictive alerts five days before due date.
- **Expense and income tracking.** Operational ledger with categorization.
- **Reporting.** Dashboard, P&L statement, Balance Sheet, and PDF / Excel exports.
- **Approvals workflow.** Sensitive actions (rate changes, fund transfers, large payments) go through a review-then-confirm step before posting.

## Business rules

| Rule | Detail |
| --- | --- |
| Interest calculation | Daily, on reducing balance |
| Default rate | 10% per month (admin-configurable) |
| Default loan term | 30 days |
| Payment allocation | Interest first, remainder to principal |
| Minimum interest period | 30 days (even if repaid early) |
| Predictive alert | 5 days before loan due date |
| Watchlist | Borrower auto-flagged when fewer than 30 days remain |

## Roles

| Role | Access |
| --- | --- |
| Super Admin | Full system access and settings |
| Admin | Manage loans, customers, creditors, view reports |
| Loan Officer | Create loans, record payments, view customer data |
| Viewer | Read-only dashboard and reports |

## Tech stack

- **Framework.** Next.js 16 (App Router, Turbopack) with React 19 and Tailwind CSS v4.
- **Database.** Postgres on Neon, schema and migrations with Drizzle ORM.
- **Sync layer.** TanStack DB collections with ElectricSQL for reactive, real-time UI state.
- **Auth.** Better Auth with role-based access control.
- **Money math.** BigNumber.js for exact decimal arithmetic, no floating-point loss.
- **Emails.** Resend with React Email templates.
- **Observability.** Sentry on both server and edge.
- **Testing.** Vitest unit and integration suites, Cypress E2E.
- **Design system.** Custom "Quantitative Minimalist" system documented in [`DESIGN.md`](./DESIGN.md): monochromatic surfaces, tabular Geist Mono for numbers, spatial separation instead of visible borders.

## Getting started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

To run the optional self-hosted Electric stack alongside dev:

```bash
pnpm dev:stack
```

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Run Next.js dev server with Turbopack |
| `pnpm build` | Production build, runs `drizzle-kit push` after |
| `pnpm test` | Vitest unit tests |
| `pnpm test:integration` | Vitest integration suite |
| `pnpm test:e2e` | Cypress E2E suite |
| `pnpm validate` | Typecheck plus unit and E2E tests |
| `pnpm db:studio` | Drizzle Studio for browsing data |

## Delivery phases

| Phase | Milestone | Hours |
| --- | --- | --- |
| 1 | Core loan operations: issue loans, collect payments, print receipts | 198 |
| 2 | Monitoring: watchlists, alerts, repayment simulator | 96 |
| 3 | Creditor management: investor capital and interest tracking | 62 |
| 4 | Expenses and income tracking | 38 |
| 5 | Dashboard, P&L, Balance Sheet, PDF / Excel exports | 62 |
| 6 | QA and launch | 32 |
| **Total** | | **488** |

## Status

Active. Phases 1 through 5 are implemented. Currently iterating on mobile responsiveness and printable receipt formatting.

## Out of scope

Native mobile apps, SMS notifications, mobile money integrations, multi-currency, offline mode, and automated debt collection.
