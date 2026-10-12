import { afterEach, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"

const { queries, mockEnd } = vi.hoisted(() => ({
  queries: [] as string[],
  mockEnd: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("postgres", () => ({ default: vi.fn(() => ({ end: mockEnd })) }))
vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: () => ({
    transaction: async (run: (tx: { execute: (query: unknown) => Promise<unknown[]> }) => Promise<unknown>) =>
      run({
        execute: async (query) => {
          const statement = new PgDialect().sqlToQuery(query as Parameters<PgDialect["sqlToQuery"]>[0]).sql
          queries.push(statement)
          if (statement.includes("current_database()")) return [{ name: "money_lending_inventory_test" }]
          if (statement.includes("COUNT(*)::integer")) return [{ count: 0 }]
          return []
        },
      }),
  }),
}))

const originalArgv = process.argv
const originalUrl = process.env.DATABASE_URL

afterEach(() => {
  process.argv = originalArgv
  if (originalUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = originalUrl
  vi.restoreAllMocks()
  queries.length = 0
  mockEnd.mockClear()
})

it("includes agent corrections in both inventory rows and orphan counts without writing", async () => {
  process.argv = ["node", "rate-correction-inventory.ts",
    "--expect-host=localhost", "--expect-database=money_lending_inventory_test"]
  process.env.DATABASE_URL = "postgres://test:test@localhost/money_lending_inventory_test"
  const output = vi.spyOn(console, "log").mockImplementation(() => undefined)

  vi.resetModules()
  await import("../../../../scripts/rate-correction-inventory")
  await vi.waitFor(() => expect(output).toHaveBeenCalledOnce())

  const inventoryQueries = queries.filter((query) => query.includes("FROM audit_log a"))
  expect(inventoryQueries).toHaveLength(2)
  expect(inventoryQueries.every((query) => query.includes("historical_rate_corrected_by_agent"))).toBe(true)
  expect(queries[0]).toContain("SET TRANSACTION READ ONLY")
  expect(mockEnd).toHaveBeenCalledOnce()
})
