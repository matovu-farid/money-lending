import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { getTableConfig } from "drizzle-orm/pg-core"
import * as schema from "../index"

describe("payment allocation repair run schema", () => {
  it("stores an exact plan and agent-only provenance without a synthetic user", () => {
    const table = (schema as Record<string, unknown>).paymentAllocationRepairRuns
    expect(table).toBeDefined()
    const config = getTableConfig(table as Parameters<typeof getTableConfig>[0])
    expect(config.name).toBe("payment_allocation_repair_runs")
    expect(config.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "id", "loan_id", "plan_hash", "input_fingerprint", "policy_version",
      "agent_review_id", "applied_by_agent", "backup_sha256", "before_summary",
      "after_summary", "applied_at",
    ]))
    expect(config.columns.some((column) => column.name === "approved_by" ||
      column.name === "reviewed_by")).toBe(false)
    expect(config.uniqueConstraints.some((constraint) =>
      constraint.name === "uq_payment_allocation_repair_plan_hash")).toBe(true)
    const migration = readFileSync(resolve("drizzle/0036_white_anthem.sql"), "utf8")
    expect(migration).toContain('CREATE TABLE "payment_allocation_repair_runs"')
    expect(migration).toContain('"agent_review_id" uuid NOT NULL')
    expect(migration).toContain('CONSTRAINT "payment_allocation_repair_attribution" CHECK')
  })
})
