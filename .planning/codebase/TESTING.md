# Testing

**Analysis Date:** 2026-03-19

## Current State

**No testing infrastructure exists.** This is a fresh scaffold with zero test files, no test framework configured, and no test scripts in `package.json`.

```json
// package.json scripts (current)
{
  "dev": "next dev --turbopack",
  "build": "next build",
  "start": "next start",
  "lint": "next lint"
  // No "test" script
}
```

## Recommended Framework

**Vitest** — preferred for Next.js App Router projects (fast, ESM-native, TypeScript-first)

**React Testing Library** — for component testing

**Playwright** — for end-to-end testing

## Recommended Structure (to be created)

```
src/
├── __tests__/              # Unit and integration tests
│   ├── services/           # Business logic tests
│   │   ├── loan.test.ts
│   │   ├── payment.test.ts
│   │   └── interest.test.ts
│   ├── api/               # API route tests
│   └── components/        # Component tests
├── e2e/                    # Playwright E2E tests
│   ├── loans.spec.ts
│   └── payments.spec.ts
```

## Test Types Needed

| Type | Tool | Priority | Coverage Target |
|------|------|----------|----------------|
| Unit | Vitest | High | Business logic (loan calc, interest, payment) |
| Integration | Vitest + test DB | High | API routes |
| Component | React Testing Library | Medium | Critical UI flows |
| E2E | Playwright | Medium | Core user journeys |

## Critical Test Areas (money-lending domain)

**Must test:**
- Interest calculation accuracy (financial correctness critical)
- Loan issuance validation
- Payment allocation logic
- Balance computation
- Date-based accrual calculations

**High value:**
- API route authentication/authorization
- Input validation and error handling
- Role-based access control

## Mocking Strategy (planned)

- **Database:** Use test database instance or in-memory SQLite
- **External APIs:** `vi.mock()` for third-party services
- **Auth:** Mock session/JWT for protected route tests
- **Date/Time:** `vi.useFakeTimers()` for interest accrual tests

## Setup Required

To add testing:
```bash
pnpm add -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom
pnpm add -D playwright
```

Add to `package.json`:
```json
{
  "scripts": {
    "test": "vitest",
    "test:e2e": "playwright test"
  }
}
```

---

*Testing analysis: 2026-03-19*
