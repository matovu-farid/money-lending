import { describe, it, expect } from "vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import { customers } from "../customers"

describe("customers schema", () => {
  it("has a unique constraint on nin to prevent duplicate national IDs", () => {
    const config = getTableConfig(customers)
    const match = config.uniqueConstraints.find((c) => {
      const colNames = c.columns.map((col) => col.name)
      return colNames.includes("nin")
    })
    expect(match).toBeDefined()
    expect(match!.name).toBe("uq_customers_nin")
  })
})
