import { describe, expect, it } from "vitest"
import { archiveGateForPortfolioVerification, isIsolatedPortfolioRehearsalDatabase,
  portfolioAccrualDataInCatalog, validPortfolioPlanProof,
  validPortfolioRestoreProof } from "../portfolio-accrual-backup"

const full = ["loans", "payments", "transactions", "audit_log",
  "historical_rate_repair_approvals", "historical_rate_repair_runs",
  "portfolio_accrual_repair_approvals", "portfolio_accrual_repair_runs",
  "financial_correction_agent_reviews"]
  .flatMap((name, index) => [
    `${index + 1}; 0 0 TABLE public ${name} owner`,
    `${index + 101}; 0 0 TABLE DATA public ${name} owner`,
  ]).join("\n")

describe("portfolio accrual backup catalog", () => {
  it("checks an isolated restored database against the archive source identity", () => {
    const local = "postgresql://test@127.0.0.1:55440/money_lending_rehearsal_abcdef123456"
    const gate = { manifestPath: "/private/tmp/archive.dump.manifest.json",
      expectedDumpSha256: "a".repeat(64), primaryUrl: local, directUrl: local }
    const manifest = { sourceHost: "source.example", sourceDatabase: "money_lending" }
    const archiveGate = archiveGateForPortfolioVerification(gate, manifest)
    expect(new URL(archiveGate.primaryUrl).hostname).toBe(manifest.sourceHost)
    expect(new URL(archiveGate.primaryUrl).pathname).toBe(`/${manifest.sourceDatabase}`)
    expect(archiveGate.directUrl).toBe(archiveGate.primaryUrl)
    expect(archiveGate.manifestPath).toBe(gate.manifestPath)
    expect(archiveGate.expectedDumpSha256).toBe(gate.expectedDumpSha256)
    expect(archiveGateForPortfolioVerification({ ...gate,
      primaryUrl: "postgresql://test@db.example/money_lending",
      directUrl: "postgresql://test@db.example/money_lending",
    }, manifest)).toEqual({ ...gate,
      primaryUrl: "postgresql://test@db.example/money_lending",
      directUrl: "postgresql://test@db.example/money_lending" })
    expect(() => archiveGateForPortfolioVerification(gate, {
      sourceHost: "source.example", sourceDatabase: "../wrong",
    })).toThrow(/source identity/i)
  })

  it("requires the new audit tables and their data in a restorable dump", () => {
    expect(portfolioAccrualDataInCatalog(full)).toBe(true)
    expect(portfolioAccrualDataInCatalog(full.replace(
      /\d+; 0 0 TABLE DATA public portfolio_accrual_repair_runs owner/, ""))).toBe(false)
    expect(portfolioAccrualDataInCatalog(full.replace(
      /\d+; 0 0 TABLE public portfolio_accrual_repair_approvals owner/, ""))).toBe(false)
    expect(portfolioAccrualDataInCatalog(full.replace(
      /\d+; 0 0 TABLE DATA public financial_correction_agent_reviews owner/, ""))).toBe(false)
  })

  it("requires a fresh, matching, nonempty isolated restore rehearsal", () => {
    const expected = { dumpSha256: "a".repeat(64), sourceHost: "prod.example",
      sourceDatabase: "neondb", applicationBuildSha256: "c".repeat(64),
      schemaSha256: "d".repeat(64) }
    const proof = { ...expected, restoredAt: new Date().toISOString(),
      restoredDatabase: "money_lending_rehearsal_abcdef123456", auditTablesPresent: true,
      loanRows: 67, paymentRows: 208, transactionRows: 1108, snapshotRows: 10 }
    expect(validPortfolioRestoreProof(proof, expected)).toBe(true)
    expect(validPortfolioRestoreProof(proof, { ...expected,
      restoredDatabase: "money_lending_rehearsal_other" })).toBe(false)
    expect(validPortfolioRestoreProof({ ...proof, dumpSha256: "b".repeat(64) }, expected)).toBe(false)
    expect(validPortfolioRestoreProof({ ...proof, restoredDatabase: "neondb" }, expected)).toBe(false)
    expect(validPortfolioRestoreProof({ ...proof, transactionRows: 0 }, expected)).toBe(false)
    expect(validPortfolioRestoreProof({ ...proof, restoredAt: "2000-01-01T00:00:00.000Z" }, expected)).toBe(false)
    expect(validPortfolioRestoreProof({ ...proof, applicationBuildSha256: "e".repeat(64) }, expected)).toBe(false)
    expect(validPortfolioRestoreProof({ ...proof, schemaSha256: "e".repeat(64) }, expected)).toBe(false)
    expect(validPortfolioRestoreProof({ ...proof, applicationBuildSha256: undefined }, expected)).toBe(false)
    expect(validPortfolioRestoreProof({ ...proof, schemaSha256: undefined }, expected)).toBe(false)
  })

  it("binds a successful exact-plan rehearsal to the archive and plan hash", () => {
    const now = Date.now()
    const expected = { dumpSha256: "a".repeat(64), restoredDatabase: "money_lending_rehearsal_abcdef123456",
      planHash: "b".repeat(64), asOf: "2026-10-10T18:13:30.000Z" }
    const proof = { dumpSha256: expected.dumpSha256,
      restoredDatabase: expected.restoredDatabase, asOf: expected.asOf,
      planHashes: [expected.planHash], completedAt: new Date(now).toISOString(),
      unchangedCashLoansPaymentsSnapshots: true }
    expect(validPortfolioPlanProof(proof, expected, now)).toBe(true)
    expect(validPortfolioPlanProof({ ...proof, planHashes: ["c".repeat(64)] }, expected, now)).toBe(false)
    expect(validPortfolioPlanProof({ ...proof, dumpSha256: "c".repeat(64) }, expected, now)).toBe(false)
    expect(validPortfolioPlanProof({ ...proof, unchangedCashLoansPaymentsSnapshots: false }, expected, now)).toBe(false)
  })

  it("allows plan-proof creation only on a named loopback rehearsal database", () => {
    const local = "postgres://tester:secret@localhost:5432/money_lending_rehearsal_abcdef123456"
    expect(isIsolatedPortfolioRehearsalDatabase(local, local)).toBe(true)
    const sourceCopy = "postgres://tester:secret@localhost:5432/money_lending_rehearsal_fresh_20261012"
    expect(isIsolatedPortfolioRehearsalDatabase(sourceCopy, sourceCopy)).toBe(false)
    expect(isIsolatedPortfolioRehearsalDatabase(local,
      "postgres://tester:secret@localhost:5432/money_lending")).toBe(false)
    expect(isIsolatedPortfolioRehearsalDatabase(
      "postgres://tester:secret@prod.example:5432/money_lending_rehearsal_abcdef123456",
      "postgres://tester:secret@prod.example:5432/money_lending_rehearsal_abcdef123456")).toBe(false)
  })
})
