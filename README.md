# Money Lending Management System

A web-based platform for managing a lending business — covering customer loans, investor capital, daily interest calculations, business expenses, and financial reporting.

## Overview

This system enables a lending business to:

- Register customers and issue loans with daily interest on a reducing balance
- Collect repayments and generate printable receipts
- Track investor (creditor) capital and interest owed
- Monitor borrower risk with automatic watchlists and due-date alerts
- Record operational expenses and income
- Generate financial statements (P&L, Balance Sheet) and export reports

## Key Business Rules

| Rule | Detail |
|------|--------|
| Interest calculation | Daily on reducing balance |
| Default interest rate | 10% per month (admin-configurable) |
| Loan term | 30 days default |
| Payment allocation | Interest deducted first, remainder to principal |
| Minimum interest period | 30 days (even if repaid early) |
| Predictive alerts | 5 days before loan due date |
| Borrower watchlist | Auto-flagged when fewer than 30 days remain |

## Roles

| Role | Access |
|------|--------|
| Super Admin | Full system access and settings |
| Admin | Manage loans, customers, creditors, view reports |
| Loan Officer | Create loans, record payments, view customer data |
| Viewer | Read-only dashboard and reports |

## Delivery Phases

| Phase | Milestone | Hours |
|-------|-----------|-------|
| Phase 1 | Core loan operations — issue loans, collect payments, print receipts | 198 |
| Phase 2 | Monitoring — watchlists, alerts, repayment simulator | 96 |
| Phase 3 | Creditor management — investor capital & interest tracking | 62 |
| Phase 4 | Expenses & income tracking | 38 |
| Phase 5 | Dashboard, P&L, Balance Sheet, PDF/Excel exports | 62 |
| Phase 6 | QA & launch | 32 |
| **Total** | | **488** |

## Tech Stack

- **Frontend**: Next.js 16 (App Router) + React 19 + Tailwind CSS v4
- **Backend**: Next.js API Routes (Node.js)
- **Database**: PostgreSQL
- **Authentication**: Clerk (roles: Super Admin, Admin, Loan Officer, Viewer)
- **Scheduled Jobs**: Cron — daily interest calculation

## Getting Started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

## Out of Scope

Native mobile apps, SMS notifications, mobile money integrations, multi-currency support, offline mode, and automated debt collection.
