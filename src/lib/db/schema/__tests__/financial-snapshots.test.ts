import { describe, it, expect } from "vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import { financialSnapshots } from "../financial-snapshots"

describe("financialSnapshots schema", () => {
  it("has a unique constraint on (type, periodStart) to prevent duplicate snapshots", () => {
    const config = getTableConfig(financialSnapshots)
    const uq = config.uniqueConstraints

    // There must be at least one unique constraint
    expect(uq.length).toBeGreaterThanOrEqual(1)

    // Find the constraint covering type + periodStart
    const match = uq.find((c) => {
      const colNames = c.columns.map((col) => col.name)
      return colNames.includes("type") && colNames.includes("period_start")
    })

    expect(match).toBeDefined()
    expect(match!.name).toBe("uq_snapshots_type_period")
  })
})
