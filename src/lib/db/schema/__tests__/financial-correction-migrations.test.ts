import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { readMigrationFiles } from "drizzle-orm/migrator"
import { describe, expect, it } from "vitest"

const migrationsFolder = resolve("drizzle")
const readMigration = (name: string) => readFileSync(resolve(migrationsFolder, name), "utf8")
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

describe("financial correction migration history", () => {
  it("preserves the committed 0034 SQL and snapshot byte for byte", () => {
    expect(sha256(readMigration("0034_silky_amphibian.sql")))
      .toBe("d8ce73c53675c828429eab895ad755535bf71ecea258ff4f9ac89b07513c052b")
    expect(sha256(readMigration("meta/0034_snapshot.json")))
      .toBe("14ff72682a89e9f726bdc50fe384e2cd1a28dbfe5b35cba077911be968d58797")
  })

  it("keeps 0034's journal identity and advances 0035 after it", () => {
    const journal = JSON.parse(readMigration("meta/_journal.json")) as {
      entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[]
    }
    expect(journal.entries.find((entry) => entry.idx === 34)).toEqual({
      idx: 34, version: "7", when: 1791728541961,
      tag: "0034_silky_amphibian", breakpoints: true,
    })
    const next = journal.entries.find((entry) => entry.idx === 35)
    expect(next?.tag).toBe("0035_natural_supernaut")
    expect(next!.when).toBeGreaterThan(1791728541961)
    const migrations = readMigrationFiles({ migrationsFolder })
    expect(migrations).toHaveLength(journal.entries.length)
    expect(migrations[34].hash).toBe("d8ce73c53675c828429eab895ad755535bf71ecea258ff4f9ac89b07513c052b")
    expect(migrations[34].folderMillis).toBe(1791728541961)
    expect(migrations[35].folderMillis).toBe(next!.when)

    const oldSnapshot = JSON.parse(readMigration("meta/0034_snapshot.json")) as { id: string }
    const newSnapshot = JSON.parse(readMigration("meta/0035_snapshot.json")) as { prevId: string }
    expect(newSnapshot.prevId).toBe(oldSnapshot.id)
  })

  it("moves review consumption, attempt uniqueness, and attribution hardening into 0035", () => {
    const sql = readMigration("0035_natural_supernaut.sql")
    expect(sql).toContain('ADD COLUMN "consumed_at" timestamp with time zone')
    expect(sql).toContain('ADD COLUMN "consumed_by_run_id" uuid')
    expect(sql).toContain('DROP CONSTRAINT "uq_financial_correction_agent_review_plan"')
    expect(sql).toContain('ADD CONSTRAINT "uq_financial_correction_agent_review_attempt" UNIQUE("kind","plan_hash","review_run_id")')
    expect(sql).toContain('ADD CONSTRAINT "financial_correction_agent_review_consumption" CHECK')
    for (const name of ["historical_rate_run_attribution", "portfolio_accrual_run_attribution"]) {
      expect(sql).toContain(`DROP CONSTRAINT "${name}"`)
      const check = sql.match(new RegExp(`ADD CONSTRAINT "${name}" CHECK \\([\\s\\S]*?\\);`))?.[0]
      expect(check).toMatch(/"applied_by_agent" IS NOT NULL/)
    }
    expect(sql).toContain('ALTER TABLE "rollover_correction_runs" ADD COLUMN "agent_review_id" uuid')
  })

  it("records the forward schema changes in the 0035 snapshot", () => {
    const oldSnapshot = JSON.parse(readMigration("meta/0034_snapshot.json"))
    const newSnapshot = JSON.parse(readMigration("meta/0035_snapshot.json"))
    const oldReviews = oldSnapshot.tables["public.financial_correction_agent_reviews"]
    const newReviews = newSnapshot.tables["public.financial_correction_agent_reviews"]
    expect(oldReviews.columns.consumed_at).toBeUndefined()
    expect(newReviews.columns.consumed_at).toBeDefined()
    expect(newReviews.columns.consumed_by_run_id).toBeDefined()
    expect(oldReviews.uniqueConstraints.uq_financial_correction_agent_review_plan).toBeDefined()
    expect(newReviews.uniqueConstraints.uq_financial_correction_agent_review_plan).toBeUndefined()
    expect(newReviews.uniqueConstraints.uq_financial_correction_agent_review_attempt.columns)
      .toEqual(["kind", "plan_hash", "review_run_id"])
    expect(newReviews.checkConstraints.financial_correction_agent_review_consumption).toBeDefined()

    for (const name of ["historical_rate_repair_runs", "portfolio_accrual_repair_runs", "rollover_correction_runs"]) {
      const oldTable = oldSnapshot.tables[`public.${name}`]
      const newTable = newSnapshot.tables[`public.${name}`]
      expect(newTable.columns.agent_review_id).toBeDefined()
      expect(newTable.columns.applied_by_agent).toBeDefined()
      if (name === "rollover_correction_runs") {
        expect(oldTable.columns.agent_review_id).toBeUndefined()
        expect(newTable.columns.reviewed_by.notNull).toBe(false)
      } else {
        const checkName = name === "historical_rate_repair_runs"
          ? "historical_rate_run_attribution" : "portfolio_accrual_run_attribution"
        expect(newTable.checkConstraints[checkName].value).toContain('"applied_by_agent" IS NOT NULL')
      }
    }
  })
})
