import { describe, it, expect } from "vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import { creditorInvestments } from "../creditor-investments"

describe("creditorInvestments schema", () => {
  it("has an index on creditorId for fast lookups by creditor", () => {
    const config = getTableConfig(creditorInvestments)
    const match = config.indexes.find((idx) => {
      const colNames = idx.config.columns
        .map((c) => ("name" in c ? c.name : ""))
      return colNames.includes("creditor_id")
    })
    expect(match).toBeDefined()
    expect(match!.config.name).toBe("idx_creditor_investments_creditor_id")
  })
})
