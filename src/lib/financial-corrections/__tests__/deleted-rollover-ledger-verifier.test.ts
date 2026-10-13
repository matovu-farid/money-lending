import { describe, expect, it } from "vitest"
import { planDeletedRolloverLedgerRepair, type DeletedRolloverSource } from
  "../deleted-rollover-ledger"
import { verifyDeletedRolloverLedgerEvidence } from
  "../deleted-rollover-ledger-verifier"

const predecessorId = "predecessor"
const successorId = "successor"
const effective = new Date("2025-02-21T00:00:00.000Z")
const issued = new Date("2025-02-22T00:00:00.000Z")
const successorDeleted = new Date("2026-08-03T00:00:00.000Z")
const predecessorDeleted = new Date("2026-08-04T00:00:00.000Z")

function fixture(): DeletedRolloverSource {
  const journals: DeletedRolloverSource["journals"] = []
  let id = 0
  function pair(group: string, createdAt: Date, referenceType: string,
    referenceId: string, first: [string, string, "debit" | "credit", string],
    second: [string, string, "debit" | "credit", string],
    transactionDate = effective) {
    for (const [loanId, categoryName, type, amount] of [first, second]) {
      journals.push({ id: `row-${++id}`, journalGroupId: group, loanId,
        referenceType, referenceId, categoryName,
        categoryType: categoryName === "Interest Earned" ? "revenue" : "asset",
        type, amount, transactionDate, createdAt })
    }
  }
  pair("predecessor-issue", issued, "loan", predecessorId,
    [predecessorId, "Loans Receivable", "debit", "100.00"],
    [predecessorId, "Cash", "credit", "100.00"])
  pair("successor-issue", issued, "loan", successorId,
    [successorId, "Loans Receivable", "debit", "200.00"],
    [successorId, "Cash", "credit", "200.00"])
  pair("interest-carry", issued, "rollover", predecessorId,
    [successorId, "Loans Receivable", "debit", "30.00"],
    [successorId, "Interest Earned", "credit", "30.00"])
  pair("successor-delete", successorDeleted, "loan_deletion_reversal", successorId,
    [successorId, "Cash", "debit", "200.00"],
    [successorId, "Loans Receivable", "credit", "200.00"])
  pair("successor-unroll", successorDeleted, "loan_deletion_reversal", successorId,
    [successorId, "Interest Earned", "debit", "30.00"],
    [successorId, "Loans Receivable", "credit", "30.00"])
  pair("predecessor-delete", predecessorDeleted, "loan_deletion_reversal", predecessorId,
    [predecessorId, "Cash", "debit", "100.00"],
    [predecessorId, "Loans Receivable", "credit", "100.00"])
  pair("duplicate-interest", predecessorDeleted, "loan_deletion_reversal", predecessorId,
    [successorId, "Interest Earned", "debit", "30.00"],
    [successorId, "Loans Receivable", "credit", "30.00"])
  return {
    fullSourceDigest: "a".repeat(64),
    predecessor: { id: predecessorId, rolledOverFrom: null,
      startDate: new Date("2024-11-28T00:00:00.000Z"), deletedAt: predecessorDeleted },
    successor: { id: successorId, rolledOverFrom: predecessorId,
      startDate: effective, deletedAt: successorDeleted },
    payments: [], waivers: [], rateChanges: [], journals,
    audits: [
      { action: "loan.rollover", entityId: predecessorId, occurredAt: issued,
        afterValue: JSON.stringify({ rolledIntoLoanId: successorId,
          carriedInterest: "30.00" }) },
      { action: "loan.delete", entityId: successorId, occurredAt: successorDeleted },
      { action: "loan.unroll", entityId: predecessorId, occurredAt: successorDeleted },
      { action: "loan.delete", entityId: predecessorId, occurredAt: predecessorDeleted },
    ],
  }
}

describe("deleted rollover ledger verifier", () => {
  it("returns passing source checks bound to the exact ready plan", () => {
    const source = fixture()
    const plan = planDeletedRolloverLedgerRepair(source)
    expect(plan.classification).toBe("ready")
    const evidence = verifyDeletedRolloverLedgerEvidence(source, plan)
    expect(evidence).toMatchObject({ verdict: "pass", kind: "deleted_rollover_ledger",
      subjectId: predecessorId, planHash: plan.planHash,
      inputFingerprint: plan.inputFingerprint, policyVersion: plan.policyVersion,
      sourceGroupId: "duplicate-interest", issues: [] })
    expect(evidence.checks.length).toBeGreaterThan(8)
    expect(evidence.checks.every((check) => check.passed)).toBe(true)
  })

  it("fails a blocked plan and a changed plan identity", () => {
    const source = fixture()
    const ready = planDeletedRolloverLedgerRepair(source)
    const blocked = planDeletedRolloverLedgerRepair({ ...source, fullSourceDigest: "invalid" })
    expect(verifyDeletedRolloverLedgerEvidence(source, blocked).verdict).toBe("fail")
    const tampered = { ...ready, planHash: "0".repeat(64) }
    const result = verifyDeletedRolloverLedgerEvidence(source, tampered)
    expect(result.verdict).toBe("fail")
    expect(result.checks.find((check) => check.name === "plan identity")?.passed)
      .toBe(false)
  })

  it("detects source drift and an active settlement", () => {
    const source = fixture()
    const plan = planDeletedRolloverLedgerRepair(source)
    source.payments.push({ id: "payment", loanId: successorId, deletedAt: null })
    const result = verifyDeletedRolloverLedgerEvidence(source, plan)
    expect(result.verdict).toBe("fail")
    expect(result.checks.find((check) => check.name === "no active settlements")?.passed)
      .toBe(false)
    expect(result.checks.find((check) => check.name === "plan identity")?.passed)
      .toBe(false)
  })

  it("accepts inactive legacy settlements without inferring receipt repairs", () => {
    const source = fixture()
    source.payments.push({ id: "legacy-payment", loanId: predecessorId,
      deletedAt: predecessorDeleted })
    source.waivers.push({ id: "legacy-waiver", loanId: successorId,
      deletedAt: successorDeleted })
    const plan = planDeletedRolloverLedgerRepair(source)
    expect(verifyDeletedRolloverLedgerEvidence(source, plan).verdict).toBe("pass")
  })

  it("fails closed on malformed source dates", () => {
    const source = fixture()
    const plan = planDeletedRolloverLedgerRepair(source)
    source.journals[0].createdAt = new Date("invalid")
    const result = verifyDeletedRolloverLedgerEvidence(source, plan)
    expect(result.verdict).toBe("fail")
    expect(result.checks).toContainEqual({ name: "source rows well formed", passed: false })
  })

  it("rejects a missing unroll audit and reversed deletion chronology", () => {
    const source = fixture()
    const plan = planDeletedRolloverLedgerRepair(source)
    source.audits = source.audits.filter((row) => row.action !== "loan.unroll")
    source.successor.deletedAt = new Date("2026-08-05T00:00:00.000Z")
    const result = verifyDeletedRolloverLedgerEvidence(source, plan)
    expect(result.checks.find((check) => check.name === "chronology")?.passed)
      .toBe(false)
  })

  it("rejects an extra duplicate, a broken original carry, and a broken successor unroll", () => {
    for (const [group, check] of [
      ["duplicate-interest", "exact duplicate interest group"],
      ["interest-carry", "original carry"],
      ["successor-unroll", "successor unroll"],
    ] as const) {
      const source = fixture()
      const plan = planDeletedRolloverLedgerRepair(source)
      if (group === "duplicate-interest") {
        source.journals.push(...source.journals.filter((row) =>
          row.journalGroupId === group).map((row) => ({ ...row,
            id: `extra-${row.id}`, journalGroupId: "extra-duplicate" })))
      } else {
        source.journals = source.journals.filter((row) => row.journalGroupId !== group)
      }
      expect(verifyDeletedRolloverLedgerEvidence(source, plan).checks
        .find((item) => item.name === check)?.passed).toBe(false)
    }
  })

  it("requires the original carry to be posted before successor deletion", () => {
    const source = fixture()
    const plan = planDeletedRolloverLedgerRepair(source)
    for (const row of source.journals.filter((item) =>
      item.journalGroupId === "interest-carry")) row.createdAt = successorDeleted
    const result = verifyDeletedRolloverLedgerEvidence(source, plan)
    expect(result.checks.find((check) => check.name === "original carry")?.passed)
      .toBe(false)
  })

  it("rejects nonzero Cash, unexplained account nets, and unbalanced groups", () => {
    const source = fixture()
    const plan = planDeletedRolloverLedgerRepair(source)
    const cash = source.journals.find((row) => row.journalGroupId === "successor-delete" &&
      row.categoryName === "Cash")!
    cash.amount = "199.00"
    const result = verifyDeletedRolloverLedgerEvidence(source, plan)
    expect(result.checks.find((check) => check.name === "no Cash effect")?.passed)
      .toBe(false)
    expect(result.checks.find((check) => check.name === "account nets")?.passed)
      .toBe(false)
    expect(result.checks.find((check) => check.name === "balanced groups and opposite legs")?.passed)
      .toBe(false)
  })

  it("rejects proposed legs that differ from the source reversal", () => {
    const source = fixture()
    const plan = planDeletedRolloverLedgerRepair(source)
    if (plan.classification !== "ready") throw new Error(plan.exceptions.join("; "))
    const wrong = { ...plan, legs: [
      { category: "Loans Receivable" as const, type: "debit" as const, amount: "31.00" },
      plan.legs[1],
    ] as typeof plan.legs }
    const result = verifyDeletedRolloverLedgerEvidence(source, wrong)
    expect(result.checks.find((check) => check.name === "balanced groups and opposite legs")?.passed)
      .toBe(false)
    expect(result.verdict).toBe("fail")
  })
})
