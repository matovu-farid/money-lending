import { describe, expect, it } from "vitest"
import { paymentAllocationDataInCatalog, validPaymentAllocationPlanProof } from
  "../payment-allocation-backup"

const catalog = [
  "100; 1259 1500 TABLE public payment_allocation_repair_runs owner",
  "101; 0 1500 TABLE DATA public payment_allocation_repair_runs owner",
  "102; 1259 1501 TABLE public financial_correction_agent_reviews owner",
  "103; 0 1501 TABLE DATA public financial_correction_agent_reviews owner",
].join("\n")

describe("payment allocation archive proof", () => {
  it("requires restorable run and review tables, not just a schema entry", () => {
    expect(paymentAllocationDataInCatalog(catalog)).toBe(true)
    expect(paymentAllocationDataInCatalog(catalog.replace(
      "101; 0 1500 TABLE DATA public payment_allocation_repair_runs owner", ""))).toBe(false)
    expect(paymentAllocationDataInCatalog(catalog.replace(
      "103; 0 1501 TABLE DATA public financial_correction_agent_reviews owner", ""))).toBe(false)
  })

  it("binds a recent isolated rehearsal to the exact loan, source, date, and dump", () => {
    const now = Date.parse("2026-10-13T11:00:00.000Z")
    const expected = { dumpSha256: "a".repeat(64),
      restoredDatabase: "money_lending_rehearsal_abcdef123456",
      loanId: "64bebb1e-275b-4031-b4f8-2eae6b6bbf63", planHash: "b".repeat(64),
      inputFingerprint: "c".repeat(64), asOf: "2026-10-10T19:04:00.000Z" }
    const proof = { ...expected, classification: "ready",
      rehearsalAppliedAndReconciled: true, completedAt:
      "2026-10-13T10:00:00.000Z", unchangedCashLoansPaymentsSnapshots: true }
    expect(validPaymentAllocationPlanProof(proof, expected, now)).toBe(true)
    expect(validPaymentAllocationPlanProof({ ...proof, loanId: "other" }, expected, now))
      .toBe(false)
    expect(validPaymentAllocationPlanProof({ ...proof, inputFingerprint: "d".repeat(64) },
      expected, now)).toBe(false)
    expect(validPaymentAllocationPlanProof({ ...proof, classification: "blocked" },
      expected, now)).toBe(false)
    expect(validPaymentAllocationPlanProof({ ...proof, rehearsalAppliedAndReconciled: false },
      expected, now)).toBe(false)
    expect(validPaymentAllocationPlanProof({ ...proof, completedAt: "2026-10-11T10:00:00.000Z" },
      expected, now)).toBe(false)
  })
})
