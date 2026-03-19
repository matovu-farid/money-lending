# Technology Stack

**Project:** Money Lending Management System
**Researched:** 2026-03-19
**Confidence:** MEDIUM — External verification tools (WebSearch, WebFetch, Context7) were blocked during research. All recommendations are based on training data through August 2025. Versions must be verified against npm before installation.

---

## Recommended Stack

### Core Framework (Already Decided)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Next.js | 16.2.0 | Full-stack framework (App Router) | Client requirement. App Router with React Server Components enables server-side loan calculations without client bundle cost. Route Handlers replace a separate API server. |
| React | 19.2.4 | UI rendering | Already installed. RSC model fits data-heavy financial dashboards. |
| TypeScript | ^5 | Type safety | Critical for financial domain — type-checked arithmetic prevents silent precision bugs. |
| Tailwind CSS | ^4 | Styling | Already installed. Utility-first fits complex table/dashboard layouts without custom CSS overhead. |
| PostgreSQL | (server) | Primary database | Client requirement. ACID transactions essential for payment processing — double-entry-style debit/credit must be atomic. |

---

### Database / ORM

**Recommendation: Drizzle ORM**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| drizzle-orm | ^0.30 | ORM / query builder | Type-safe SQL that stays close to SQL. No "magic" active record patterns that hide what queries run — critical for complex financial joins (loan + payments + interest ledger). Schema is just TypeScript, co-located with migrations. Lighter than Prisma with no Rust binary. |
| drizzle-kit | ^0.21 | Migration CLI | Companion tooling for schema migrations. |
| postgres | ^3 | PostgreSQL driver | `postgres` (the `postgres.js` package) is the recommended driver for Drizzle with Node.js. Faster than `pg` for most workloads. |

**Why not Prisma:** Prisma generates a Rust query engine binary (~50MB), which complicates deployment on constrained hosting. Its "magical" relation loading can obscure N+1 patterns in loan portfolio queries. Drizzle's explicit query API makes performance tuning transparent. The existing CONCERNS.md mentions Prisma — this recommendation deliberately overrides it based on the domain requirements.

**Confidence:** MEDIUM. Drizzle reached stable 1.0 milestone in late 2024. Verify current version on npm before installing.

---

### Validation

**Recommendation: Zod**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| zod | ^3.22 | Schema validation | The standard for TypeScript schema validation. Define once, reuse at API boundary and client form. Critical for financial inputs: loan amounts, interest rates, dates must be validated before touching the DB. `z.number().positive().multipleOf(0.01)` enforces monetary format. |

**Alternatives considered:**
- **Valibot:** Smaller bundle, compatible API, but smaller ecosystem. Not yet standard in Next.js projects.
- **Yup:** Older, weaker TypeScript inference. Do not use.

**Confidence:** HIGH. Zod v3 has been the undisputed standard since 2023.

---

### Decimal / Financial Arithmetic

**Recommendation: decimal.js**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| decimal.js | ^10.4 | Arbitrary-precision decimal arithmetic | JavaScript `number` (IEEE 754 float) cannot represent 0.1 + 0.2 correctly. For a lending system calculating daily interest on reducing balances, floating-point errors compound over months of daily calculations. `decimal.js` provides exact decimal arithmetic. |

**Usage pattern for this project:**
```
// Store all monetary values as integer cents in PostgreSQL (BIGINT)
// Use Decimal.js only in the calculation layer
// Convert back to cents before DB writes
const principal = new Decimal(loanAmountCents).div(100);
const dailyRate = new Decimal(annualRate).div(100).div(365);
const interest = principal.mul(dailyRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
```

**Alternative: big.js** — Smaller library, but `decimal.js` is a superset of `big.js` and handles more edge cases (NaN, Infinity, scientific notation). For a financial system, use `decimal.js`.

**Database storage:** Store all monetary columns as `BIGINT` (integer cents) in PostgreSQL, not `NUMERIC` or `FLOAT`. This eliminates a second class of precision bugs at the DB layer. `NUMERIC` is acceptable if the team prefers human-readable values, but requires consistent scale enforcement.

**Confidence:** HIGH. `decimal.js` v10 has been stable since 2021.

---

### Authentication

**Recommendation: Clerk**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @clerk/nextjs | ^6 | Auth, sessions, RBAC | Client requirement. Clerk's Next.js SDK integrates with App Router middleware for route protection. `clerkMiddleware()` in `middleware.ts` gates all financial routes. Webhook support for login activity tracking (required by PROJECT.md). |

**RBAC mapping:** Clerk supports custom `publicMetadata` on users. Map roles (Super Admin, Admin, Loan Officer, Viewer) to `publicMetadata.role`. Enforce in middleware and Server Components via `auth().sessionClaims`.

**Note:** Verify the current major version. Clerk releases breaking changes between major versions. As of training data, `@clerk/nextjs` v5/v6 added App Router-native APIs. Read the Clerk changelog before installing.

**Confidence:** MEDIUM — Clerk versions move fast. Verify current major version on clerk.com/docs before installing.

---

### Scheduling (Daily Interest Cron)

**Recommendation: External cron calling a Next.js Route Handler**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Native cron (server) or Vercel Cron | — | Trigger daily interest calculation | Next.js has no built-in cron scheduler. The recommended pattern is an external trigger calling a protected API route. |

**Approach:**

```
POST /api/cron/daily-interest
Headers: { Authorization: Bearer CRON_SECRET }
```

- The Route Handler validates `CRON_SECRET` before running calculations.
- On Linux hosting: `0 0 * * * curl -X POST https://app.example.com/api/cron/daily-interest -H "Authorization: Bearer $CRON_SECRET"`
- On Vercel: Native Cron Jobs via `vercel.json` `crons` config — no extra service needed.

**Why not node-cron / node-schedule:** These run in-process. Next.js Route Handlers run in serverless functions on Vercel (ephemeral) and may not have a persistent process on self-hosted deployments. An external HTTP trigger is portable across both.

**If self-hosting on a persistent Node server:** `node-cron` is acceptable. Add `^3.0` and run the scheduler in a standalone script, not inside Next.js.

**Confidence:** HIGH. This is the documented Next.js pattern for scheduled tasks.

---

### PDF Generation (Receipts and Reports)

**Recommendation: @react-pdf/renderer**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @react-pdf/renderer | ^3.4 | Generate loan disbursement receipts, repayment receipts, financial reports | React-based PDF generation runs on the server (Node.js) via Next.js Route Handlers. Define receipts as React components — same mental model as the rest of the app. Produces real PDF files (not browser print). |

**Usage pattern:**
```typescript
// app/api/receipts/[loanId]/route.ts
import { renderToBuffer } from '@react-pdf/renderer';
import { LoanReceipt } from '@/components/pdf/LoanReceipt';

export async function GET(req, { params }) {
  const loan = await getLoan(params.loanId);
  const buffer = await renderToBuffer(<LoanReceipt loan={loan} />);
  return new Response(buffer, {
    headers: { 'Content-Type': 'application/pdf' }
  });
}
```

**Alternative: Puppeteer** — Renders HTML to PDF via headless Chrome. Produces pixel-perfect PDFs matching the web UI. But: ~400MB binary, cold-start latency on serverless, memory-heavy. Too heavy for a VPS-hosted lending system generating routine receipts.

**Alternative: PDFKit** — Low-level, no React mental model. More verbose for templated documents.

**Confidence:** MEDIUM. `@react-pdf/renderer` v3 is stable and widely used. Verify it supports React 19 before installing — RSC compatibility may require testing.

---

### Excel Export

**Recommendation: ExcelJS**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| exceljs | ^4.4 | Export reports to .xlsx | Full-featured xlsx generation with formatting, cell styles, and multiple sheets. Suitable for Profit & Loss statements and loan portfolio reports that need formatted output (bold headers, currency formatting, merged cells for report structure). Runs in Node.js server-side. |

**Usage pattern:**
```typescript
// app/api/exports/loan-portfolio/route.ts
import ExcelJS from 'exceljs';

export async function GET() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Loan Portfolio');
  // ...add formatted rows
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  });
}
```

**Alternative: xlsx (SheetJS)** — Lighter, but the community edition has limited formatting support. The commercial edition (SheetJS Pro) has full formatting but requires a license. ExcelJS is open-source with full formatting.

**Confidence:** MEDIUM. ExcelJS v4 is stable. Verify current version on npm.

---

### Email Notifications

**Recommendation: Resend + react-email**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| resend | ^3.2 | Email delivery service | Resend is the standard choice for Next.js apps in 2025. Simple API, React-native template support, generous free tier. Required for: money-in/money-out alerts to admin, overdue loan notifications. |
| @react-email/components | ^0.0.x | Email templates | Build email templates as React components. Same DX as the rest of the app. Renders to HTML email-safe markup. |

**Usage pattern:**
```typescript
import { Resend } from 'resend';
import { PaymentNotificationEmail } from '@/emails/PaymentNotification';

const resend = new Resend(process.env.RESEND_API_KEY);

await resend.emails.send({
  from: 'alerts@yourlending.app',
  to: adminEmail,
  subject: 'Payment received',
  react: <PaymentNotificationEmail payment={payment} />,
});
```

**Alternative: Nodemailer + SMTP** — Works with any SMTP provider. More complex setup, no React template support. Use only if the client has an existing SMTP server requirement.

**Alternative: SendGrid** — Enterprise-grade, but overkill for this use case. Resend is simpler and more developer-friendly.

**Confidence:** MEDIUM. Resend has become the community standard for Next.js email since 2024. Verify current package versions.

---

### UI Components

**Recommendation: shadcn/ui (not a dependency — code-copied components)**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| shadcn/ui | latest CLI | Data tables, forms, dialogs, badges | shadcn/ui components are copied into the project (not installed as a package), making them fully customizable. Critical for this project: `<DataTable>` with sorting/filtering for loan lists, `<Dialog>` for payment entry, `<Badge>` for loan status indicators. Built on Radix UI + Tailwind. |
| @radix-ui/* | (installed by shadcn) | Accessible primitives | Installed as peer dependencies when adding shadcn components. |
| lucide-react | ^0.400 | Icons | shadcn/ui's default icon set. Consistent icon library for status indicators and action buttons. |

**Confidence:** HIGH. shadcn/ui is the dominant component system for Tailwind-based Next.js apps in 2025.

---

### Form Handling

**Recommendation: React Hook Form + Zod (via @hookform/resolvers)**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| react-hook-form | ^7.51 | Client-side form state | Uncontrolled form strategy minimizes re-renders. Important for loan application forms with many fields. |
| @hookform/resolvers | ^3.3 | Zod integration | Bridges RHF with Zod schema validation. Write validation once in Zod, use both server-side and in forms. |

**Confidence:** HIGH. This pairing is the standard for Next.js forms since 2023.

---

### Date Handling

**Recommendation: date-fns**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| date-fns | ^3.6 | Date arithmetic | Tree-shakeable, functional, TypeScript-first. Required for: calculating days elapsed since loan issuance, computing payment due dates, determining 30-day minimum interest periods. Never use `moment.js` (deprecated, large bundle). |

**Confidence:** HIGH. date-fns v3 is stable and the standard alternative to moment.js.

---

### Testing

**Recommendation: Vitest + React Testing Library + Playwright**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| vitest | ^1.6 | Unit/integration test runner | Jest-compatible API, faster, native ESM support. Critical: the loan calculation engine (daily interest, payment allocation, reducing balance) must have unit tests before shipping. The codebase CONCERNS.md flags this as critical. |
| @testing-library/react | ^15 | Component tests | Test UI interactions without DOM implementation details. |
| @testing-library/user-event | ^14 | Simulated user input | More realistic event simulation than `fireEvent`. |
| @vitejs/plugin-react | ^4 | Vitest React support | Required for JSX transformation in tests. |
| playwright | ^1.44 | End-to-end tests | Full loan lifecycle E2E tests (required by PROJECT.md). Tests the complete flow: register customer → issue loan → collect payment → verify balance. |

**Confidence:** HIGH. Vitest + RTL + Playwright is the standard 2025 testing stack for Next.js.

---

### Rate Limiting

**Recommendation: @upstash/ratelimit + Upstash Redis**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @upstash/ratelimit | ^1.2 | API route rate limiting | Protects financial API endpoints from abuse. Serverless-compatible (uses HTTP, not persistent connection). Upstash Redis has a free tier sufficient for this application's scale. |

**Alternative:** If the app is self-hosted on a persistent Node server, use `express-rate-limit` equivalent logic or implement simple in-memory rate limiting. Upstash is specifically for serverless/edge deployments.

**Confidence:** MEDIUM. Verify if hosting is Vercel (use Upstash) or self-hosted VPS (simpler in-memory solution may suffice given UAT scale of ~3 testers and small team).

---

## Alternatives Considered (Summary)

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| ORM | Drizzle ORM | Prisma | Prisma's Rust binary complicates deployment; implicit query patterns hide N+1 in complex loan queries |
| Validation | Zod | Valibot, Yup | Yup has weak TS inference; Valibot ecosystem smaller; Zod is the standard |
| Decimal math | decimal.js | big.js, native float | big.js is a subset; native float has precision errors that compound in daily interest loops |
| PDF | @react-pdf/renderer | Puppeteer | Puppeteer is 400MB+ and serverless-hostile |
| Excel | ExcelJS | SheetJS community | SheetJS OSS lacks cell formatting needed for financial report aesthetics |
| Email | Resend | Nodemailer, SendGrid | Nodemailer requires SMTP config; SendGrid is overbuilt; Resend is the Next.js default |
| Scheduling | External HTTP cron | node-cron | node-cron requires persistent process; conflicts with Vercel serverless model |
| Components | shadcn/ui | MUI, Chakra UI | MUI/Chakra add large bundle cost; shadcn is zero-runtime CSS (Tailwind), fully owned code |

---

## Installation

```bash
# ORM and database
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit

# Authentication
pnpm add @clerk/nextjs

# Validation
pnpm add zod

# Financial arithmetic
pnpm add decimal.js

# Form handling
pnpm add react-hook-form @hookform/resolvers

# Date utilities
pnpm add date-fns

# PDF generation
pnpm add @react-pdf/renderer

# Excel export
pnpm add exceljs

# Email
pnpm add resend @react-email/components

# UI components (shadcn/ui — initialize CLI, then add components as needed)
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add table button dialog badge form input select

# Rate limiting (if on Vercel/serverless)
pnpm add @upstash/ratelimit @upstash/redis

# Testing
pnpm add -D vitest @vitejs/plugin-react @testing-library/react @testing-library/user-event jsdom playwright
```

---

## Critical Version Verification Required

All versions below are from training data (cutoff August 2025). Verify before installing:

| Package | Training-data version | Verify at |
|---------|----------------------|-----------|
| drizzle-orm | ~0.30 | npmjs.com/package/drizzle-orm |
| @clerk/nextjs | ~6.x | clerk.com/docs/quickstarts/nextjs |
| @react-pdf/renderer | ~3.4 | npmjs.com/package/@react-pdf/renderer |
| exceljs | ~4.4 | npmjs.com/package/exceljs |
| resend | ~3.2 | npmjs.com/package/resend |
| zod | ~3.22 | npmjs.com/package/zod |
| decimal.js | ~10.4 | npmjs.com/package/decimal.js |

**React 19 compatibility check:** `@react-pdf/renderer` and `@react-email/components` must be verified for React 19 peer dependency compatibility before installation. Some packages in this ecosystem lagged React 19 support.

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| Core framework (Next.js, React, TS, Tailwind) | HIGH | Already installed, versions confirmed from package.json |
| ORM (Drizzle) | MEDIUM | Stable by Aug 2025 but exact current version unverified |
| Clerk auth | MEDIUM | Version moves fast; breaking changes between majors |
| Zod validation | HIGH | v3 stable and standard since 2023 |
| decimal.js | HIGH | v10 stable since 2021, financial use case is well-established |
| PDF (@react-pdf/renderer) | MEDIUM | React 19 compatibility unverified |
| Excel (ExcelJS) | MEDIUM | Stable library, exact version unverified |
| Email (Resend) | MEDIUM | Newer service, standard choice but version unverified |
| Scheduling pattern | HIGH | Documented Next.js pattern, not a library choice |
| shadcn/ui | HIGH | CLI-based, no version pinning needed |
| Testing (Vitest/Playwright) | HIGH | Standard stack, stable since 2024 |

---

## Sources

- `/Users/faridmatovu/projects/money-lending/.planning/PROJECT.md` — project requirements and constraints
- `/Users/faridmatovu/projects/money-lending/.planning/codebase/STACK.md` — existing installed packages
- `/Users/faridmatovu/projects/money-lending/.planning/codebase/CONCERNS.md` — identified gaps (ORM, validation, testing)
- `/Users/faridmatovu/projects/money-lending/.planning/codebase/ARCHITECTURE.md` — App Router pattern confirmed
- `/Users/faridmatovu/projects/money-lending/package.json` — installed package versions
- Training data (cutoff August 2025) — ecosystem knowledge for library comparisons
- NOTE: WebSearch, WebFetch, and Bash tools were denied during this research session. All ecosystem knowledge is from training data. Version verification against live npm is required.
