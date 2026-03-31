# Coding Conventions

**Analysis Date:** 2026-03-31

## Naming Patterns

**Files:**
- Services: `<domain>.service.ts` (e.g., `customer.service.ts`, `loan.service.ts`) in `src/services/`
- Actions: `<domain>.actions.ts` (e.g., `customer.actions.ts`) in `src/actions/`
- Hooks: `use-<feature>.ts` (e.g., `use-customers.ts`) in `src/hooks/`
- Components: PascalCase with file extensions (e.g., `Button.tsx`, `CustomerSearchBar.tsx`)
- Tests: `__tests__/` subdirectory or `__integration__/` subdirectory with `.test.ts` or `.test.tsx` suffix
- Pages: kebab-case directories with `page.tsx` entry point (Next.js convention)
- Types: Single index file `src/types/index.ts` containing all type definitions

**Functions:**
- camelCase for all function declarations
- Arrow functions preferred in declarations: `export const functionName = () => {}`
- Service functions return `Effect.Effect<T, E>` types from the Effect library
- Action functions (server actions) are async and return `{ data } | { error }` objects
- Custom Cypress helpers (e.g., `cy.registerAndLogin()`) defined in `cypress/support/e2e.ts`

**Variables:**
- camelCase for all variable names
- Constants in camelCase (not SCREAMING_SNAKE_CASE)
- State variables: `const [state, setState] = useState()`
- Refs with descriptive names: `const emailRef = useRef(null)`

**Types:**
- PascalCase for all type and interface names
- Domain-specific types grouped in single `src/types/index.ts`:
  - `Customer`, `CreateCustomerInput`, `UpdateCustomerInput`, `CustomerSearchParams`, `CustomerStatus`
  - `Loan`, `CreateLoanInput`, `UpdateLoanInput`, `LoanWithCustomer`
  - `Payment`, `CreatePaymentInput`
- Suffixes:
  - `Input` for function parameters/request types
  - `SearchParams` for filter/search query objects
  - `Status` for enum-like union types (e.g., `"active" | "blacklisted"`)
  - `WithCustomer`, `WithPayments` for relation types

## Code Style

**Formatting:**
- No explicit Prettier config found; project uses Next.js ESLint defaults
- Default formatter settings: semicolons, double quotes, single-line spacing
- 120-char line length (inferred from code samples)
- Indentation: 2 spaces

**Linting:**
- ESLint 9 with flat config: `eslint.config.mjs`
- Rules: `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- Enforces Next.js best practices and TypeScript strict mode
- Run: `pnpm lint` or `npm run lint`

**TypeScript Strictness:**
- `strict: true` in `tsconfig.json`
- All functions have explicit return types
- All parameters have explicit types
- Discriminated unions used for error handling
- `noEmit: true` prevents execution with type errors

## Import Organization

**Order:**
1. External libraries (`react`, `next`, etc.)
2. Effect library (`import { Effect } from "effect"`)
3. Internal paths (`@/lib/`, `@/services/`, `@/components/`, `@/hooks/`)
4. Type imports (`import type { ... }`)

**Example (from customer.service.ts):**
```typescript
import { Effect } from "effect"
import { db } from "@/lib/db"
import { customers } from "@/lib/db/schema/customers"
import { eq, ilike, inArray, and } from "drizzle-orm"
import { DatabaseError, CustomerNotFound } from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import type { CreateCustomerInput, Customer } from "@/types"
```

**Path Aliases:**
- `@/*` → `./src/*` (configured in `tsconfig.json`)
- All imports use absolute paths with `@/` prefix, no relative imports

## Error Handling

**Pattern:**
- Tagged discriminated union errors using Effect library's `Data.TaggedError`
- Error types defined in `src/lib/errors.ts`
- Service functions return `Effect.Effect<SuccessType, ErrorType>`

**Error Types:**
```typescript
export class DatabaseError extends Data.TaggedError("DatabaseError")<{ cause: unknown }> {}
export class CustomerNotFound extends Data.TaggedError("CustomerNotFound")<{ id: string }> {}
export class ValidationError extends Data.TaggedError("ValidationError")<{ message: string; field?: string }> {}
export class UnauthorizedError extends Data.TaggedError("UnauthorizedError")<{ reason: string }> {}
export class ForbiddenError extends Data.TaggedError("ForbiddenError")<{ action: string; role: string }> {}
```

**Effect.Effect Pattern:**
```typescript
export const getCustomer = (id: string): Effect.Effect<Customer, CustomerNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: () => db.select().from(customers).where(eq(customers.id, id)),
    catch: (e) => new DatabaseError({ cause: e }),
  }).pipe(
    Effect.flatMap((rows) =>
      rows[0]
        ? Effect.succeed(rows[0])
        : Effect.fail(new CustomerNotFound({ id }))
    )
  )
```

**Server Action Pattern:**
```typescript
export async function createCustomerAction(input: CreateCustomerInput) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  // Validation
  if (!input.fullName?.trim()) {
    return { error: "Full name is required" }
  }

  try {
    const data = await Effect.runPromise(createCustomer(input))
    revalidatePath("/customers")
    return { data }
  } catch (error) {
    if (error instanceof DatabaseError) {
      return { error: "Database error" }
    }
    return { error: "Internal server error" }
  }
}
```

## Logging

**Framework:** Pino logger available but not heavily used in observed code

**Patterns:**
- Console logging used minimally in codebase
- Pino configuration available in `package.json` (`pino`, `pino-pretty`)
- No centralized logging middleware observed in services
- Focus on Effect-based error handling over logging

## Comments

**When to Comment:**
- Complex formulas get detailed comments (e.g., interest calculation functions)
- Business logic that differs from conventional patterns (e.g., perpetual loans)
- Domain-specific terminology explained at function level

**Example (from interest engine):**
```typescript
/**
 * Calculates days overdue from unpaid interest and the current daily rate.
 * Formula: (totalInterestAccrued - totalInterestPaid) / currentDailyRate
 * Returns BigNumber(0) if unpaid interest is <= 0.
 * Used for the watchlist (RISK-01, RISK-02).
 */
export function calculateDaysOverdue(
  totalInterestAccrued: string,
  totalInterestPaid: string,
  currentDailyRate: string
): BigNumber
```

**JSDoc/TSDoc:**
- Function-level JSDoc comments for:
  - Complex business logic
  - Public API functions
  - Mathematical formulas
- No @param/@returns used; types are explicit in function signature
- Comments explain "why" not "what"

## Function Design

**Size:** Functions stay focused (30-60 lines typical for services)

**Parameters:**
- Single object parameter for functions with 2+ arguments
- Explicit destructuring in Effect definitions
- Server actions take domain input types (e.g., `CreateCustomerInput`)

**Return Values:**
- Service functions always return `Effect.Effect<T, E>`
- Action functions return `{ data: T } | { error: string }`
- Hooks return React Query hook result: `{ data, isLoading, error }`
- No implicit `undefined` returns; functions are explicit

**Example (service with multiple params):**
```typescript
export const searchCustomers = (params: CustomerSearchParams): Effect.Effect<...> =>
  // params is single object containing: name?, status?, page?, pageSize?, ...
```

## Module Design

**Exports:**
- Services export multiple named constants (functions): `export const functionName = (...) => {}`
- Actions export async functions: `export async function actionName(...) {}`
- Components export as default: `export default function ComponentName() {}`
- Hooks export named functions: `export function useHookName() {}`

**Barrel Files:**
- No barrel files observed
- Each directory has explicit imports from individual files
- Index files (`src/types/index.ts`) consolidate type definitions only

**Cross-Cutting Patterns:**

**Authorization:**
- Server actions check `auth.api.getSession({ headers: await headers() })`
- No unauthorized requests proceed further
- Role-based checks happen at handler level

**Data Revalidation:**
- Server actions call `revalidatePath(path)` after mutations
- Ensures Next.js cache invalidation for affected pages
- Single path per action

**Transaction Safety:**
- Integration tests use `db.execute(sql\`TRUNCATE...\`)` for reset
- Services use Drizzle ORM's built-in transaction support (observed in loan creation with collateral)
- No explicit transaction wrappers in single-operation functions

---

*Convention analysis: 2026-03-31*
