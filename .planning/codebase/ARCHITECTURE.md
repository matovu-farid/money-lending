# Architecture

**Analysis Date:** 2026-03-19

## Pattern

**Type:** Next.js App Router (full-stack)
**Style:** Greenfield — minimal application code, default scaffold only

This is a freshly scaffolded Next.js 16 application using the App Router. No application-specific architecture has been built yet — the codebase is the standard `create-next-app` output with a single page and root layout.

## Layers

```
┌─────────────────────────────────────────┐
│           Presentation Layer            │
│   src/app/ (React Server Components)    │
│   page.tsx, layout.tsx                  │
├─────────────────────────────────────────┤
│           API Layer (planned)           │
│   src/app/api/ (Next.js Route Handlers) │
├─────────────────────────────────────────┤
│        Data Access Layer (planned)      │
│   Database client, ORM models           │
├─────────────────────────────────────────┤
│      Business Logic Layer (planned)     │
│   Loan, payment, interest calculations  │
└─────────────────────────────────────────┘
```

## Entry Points

- **Web:** `src/app/layout.tsx` — Root HTML shell, fonts, global styles
- **Home page:** `src/app/page.tsx` — Default scaffold placeholder page
- **API routes (planned):** `src/app/api/*/route.ts`

## Data Flow (current state)

No real data flow exists yet. The placeholder page renders statically with no data fetching.

**Planned flows (based on project domain — money lending):**
1. Loan issuance → create loan record → calculate schedule
2. Payment processing → record payment → update balance
3. Interest calculation → daily/periodic accrual → ledger update
4. Reporting → aggregate queries → dashboard display

## Abstractions

**Current:**
- `RootLayout` — wraps all pages with HTML shell, font variables, global CSS
- `Home` — placeholder page component (to be replaced)

**Planned:**
- Loan entity model
- Payment entity model
- Investor/Creditor entity model
- Interest calculation service

## Rendering Strategy

- **Default:** React Server Components (Next.js App Router default)
- **Client components:** Use `"use client"` directive when interactivity needed
- **Static/dynamic:** Next.js determines per-route based on data access patterns

## Cross-Cutting Concerns

- **Fonts:** Geist Sans + Geist Mono loaded via `next/font/google`
- **Styling:** Tailwind CSS v4 utility classes, dark mode via `dark:` prefix
- **Types:** TypeScript strict mode via `tsconfig.json`
- **Linting:** ESLint with Next.js core web vitals rules

---

*Architecture analysis: 2026-03-19*
