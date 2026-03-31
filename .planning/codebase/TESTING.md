# Testing Patterns

**Analysis Date:** 2026-03-31

## Test Framework

**Runner:**
- Vitest v4.1.0
- Config: `vitest.config.ts` for unit/mock tests
- Config: `vitest.integration.config.ts` for integration tests (database)
- Cypress v15.12.0 for E2E tests

**Assertion Library:**
- Vitest includes expect() built-in
- No external assertion library needed

**Run Commands:**
```bash
npm run test                    # Run all unit tests (vitest run)
npm run test:watch             # Watch mode for development (vitest)
npm run test:integration       # Run integration tests with real DB (vitest --config vitest.integration.config.ts)
npm run test:e2e               # Run Cypress E2E tests (cypress run)
npm run test:e2e:open          # Open Cypress interactive mode (cypress open)
npm run cypress:run            # Alias for test:e2e
npm run cypress:open           # Alias for test:e2e:open
```

## Test File Organization

**Location Patterns:**

**Unit/Mock Tests (no database):**
- Co-located with source: `src/services/__tests__/service.test.ts`
- Also: `src/lib/__tests__/`, `src/hooks/__tests__/`
- Excluded from integration config: `vitest.config.ts` excludes `src/services/__integration__/**`
- Examples: `src/services/__tests__/customer.service.test.ts`, `src/lib/__tests__/errors.test.ts`

**Integration Tests (real database):**
- Separate directory: `src/services/__integration__/service.test.ts`
- Uses setup file: `src/services/__integration__/setup.ts` (configured in `vitest.integration.config.ts`)
- Runs sequentially (not in parallel): `sequence: { concurrent: false }` and `fileParallelism: false`
- Increased timeout: `testTimeout: 30_000`
- Examples: `src/services/__integration__/customer.service.test.ts`, `src/services/__integration__/loan.service.test.ts`

**E2E Tests (browser automation):**
- Location: `cypress/e2e/**/*.cy.ts`
- Spec pattern: `cypress/e2e/**/*.cy.ts` (configured in `cypress.config.ts`)
- Examples: `cypress/e2e/customer-crud.cy.ts`, `cypress/e2e/loans-list.cy.ts`, `cypress/e2e/admin-panel.cy.ts`

**Test Data/Fixtures:**
- Setup file: `src/services/__integration__/setup.ts` exports `resetDb()` and `seedCategories()`
- No factory library used; test data created inline within tests
- Example from `customer.service.test.ts`:
```typescript
const mockCustomer = {
  id: "cust-1",
  fullName: "John Doe",
  contact: "0771234567",
  address: "Kampala, Uganda",
  status: "active",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
}
```

## Test Structure

**Unit Test Suite Organization:**
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect, Exit } from "effect"

vi.mock("@/lib/db", () => {
  const mockDb = { select: vi.fn(), insert: vi.fn() }
  return { db: mockDb }
})

describe("Customer Service", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("description of what it tests", async () => {
    // Arrange
    const { db } = await import("@/lib/db")
    const { createCustomer } = await import("@/services/customer.service")
    const mockedDb = vi.mocked(db)

    // Act
    const result = await Effect.runPromise(createCustomer(input))

    // Assert
    expect(result).toEqual(expectedValue)
    expect(mockedDb.insert).toHaveBeenCalledTimes(1)
  })
})
```

**Integration Test Suite Organization:**
```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Exit, Cause } from "effect"
import { resetDb, testDb } from "./setup"
import { createCustomer, getCustomer } from "@/services/customer.service"

const TEST_TIMEOUT = 30_000

describe("Customer Service (integration)", () => {
  beforeEach(async () => {
    await resetDb()  // Truncates all tables
  }, TEST_TIMEOUT)

  // ── 1. createCustomer ────────────────────────────────────────────────
  it("inserts a real customer and returns all fields", async () => {
    const customer = await Effect.runPromise(
      createCustomer({
        fullName: "Alice Nakato",
        contact: "0771000001",
        address: "Kampala, Uganda",
      })
    )

    expect(customer.id).toBeDefined()
    expect(customer.fullName).toBe("Alice Nakato")
  }, TEST_TIMEOUT)
})
```

**E2E Test Suite Organization:**
```typescript
describe("Customer CRUD", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Admin User" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  describe("Customer List", () => {
    it("shows empty state when no customers exist", () => {
      cy.visit("/customers")
      cy.contains("No customers yet")
      cy.contains("Register").should("be.visible")
    })
  })

  describe("Customer Registration", () => {
    it("registers a customer and redirects to profile", () => {
      cy.visit("/customers/new")
      cy.get("#fullName").type("John Doe")
      cy.contains("button", "Register Customer").click()
      cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)
    })
  })
})
```

## Mocking

**Framework:** Vitest's vi object (`vi.mock`, `vi.mocked`, `vi.resetAllMocks`)

**Patterns:**

**Mocking Databases:**
```typescript
vi.mock("@/lib/db", () => {
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  }
  return { db: mockDb }
})
```

**Mocking Services:**
```typescript
vi.mock("@/services/audit.service", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}))
```

**Using Mocked Database in Tests:**
```typescript
const { db } = await import("@/lib/db")
const mockedDb = vi.mocked(db)

mockedDb.insert.mockReturnValue({
  values: vi.fn().mockReturnValue({
    returning: vi.fn().mockResolvedValue([mockCustomer]),
  }),
} as any)
```

**Effect-Based Mocking:**
When testing Effect-returning functions, use `Effect.runPromiseExit()` to access errors:
```typescript
const exit = await Effect.runPromiseExit(getCustomer("nonexistent"))

expect(Exit.isFailure(exit)).toBe(true)

if (Exit.isFailure(exit)) {
  const error = Cause.failureOption(exit.cause)
  expect(error._tag).toBe("Some")
  if (error._tag === "Some") {
    expect(error.value).toBeInstanceOf(CustomerNotFound)
  }
}
```

**What to Mock:**
- Database (`@/lib/db`) in unit tests
- External services (audit, notifications) in unit tests
- No mocking in integration tests (use real database)
- No mocking in E2E tests (use real browser/app)

**What NOT to Mock:**
- The Effect library itself (import actual from "effect")
- Type definitions
- Pure utility functions (interest calculations)
- Business logic you're testing

## Fixtures and Factories

**Test Data Pattern:**
Test data defined inline, no factory library used.

**Inline Test Data:**
```typescript
const mockCustomer = {
  id: "cust-1",
  fullName: "John Doe",
  contact: "0771234567",
  address: "Kampala, Uganda",
  status: "active",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
}
```

**Setup File (`src/services/__integration__/setup.ts`):**
```typescript
export const testDb = db  // Re-export shared connection

export async function resetDb() {
  await db.execute(sql`
    TRUNCATE TABLE transactions, loans, customers, ... CASCADE
  `)
}

export async function seedCategories() {
  await db.insert(schema.transactionCategories).values([
    { name: "Interest Earned", type: "income", isDefault: true },
    { name: "Interest Payments", type: "expense", isDefault: true },
  ])
}
```

**Location:**
- `src/services/__integration__/setup.ts` - Database reset/seeding
- No separate fixtures directory
- Test data created inline within each test case

## Coverage

**Requirements:** Not enforced (no coverage threshold in config)

**View Coverage:**
```bash
npm run test -- --coverage
```

**Coverage Config:** Not configured in `vitest.config.ts`

## Test Types

**Unit Tests:**
- **Scope:** Service functions with mocked dependencies
- **Approach:** Mock database, test pure function logic, error handling
- **Location:** `src/services/__tests__/` and `src/lib/__tests__/`
- **Example:** Testing that `createCustomer` calls `db.insert()` with correct values
- **Error Testing:** Use `Effect.runPromiseExit()` to capture and verify error types

**Integration Tests:**
- **Scope:** Service functions with real database
- **Approach:** Reset database between tests, verify actual data persistence, test audit logs
- **Location:** `src/services/__integration__/`
- **Setup:** Each test file calls `resetDb()` in `beforeEach()`
- **Sequencing:** Disabled parallel execution (`sequence: { concurrent: false }`)
- **Example:** Verify `createCustomer` + `searchCustomers` + audit log creation
- **Timeout:** 30 seconds per test (real DB operations slower)

**E2E Tests:**
- **Scope:** Full browser workflows, authentication, forms, navigation
- **Approach:** Use Cypress commands, custom helpers (`cy.registerAndLogin`, `cy.task("db:reset")`)
- **Location:** `cypress/e2e/`
- **Database Reset:** Each test calls `cy.task("db:reset")` in `beforeEach()`
- **Custom Tasks:** Defined in `cypress.config.ts`:
  - `db:reset` - Truncate all tables
  - `db:getUserRole(email)` - Query user and role
  - `db:promoteUser(email, role)` - Update user role (invalidates sessions)
  - `db:promoteUserKeepSession(email, role)` - Update role without session invalidation
  - `db:getCustomers()` - Query all customers
  - `db:getLoans()` - Query all loans

## Common Patterns

**Async Testing (Vitest + Effect):**
```typescript
it("creates a customer asynchronously", async () => {
  const customer = await Effect.runPromise(
    createCustomer({ fullName: "Test", contact: "077...", address: "..." })
  )
  expect(customer.id).toBeDefined()
})
```

**Error Testing (Effect + Exit):**
```typescript
it("returns CustomerNotFound for invalid ID", async () => {
  const exit = await Effect.runPromiseExit(getCustomer("fake-id"))

  expect(Exit.isFailure(exit)).toBe(true)

  if (Exit.isFailure(exit)) {
    const error = Cause.failureOption(exit.cause)
    if (error._tag === "Some") {
      expect(error.value).toBeInstanceOf(CustomerNotFound)
    }
  }
})
```

**Cypress Form Testing:**
```typescript
it("registers a customer and redirects to profile", () => {
  cy.visit("/customers/new")
  cy.get("#fullName").type("John Doe")
  cy.get("#contact").type("0771234567")
  cy.get("#address").type("Kampala, Uganda")
  cy.contains("button", "Register Customer").click()
  cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)
  cy.contains("John Doe")  // Verify success
})
```

**Cypress Validation Testing:**
```typescript
it("shows validation errors for empty fields", () => {
  cy.visit("/customers/new")
  cy.contains("button", "Register Customer").click()
  cy.contains("Full name is required")
  cy.contains("Contact is required")
  cy.contains("Address is required")
})
```

**Cypress Database Task Usage:**
```typescript
it("shows role in user list after promotion", () => {
  cy.task("db:promoteUser", { email: "user@example.com", role: "loan_officer" })
  cy.visit("/admin")
  cy.contains("tr", "user@example.com").should("contain.text", "Loan Officer")
})
```

**Vitest Reset Pattern:**
```typescript
beforeEach(() => {
  vi.resetAllMocks()  // Clear all mocks between tests
})
```

**Integration Test Timeout:**
```typescript
const TEST_TIMEOUT = 30_000

it("slow database operation", async () => {
  // ...
}, TEST_TIMEOUT)
```

---

*Testing analysis: 2026-03-31*
