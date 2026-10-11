import { describe, expect, it } from "vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import * as schema from "../index"

describe("financial correction agent-review schema", () => {
  it("defines a separate durable review table instead of a synthetic user", () => {
    const table = (schema as Record<string, unknown>).financialCorrectionAgentReviews
    expect(table).toBeDefined()
    const config = getTableConfig(table as Parameters<typeof getTableConfig>[0])
    expect(config.name).toBe("financial_correction_agent_reviews")
    expect(config.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "kind", "subject_id", "plan_hash", "input_fingerprint", "policy_version",
      "reviewer_agent_id", "review_run_id", "evidence_sha256", "verdict",
    ]))
    expect(config.columns.some((column) => column.name === "approved_by")).toBe(false)
  })

  it("allows new correction runs to name an agent without inventing a user", () => {
    for (const table of [schema.portfolioAccrualRepairRuns, schema.historicalRateRepairRuns]) {
      const columns = getTableConfig(table).columns
      expect(columns.find((column) => column.name === "agent_review_id")).toBeDefined()
      expect(columns.find((column) => column.name === "applied_by_agent")).toBeDefined()
    }
    const portfolio = getTableConfig(schema.portfolioAccrualRepairRuns).columns
    expect(portfolio.find((column) => column.name === "approved_by")?.notNull).toBe(false)
    expect(portfolio.find((column) => column.name === "applied_by")?.notNull).toBe(false)
    const rate = getTableConfig(schema.historicalRateRepairRuns).columns
    expect(rate.find((column) => column.name === "reviewed_by")?.notNull).toBe(false)
  })
})
