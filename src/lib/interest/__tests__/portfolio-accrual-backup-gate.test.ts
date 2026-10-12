import { randomUUID } from "node:crypto"
import { unlink, writeFile } from "node:fs/promises"
import { afterEach, describe, expect, it, vi } from "vitest"
import { correctionTempDirectory } from "../rollover-snapshot-guard"

const { catalog } = vi.hoisted(() => ({ catalog: [
  "portfolio_accrual_repair_approvals", "portfolio_accrual_repair_runs",
  "financial_correction_agent_reviews",
].flatMap((name, index) => [
  `${index + 1}; 0 0 TABLE public ${name} owner`,
  `${index + 101}; 0 0 TABLE DATA public ${name} owner`,
]).join("\n") }))

vi.mock("node:child_process", () => ({
  execFile: (command: string, args: string[], options: unknown,
    callback?: (error: Error | null, output: { stdout: string | Buffer; stderr: string }) => void) => {
    const done = callback ?? options as typeof callback
    if (!done) throw new Error("Missing execFile callback")
    const stdout = command === "pg_restore" ? catalog : args[0] === "rev-parse"
      ? "a".repeat(40) : args[0] === "ls-files" ? Buffer.alloc(0) : ""
    done(null, { stdout, stderr: "" })
  },
}))

vi.mock("postgres", () => ({ default: () => Object.assign(
  (parts: TemplateStringsArray) => Promise.resolve(
    parts.join("").includes("information_schema.columns") ? [{ table_name: "loans" }] :
    parts.join("").includes("pg_indexes") ? [{ indexname: "loans_pkey" }] : []),
  { end: async () => undefined }) }))

vi.mock("../historical-rate-backup", () => ({
  verifyHistoricalRateArchive: vi.fn(async (gate: {
    manifestPath: string; expectedDumpSha256: string; primaryUrl: string; directUrl: string
  }) => {
    const manifest = JSON.parse(await import("node:fs/promises").then((fs) =>
      fs.readFile(gate.manifestPath, "utf8"))) as Record<string, unknown>
    const source = new URL(gate.primaryUrl)
    if (source.hostname !== manifest.sourceHost ||
        decodeURIComponent(source.pathname.slice(1)) !== manifest.sourceDatabase ||
        gate.primaryUrl !== gate.directUrl) {
      throw new Error("Backup manifest does not match the selected database and dump")
    }
    return { dumpPath: String(manifest.dumpPath), dumpSha256: gate.expectedDumpSha256 }
  }),
}))

import { portfolioApplicationBuildSha256, portfolioSchemaSha256,
  verifyPortfolioAccrualBackup } from "../portfolio-accrual-backup"

const cleanup: string[] = []
afterEach(async () => {
  for (const path of cleanup.splice(0)) await unlink(path)
})

describe("portfolio archive verification target", () => {
  it("rejects an unsafe manifest path before reading its source identity", async () => {
    await expect(verifyPortfolioAccrualBackup({
      manifestPath: "/etc/passwd", expectedDumpSha256: "b".repeat(64),
      primaryUrl: "postgresql://test@127.0.0.1:55440/money_lending_rehearsal_abcdef123456",
      directUrl: "postgresql://test@127.0.0.1:55440/money_lending_rehearsal_abcdef123456",
    })).rejects.toThrow(/manifest path is unsafe/i)
  })

  it("accepts a different source database only for its exact isolated restore", async () => {
    const dumpPath = `${correctionTempDirectory}/portfolio-gate-${randomUUID()}.dump`
    const manifestPath = `${dumpPath}.manifest.json`
    const proofPath = `${dumpPath}.restore.json`
    const local = "postgresql://test@127.0.0.1:55440/money_lending_rehearsal_abcdef123456"
    const hash = "b".repeat(64)
    await writeFile(manifestPath, JSON.stringify({ dumpPath, sourceHost: "source.example",
      sourceDatabase: "source_db", portfolioAccrualAuditTablesInDump: true }),
    { mode: 0o600, flag: "wx" })
    cleanup.push(manifestPath)
    const proof = { dumpSha256: hash, sourceHost: "source.example",
      sourceDatabase: "source_db", restoredDatabase: "money_lending_rehearsal_abcdef123456",
      restoredAt: new Date().toISOString(), auditTablesPresent: true,
      loanRows: 1, paymentRows: 1, transactionRows: 1, snapshotRows: 1,
      applicationBuildSha256: await portfolioApplicationBuildSha256(),
      schemaSha256: await portfolioSchemaSha256(local) }
    await writeFile(proofPath, JSON.stringify(proof), { mode: 0o600, flag: "wx" })
    cleanup.push(proofPath)
    const gate = { manifestPath, expectedDumpSha256: hash,
      primaryUrl: local, directUrl: local }

    await expect(verifyPortfolioAccrualBackup(gate)).resolves.toEqual({
      dumpPath, dumpSha256: hash })
    await expect(verifyPortfolioAccrualBackup({ ...gate,
      primaryUrl: local.replace("abcdef123456", "fedcba654321"),
      directUrl: local.replace("abcdef123456", "fedcba654321") }))
      .rejects.toThrow(/restore rehearsal/i)
    await expect(verifyPortfolioAccrualBackup({ ...gate,
      primaryUrl: "postgresql://test@db.example/source_db",
      directUrl: "postgresql://test@db.example/source_db" },
    { planHash: "c".repeat(64), asOf: new Date("2025-01-31T23:59:59.999Z") }))
      .rejects.toThrow(/manifest/i)
    await expect(verifyPortfolioAccrualBackup({ ...gate,
      primaryUrl: "postgresql://test@source.example/source_db",
      directUrl: "postgresql://test@source.example/source_db" },
    { planHash: "c".repeat(64), asOf: new Date("2025-01-31T23:59:59.999Z") }))
      .rejects.toThrow(/plans\.json/i)
  })
})
