# Technology Stack

**Analysis Date:** 2026-03-31

## Languages

**Primary:**
- TypeScript 5.x - All source code, API routes, server actions, components, and utilities
- TSX - React components with JSX

**Secondary:**
- JavaScript (MJS) - ESLint and PostCSS configuration files

## Runtime

**Environment:**
- Node.js 22.16.0 - Specified in `package.json` pnpm config

**Package Manager:**
- pnpm - Monorepo and dependency management
- Lockfile: `pnpm-lock.yaml` (present)

## Frameworks

**Core:**
- Next.js 16.2.0 - Full-stack React framework with App Router
  - React Compiler enabled in `next.config.ts`
  - Server Actions for async backend calls without fetch ceremony
  - API Routes for webhooks and cron endpoints
  - App Router with layout nesting

**UI/Frontend:**
- React 19.2.4 - Component library and state management
- React DOM 19.2.4 - DOM rendering

**Data Management:**
- Drizzle ORM 0.45.1 - Type-safe SQL toolkit
  - Adapter: PostgreSQL (`postgres` driver)
  - Schema-first approach in `src/lib/db/schema/`
  - Database config: `drizzle.config.ts`

**Authentication:**
- Better Auth 1.5.5 - User authentication and role-based access control
  - Email/password auth with email verification
  - Admin plugin for role management
  - Session management with cookies
  - Database adapter: Drizzle adapter

**State Management:**
- Zustand 5.0.12 - Lightweight client-side state (app store in `src/lib/store.ts`)
- React Query (TanStack Query) 5.94.5 - Server state management
  - Persist client plugin for localStorage persistence
  - 24-hour cache with 60s stale time

**Form & Validation:**
- React Hook Form 7.72.0 - Form state and submission
- @zod/mini 4.0.0-beta.0 - Minimal schema validation (selected over full Zod)

**Styling:**
- Tailwind CSS 4 - Utility-first CSS framework
  - @tailwindcss/postcss 4 - PostCSS plugin
- shadcn 4.1.0 - Headless UI component library
- class-variance-authority 0.7.1 - Component styling variants
- Tailwind Merge 3.5.0 - Merge Tailwind class conflicts
- tw-animate-css 1.4.0 - Animation utilities

**UI Components:**
- Lucide React 0.577.0 - Icon library
- React Day Picker 9.14.0 - Calendar/date picker
- Base UI React 1.3.0 - Unstyled, accessible components

**Date/Time:**
- date-fns 4.1.0 - Date manipulation and formatting
- node-cron 4.2.1 - Cron job scheduling for server-side tasks

**PDF & Excel Export:**
- jspdf 4.2.1 - PDF generation client-side
- jspdf-autotable 5.0.7 - PDF table plugin
- ExcelJS 4.4.0 - Excel file generation

**Utilities:**
- bignumber.js 10.0.2 - Arbitrary precision decimal math (financial calculations)
- clsx 2.1.1 - Conditional className merging
- ts-pattern 5.9.0 - Pattern matching and exhaustive type checking
- Effect 3.21.0 - Functional error handling and composition

**Email:**
- Resend 6.9.4 - Email delivery service SDK
- @react-email/components 1.0.10 - React email template components

**Theming:**
- next-themes 0.4.6 - Dark mode/theme switching

**Database Connection:**
- postgres 3.4.8 - PostgreSQL client for Drizzle
- Drizzle Kit 0.31.10 - Database migration and schema management tool

## Testing

**Unit Testing:**
- Vitest 4.1.0 - Test runner and framework (Node environment)
  - Config: `vitest.config.ts`
  - Pattern: `src/**/*.test.ts` and `src/**/*.test.tsx`

**Integration Testing:**
- Vitest with integration config - `vitest.integration.config.ts`
  - Excludes unit tests from `src/services/__integration__/`
  - Used for database-dependent tests

**E2E Testing:**
- Cypress 15.12.0 - Browser automation and E2E tests
  - Config: `cypress.config.ts`
  - Spec pattern: `cypress/e2e/**/*.cy.ts`
  - Support file: `cypress/support/e2e.ts`
  - Base URL: `http://localhost:3000`
  - Tasks: Database reset, user role promotion, data queries

**Testing Utilities:**
- @testing-library/react 16.3.2 - React component testing
- @testing-library/user-event 14.6.1 - User event simulation
- MSW (Mock Service Worker) 2.12.14 - HTTP mocking for tests
  - Handlers: `src/lib/msw/handlers.ts`
  - Server: `src/lib/msw/server.ts`

## Build & Dev Tools

**Linting:**
- ESLint 9 - JavaScript/TypeScript linting
  - Config: `eslint.config.mjs`
  - Preset: eslint-config-next (Core Web Vitals + TypeScript)

**Compilation:**
- TSX 4.21.0 - TypeScript runner for direct execution
- Babel React Compiler 1.0.0 - Automatic React memo optimization

**Build System:**
- PostCSS 4 - CSS processing (via Tailwind CSS integration)
  - Config: `postcss.config.mjs`

## Configuration

**Environment:**
- dotenv 17.3.1 - Load `.env` files
- Environment precedence: `DATABASE_URL_TEST` (Cypress) → `DATABASE_URL` (production)

**Key configs required:**
- `DATABASE_URL` - PostgreSQL connection string (required for migrations and production)
- `BETTER_AUTH_SECRET` - Authentication secret (min 32 chars)
- `BETTER_AUTH_URL` - Auth callback URL (http://localhost:3000 for dev)
- `BUSINESS_TIMEZONE` - User-facing timezone (e.g., "Africa/Kampala")
- `RESEND_API_KEY` - Resend email service API key
- `EMAIL_FROM` - Sender email address (RFC 5322 format)
- `CRON_SECRET` - Bearer token for cron endpoint authentication
- `DATABASE_URL_TEST` - Separate PostgreSQL database for Cypress tests (optional, defaults to DATABASE_URL)

**TypeScript:**
- Config: `tsconfig.json`
- Target: ES2017
- Module: ESNext
- Strict mode enabled
- Path alias: `@/*` → `./src/*`

## Platform Requirements

**Development:**
- Node.js 22.16.0 (specified in package.json pnpm config)
- PostgreSQL database with search_path support
- Environment file: `.env` (copy from `.env.example`)

**Production:**
- Node.js 22.16.0+
- PostgreSQL 13+
- Email service: Resend account with valid API key
- Optional: External cron service (e.g., Vercel Cron) for `/api/cron/*` routes
- Next.js deployment target: Vercel or self-hosted Node.js server

---

*Stack analysis: 2026-03-31*
