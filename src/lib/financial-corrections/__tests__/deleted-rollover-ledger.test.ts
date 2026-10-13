import { describe, expect, it } from "vitest"
import { planDeletedRolloverLedgerRepair } from "../deleted-rollover-ledger"

const predecessorId = "13acf40f-e93a-406e-8895-b0b465520e4d"
const successorId = "ffabf86d-5f8e-4051-8678-5b83d72107df"
const successorDeletedAt = new Date("2026-08-03T17:54:59.115Z")
const predecessorDeletedAt = new Date("2026-08-04T02:32:27.947Z")
const rolloverAt = new Date("2025-02-21T00:00:00.000Z")

function source() {
  let row = 0
  const journals: Array<{
    id: string; journalGroupId: string; loanId: string
    referenceType: string; referenceId: string; categoryName: string
    categoryType: "asset" | "revenue"; type: "debit" | "credit"
    amount: string; transactionDate: Date; createdAt: Date
  }> = []
  function pair(group: string, posted: Date, referenceType: string,
    referenceId: string, first: [string, string, "debit" | "credit", string],
    second: [string, string, "debit" | "credit", string],
    effective = rolloverAt) {
    for (const [loanId, categoryName, type, amount] of [first, second]) {
      journals.push({ id: `journal-${++row}`, journalGroupId: group, loanId,
        referenceType, referenceId, categoryName,
        categoryType: categoryName === "Interest Earned" ? "revenue" : "asset",
        type, amount, transactionDate: effective, createdAt: posted })
    }
  }
  const issued = new Date("2026-08-03T13:12:05.926Z")
  pair("root-disbursement", issued, "loan", predecessorId,
    [predecessorId, "Loans Receivable", "debit", "5000000.00"],
    [predecessorId, "Cash", "credit", "5000000.00"],
    new Date("2024-11-28T00:00:00.000Z"))
  pair("successor-disbursement", issued, "loan", successorId,
    [successorId, "Loans Receivable", "debit", "10000000.00"],
    [successorId, "Cash", "credit", "10000000.00"])
  pair("principal-transfer", issued, "rollover", predecessorId,
    [successorId, "Loans Receivable", "debit", "1721877.65"],
    [predecessorId, "Loans Receivable", "credit", "1721877.65"])
  pair("interest-carry", issued, "rollover", predecessorId,
    [successorId, "Loans Receivable", "debit", "3636606.34"],
    [successorId, "Interest Earned", "credit", "3636606.34"])
  pair("successor-delete-cash", successorDeletedAt, "loan_deletion_reversal", successorId,
    [successorId, "Cash", "debit", "10000000.00"],
    [successorId, "Loans Receivable", "credit", "10000000.00"])
  pair("successor-unroll-principal", successorDeletedAt,
    "loan_deletion_reversal", successorId,
    [predecessorId, "Loans Receivable", "debit", "1721877.65"],
    [successorId, "Loans Receivable", "credit", "1721877.65"])
  pair("successor-unroll-interest", successorDeletedAt,
    "loan_deletion_reversal", successorId,
    [successorId, "Interest Earned", "debit", "3636606.34"],
    [successorId, "Loans Receivable", "credit", "3636606.34"])
  pair("predecessor-delete-cash", predecessorDeletedAt,
    "loan_deletion_reversal", predecessorId,
    [predecessorId, "Cash", "debit", "5000000.00"],
    [predecessorId, "Loans Receivable", "credit", "5000000.00"],
    new Date("2024-11-28T00:00:00.000Z"))
  pair("1dd6afad-e61c-48eb-81c6-d770d117d9be", predecessorDeletedAt,
    "loan_deletion_reversal", predecessorId,
    [successorId, "Interest Earned", "debit", "3636606.34"],
    [successorId, "Loans Receivable", "credit", "3636606.34"])

  return {
    fullSourceDigest: "0".repeat(64),
    predecessor: { id: predecessorId, rolledOverFrom: null,
      startDate: new Date("2024-11-28T00:00:00.000Z"), deletedAt: predecessorDeletedAt },
    successor: { id: successorId, rolledOverFrom: predecessorId,
      startDate: rolloverAt, deletedAt: successorDeletedAt },
    payments: [], waivers: [], journals,
    audits: [
      { action: "loan.create", entityId: predecessorId, occurredAt: issued },
      { action: "loan.rollover", entityId: predecessorId, occurredAt: issued },
      { action: "loan.create", entityId: successorId, occurredAt: issued },
      { action: "loan.delete", entityId: successorId, occurredAt: successorDeletedAt },
      { action: "loan.unroll", entityId: predecessorId, occurredAt: successorDeletedAt },
      { action: "loan.delete", entityId: predecessorId, occurredAt: predecessorDeletedAt },
    ],
  }
}

describe("deleted rollover ledger repair", () => {
  it("proposes only the inverse of a second rollover-interest deletion reversal", () => {
    const plan = planDeletedRolloverLedgerRepair(source())
    expect(plan.classification).toBe("ready")
    if (plan.classification !== "ready") throw new Error(plan.exceptions.join("; "))
    expect(plan.sourceGroupId).toBe("1dd6afad-e61c-48eb-81c6-d770d117d9be")
    expect(plan.effectiveDate.toISOString()).toBe("2025-02-21T00:00:00.000Z")
    expect(plan.legs).toEqual([
      { category: "Loans Receivable", type: "debit", amount: "3636606.34" },
      { category: "Interest Earned", type: "credit", amount: "3636606.34" },
    ])
    expect(plan.inputFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("blocks an additional successor journal posted during predecessor deletion", () => {
    const input = source()
    const template = input.journals[0]
    input.journals.push(
      { ...template, id: "late-cash-debit", journalGroupId: "late-cash-group",
        loanId: successorId, referenceType: "loan_deletion_reversal",
        referenceId: predecessorId, categoryName: "Cash", type: "debit",
        amount: "1.00", createdAt: predecessorDeletedAt },
      { ...template, id: "late-cash-credit", journalGroupId: "late-cash-group",
        loanId: successorId, referenceType: "loan_deletion_reversal",
        referenceId: predecessorId, categoryName: "Cash", type: "credit",
        amount: "1.00", createdAt: predecessorDeletedAt },
    )
    const plan = planDeletedRolloverLedgerRepair(input)
    expect(plan.classification).toBe("blocked")
    expect(plan.legs).toEqual([])
  })

  it("blocks a malformed original carry date without throwing", () => {
    const input = source()
    const carry = input.journals.find((row) => row.journalGroupId === "interest-carry" &&
      row.categoryName === "Interest Earned")!
    carry.transactionDate = null as unknown as Date
    const plan = planDeletedRolloverLedgerRepair(input)
    expect(plan.classification).toBe("blocked")
    expect(plan.legs).toEqual([])
  })

  it("blocks a rollover audit recorded after the successor was deleted", () => {
    const input = source()
    const rolloverAudit = input.audits.find((row) => row.action === "loan.rollover")!
    rolloverAudit.occurredAt = new Date("2026-08-03T18:00:00.000Z")
    const plan = planDeletedRolloverLedgerRepair(input)
    expect(plan.classification).toBe("blocked")
    expect(plan.legs).toEqual([])
  })

  it("binds the plan to a digest of full source rows", () => {
    const input = source()
    const before = planDeletedRolloverLedgerRepair(input)
    const after = planDeletedRolloverLedgerRepair({
      ...input, fullSourceDigest: "a".repeat(64),
    })
    expect(after.inputFingerprint).not.toBe(before.inputFingerprint)
    expect(after.planHash).not.toBe(before.planHash)
  })

  it("requires the original carried interest to debit Loans Receivable", () => {
    const input = source()
    input.journals.find((row) => row.journalGroupId === "interest-carry" &&
      row.type === "debit")!.categoryName = "Cash"
    input.journals.find((row) => row.journalGroupId === "successor-unroll-interest" &&
      row.type === "credit")!.categoryName = "Cash"
    const plan = planDeletedRolloverLedgerRepair(input)
    expect(plan.classification).toBe("blocked")
    expect(plan.legs).toEqual([])
  })
})
