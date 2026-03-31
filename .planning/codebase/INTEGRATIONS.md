# External Integrations

**Analysis Date:** 2026-03-31

## APIs & External Services

**Email Delivery:**
- Resend - Transactional email service for account verification, password reset, and admin notifications
  - SDK: `resend` (v6.9.4)
  - Auth: `RESEND_API_KEY` environment variable
  - Implementation: `src/lib/email.ts` and `src/lib/auth.ts`
  - Templates: React components in `src/lib/emails/`
    - `verify-email.tsx` - Email verification during registration
    - `reset-password.tsx` - Password reset link
    - `admin-notification.tsx` - Payment and loan events
  - Usage: Called from Better Auth hooks (emailVerification, emailAndPassword)

## Data Storage

**Databases:**
- PostgreSQL - Primary relational database for all application data
  - Connection: `DATABASE_URL` environment variable (production) or `DATABASE_URL_TEST` (Cypress)
  - Driver: `postgres` (v3.4.8) - Native PostgreSQL client
  - ORM: Drizzle ORM (v0.45.1) with schema-first approach
  - Migration tool: Drizzle Kit (v0.31.10)
  - Schema location: `src/lib/db/schema/` - Tables: customers, loans, payments, transactions, audit_log, notifications, creditors, financial_snapshots, etc.
  - Connection pooling: Handled by postgres.js driver with max=1 in test mode

**Caching & Session Storage:**
- Browser localStorage - Persisted React Query cache via `@tanstack/query-sync-storage-persister`
  - Configured in `src/components/providers.tsx`
  - Max age: 24 hours
  - Stale time: 60 seconds
- HTTP cookies - Session tokens managed by Better Auth (server-side)
  - Cookie cache disabled to prevent stale sessions

**File Storage:**
- Client-side only (no cloud storage integration)
  - Excel export: Generated in-browser via ExcelJS and sent as download
  - PDF export: Generated in-browser via jsPDF and sent as download
  - No S3, GCS, or cloud file storage

## Authentication & Identity

**Auth Provider:**
- Better Auth (v1.5.5) - Open-source authentication library
  - Implementation: `src/lib/auth.ts`
  - Adapter: Drizzle adapter with PostgreSQL
  - Roles: superAdmin, admin, loanOfficer, unassigned
  - Default role: unassigned
  - Features:
    - Email/password authentication
    - Email verification (disabled in test mode)
    - Password reset via email
    - First-user auto-promotion to superAdmin (bootstrap mechanism)
    - Role-based access control plugin with Access Control List (ACL)
  - Session Management:
    - Cookie-based sessions
    - Cookie cache disabled for session freshness
    - Manual session invalidation on role changes
  - ACL: Defined in `src/lib/permissions` - controls which roles can perform which actions

**Email Verification:**
- Automated via Resend during registration (production)
- Test mode: URLs stored in-memory (`pendingVerifications` map) and retrieved via `/api/test/verification-url`

## Monitoring & Observability

**Error Tracking:**
- Not detected - Errors logged to console
- Sentry or similar APM not integrated

**Logs:**
- Console.log/console.warn - Application logging in services
  - Pino (v10.3.1) and pino-pretty (v13.1.3) installed but not actively used
  - Fallback: console methods used throughout services for debugging

**Database Auditing:**
- In-application audit logging via `src/services/audit.service.ts`
  - Captures user actions and data changes to `audit_log` table

## CI/CD & Deployment

**Hosting:**
- Not enforced - Framework supports:
  - Vercel (native Next.js platform) - Recommended
  - Self-hosted Node.js servers (via `npm start` which runs Next.js server)
  - Docker containers

**CI Pipeline:**
- Not detected - No GitHub Actions or CI config present
- Test scripts available:
  - `npm run test` - Vitest unit tests
  - `npm run test:integration` - Integration tests
  - `npm run test:e2e` - Cypress E2E tests

**External Cron Scheduling:**
- No scheduler integrated (no cloud function service)
- Cron endpoints provided for external schedulers:
  - `/api/cron/overdue` - Mark loans overdue (requires `CRON_SECRET` header)
  - `/api/cron/month-end` - Month-end financial snapshots and cleanup
- Implementation: Bare API routes with Bearer token authentication
- Expected to be called by external cron service (Vercel Cron, GitHub Actions, or third-party scheduler)

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - PostgreSQL connection string
  - Format: `postgresql://user:password@host:port/database`
  - Supports `search_path` URL parameter for schema isolation
- `BETTER_AUTH_SECRET` - Authentication secret (minimum 32 characters, generated randomly)
- `BETTER_AUTH_URL` - Auth callback URL for email links (http://localhost:3000 for dev, https://yourdomain.com for prod)
- `RESEND_API_KEY` - Resend email API key (format: re_xxxxx)
- `EMAIL_FROM` - Sender email address (RFC 5322 format, e.g., "Lending Manager <noreply@yourdomain.com>")
- `BUSINESS_TIMEZONE` - IANA timezone string (e.g., "Africa/Kampala" for Uganda)
- `CRON_SECRET` - Bearer token for cron endpoint authentication

**Optional env vars:**
- `DATABASE_URL_TEST` - Separate PostgreSQL database for Cypress tests (defaults to DATABASE_URL)
- `CYPRESS` - Set to "true" for test mode (handled in auth and db config)
- `NODE_ENV` - Set to "test" or "development" (influences auth behavior)

**Secrets location:**
- `.env` file (Git-ignored, not committed)
- Copy from `.env.example` for local development
- Production: Environment variables set directly in platform (Vercel, Node server, etc.)

## Webhooks & Callbacks

**Incoming:**
- `/api/cron/overdue` - External cron service to trigger overdue loan checks
- `/api/cron/month-end` - External cron service to trigger month-end financial snapshots
- Both require `Authorization: Bearer ${CRON_SECRET}` header

**Outgoing:**
- None detected - No outbound webhooks or callbacks to third-party services
- Email notifications sent to admins only (internal)

## Test-Specific Integrations

**Cypress Test Database:**
- Separate PostgreSQL instance via `DATABASE_URL_TEST`
- Connection: postgres.js with max=1 (single connection per test)
- Reset task: `cy.task("db:reset")` - Truncates all tables in order
- Utility tasks:
  - `db:getUserRole` - Query user role and verification status
  - `db:promoteUser` - Promote user to role and invalidate sessions
  - `db:promoteUserKeepSession` - Promote user without invalidating sessions
  - `db:getCustomers` - Query all customers for validation
  - `db:getLoans` - Query all loans for validation

**Mock Service Worker (MSW):**
- Installed but not actively used (handlers empty: `src/lib/msw/handlers.ts`)
- Available for future HTTP mocking in tests

**In-Memory Test Fixtures:**
- Pending verification URLs stored in `pendingVerifications` Map during test mode
- Retrieved via `/api/test/verification-url` endpoint to get email verification links

---

*Integration audit: 2026-03-31*
