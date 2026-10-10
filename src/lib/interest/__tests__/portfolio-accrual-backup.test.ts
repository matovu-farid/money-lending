import { describe, expect, it } from "vitest"
import { isIsolatedPortfolioRehearsalDatabase, portfolioAccrualDataInCatalog, validPortfolioPlanProof,
  validPortfolioRestoreProof } from "../portfolio-accrual-backup"

const full = ["loans", "payments", "transactions", "audit_log",
  "historical_rate_repair_approvals", "historical_rate_repair_runs",
  "portfolio_accrual_repair_approvals", "portfolio_accrual_repair_runs"]
  .flatMap((name, index) => [
    `${index + 1}; 0 0 TABLE public ${name} owner`,
    `${index + 101}; 0 0 TABLE DATA public ${name} owner`,
  ]).join("\n")

describe("portfolio accrual backup catalog", () => {
  it("requires the new audit tables and their data in a restorable dump", () => {
    expect(portfolioAccrualDataInCatalog(full)).toBe(true)
    expect(portfolioAccrualDataInCatalog(full.replace(
      /\d+; 0 0 TABLE DATA public portfolio_accrual_repair_runs owner/, ""))).toBe(false)
    expect(portfolioAccrualDataInCatalog(full.replace(
      /\d+; 0 0 TABLE public portfolio_accrual_repair_approvals owner/, ""))).toBe(false)
  })

  it("requires a fresh, matching, nonempty isolated restore rehearsal", () => {
    const expected = { dumpSha256: "a".repeat(64), sourceHost: "prod.example",
      sourceDatabase: "neondb" }
    const proof = { ...expected, restoredAt: new Date().toISOString(),
      restoredDatabase: "money_lending_rehearsal_abc123", auditTablesPresent: true,
      loanRows: 67, paymentRows: 208, transactionRows: 1108, snapshotRows: 10 }
    expect(validPortfolioRestoreProof(proof, expected)).toBe(true)
    expect(validPortfolioRestoreProof({ ...proof, dumpSha256: "b".repeat(64) }, expected)).toBe(false)
    expect(validPortfolioRestoreProof({ ...proof, restoredDatabase: "neondb" }, expected)).toBe(false)
    expect(validPortfolioRestoreProof({ ...proof, transactionRows: 0 }, expected)).toBe(false)
    expect(validPortfolioRestoreProof({ ...proof, restoredAt: "2000-01-01T00:00:00.000Z" }, expected)).toBe(false)
  })

  it("binds a successful exact-plan rehearsal to the archive and plan hash", () => {
    const now = Date.now()
    const expected = { dumpSha256: "a".repeat(64), restoredDatabase: "money_lending_rehearsal_abc123",
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
    const local = "postgres://tester:secret@localhost:5432/money_lending_rehearsal_abc123"
    expect(isIsolatedPortfolioRehearsalDatabase(local, local)).toBe(true)
    expect(isIsolatedPortfolioRehearsalDatabase(local,
      "postgres://tester:secret@localhost:5432/money_lending")).toBe(false)
    expect(isIsolatedPortfolioRehearsalDatabase(
      "postgres://tester:secret@prod.example:5432/money_lending_rehearsal_abc123",
      "postgres://tester:secret@prod.example:5432/money_lending_rehearsal_abc123")).toBe(false)
  })
})
