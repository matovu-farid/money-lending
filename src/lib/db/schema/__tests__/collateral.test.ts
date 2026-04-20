import { describe, it, expect } from "vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import { collateral } from "../collateral"

describe("collateral schema", () => {
  it("has an index on loanId for fast lookups by loan", () => {
    const config = getTableConfig(collateral)
    const match = config.indexes.find((idx) => {
      const colNames = idx.config.columns
        .map((c) => ("name" in c ? c.name : ""))
      return colNames.includes("loan_id")
    })
    expect(match).toBeDefined()
    expect(match!.config.name).toBe("idx_collateral_loan_id")
  })
})
