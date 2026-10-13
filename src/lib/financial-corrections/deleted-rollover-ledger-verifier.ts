import { createHash } from "node:crypto"
import BigNumber from "bignumber.js"
import { DELETED_ROLLOVER_LEDGER_POLICY, type DeletedRolloverJournal,
  type DeletedRolloverPlan, type DeletedRolloverSource } from "./deleted-rollover-ledger"

type Check = { name: string; passed: boolean }

export type DeletedRolloverLedgerEvidence = {
  kind: "deleted_rollover_ledger"
  subjectId: string
  planHash: string
  inputFingerprint: string
  policyVersion: string
  sourceGroupId: string | null
  verdict: "pass" | "fail"
  checks: Check[]
  issues: string[]
}

const CATEGORY_TYPES: Record<string, string> = {
  Cash: "asset",
  "Loans Receivable": "asset",
  "Interest Earned": "revenue",
  "Issuance Fees": "revenue",
  "Overpayment Revenue": "revenue",
  "Loan Losses": "expense",
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime())
}

function validAmount(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value) &&
    new BigNumber(value).gt(0)
}

function groupMatches(rows: DeletedRolloverJournal[] | undefined,
  loanId: string, referenceType: string, referenceId: string,
  postedAt: Date, effectiveAt: Date, amount: BigNumber,
  interestSide: "debit" | "credit"): boolean {
  if (!rows || rows.length !== 2) return false
  const receivableSide = interestSide === "debit" ? "credit" : "debit"
  return rows.every((row) => row.loanId === loanId &&
    row.referenceType === referenceType && row.referenceId === referenceId &&
    validDate(row.createdAt) && row.createdAt.getTime() === postedAt.getTime() &&
    validDate(row.transactionDate) &&
    row.transactionDate.getTime() === effectiveAt.getTime() &&
    validAmount(row.amount) && new BigNumber(row.amount).eq(amount)) &&
    rows.some((row) => row.categoryName === "Interest Earned" &&
      row.type === interestSide) &&
    rows.some((row) => row.categoryName === "Loans Receivable" &&
      row.type === receivableSide)
}

function accountNet(rows: DeletedRolloverJournal[], loanId: string,
  category: string, cutoff?: Date): BigNumber {
  return rows.reduce((total, row) => {
    if (row.loanId !== loanId || row.categoryName !== category ||
        cutoff && row.createdAt > cutoff) return total
    return row.type === "debit" ? total.plus(row.amount) : total.minus(row.amount)
  }, new BigNumber(0))
}

/** Independently checks the source rows and proposed journal; it never invokes the planner. */
export function verifyDeletedRolloverLedgerEvidence(
  source: DeletedRolloverSource,
  plan: DeletedRolloverPlan,
): DeletedRolloverLedgerEvidence {
  const checks: Check[] = []
  const issues: string[] = []
  const check = (name: string, passed: boolean) => {
    checks.push({ name, passed })
    if (!passed) issues.push(name)
  }
  const evidence = (): DeletedRolloverLedgerEvidence => ({
    kind: "deleted_rollover_ledger", subjectId: plan.predecessorId,
    planHash: plan.planHash, inputFingerprint: plan.inputFingerprint,
    policyVersion: plan.policyVersion, sourceGroupId: plan.sourceGroupId,
    verdict: issues.length ? "fail" : "pass", checks, issues,
  })

  // A malformed source cannot be sorted, hashed, or used in account arithmetic.
  const sourceShape = /^[a-f0-9]{64}$/.test(source.fullSourceDigest) &&
    validDate(source.predecessor.startDate) && validDate(source.successor.startDate) &&
    validDate(source.predecessor.deletedAt) && validDate(source.successor.deletedAt) &&
    source.audits.every((row) => typeof row.action === "string" &&
      typeof row.entityId === "string" && validDate(row.occurredAt)) &&
    source.payments.every((row) => typeof row.id === "string") &&
    source.waivers.every((row) => typeof row.id === "string") &&
    source.journals.every((row) => typeof row.id === "string" &&
      validDate(row.createdAt) &&
      validDate(row.transactionDate) && validAmount(row.amount) &&
      (row.type === "debit" || row.type === "credit"))
  check("source rows well formed", sourceShape)
  if (!sourceShape) return evidence()

  const { predecessor, successor } = source
  const predecessorDeleted = predecessor.deletedAt as Date
  const successorDeleted = successor.deletedAt as Date
  const orderedJournals = [...source.journals].sort((a, b) => a.id.localeCompare(b.id))
  const fingerprint = digest({ fullSourceDigest: source.fullSourceDigest,
    predecessor, successor,
    payments: [...source.payments].sort((a, b) => a.id.localeCompare(b.id)),
    waivers: [...source.waivers].sort((a, b) => a.id.localeCompare(b.id)),
    rateChanges: [...source.rateChanges].sort((a, b) => a.id.localeCompare(b.id)),
    journals: orderedJournals,
    audits: [...source.audits].sort((a, b) => a.action.localeCompare(b.action) ||
      a.entityId.localeCompare(b.entityId) || a.occurredAt.getTime() - b.occurredAt.getTime()),
  })
  const planPayload = {
    predecessorId: plan.predecessorId, successorId: plan.successorId,
    policyVersion: plan.policyVersion, inputFingerprint: plan.inputFingerprint,
    exceptions: plan.exceptions, classification: plan.classification,
    sourceGroupId: plan.sourceGroupId, effectiveDate: plan.effectiveDate,
    legs: plan.legs,
  }
  check("plan identity", plan.classification === "ready" &&
    plan.exceptions.length === 0 && plan.predecessorId === predecessor.id &&
    plan.successorId === successor.id &&
    plan.policyVersion === DELETED_ROLLOVER_LEDGER_POLICY &&
    plan.inputFingerprint === fingerprint && plan.planHash === digest(planPayload))

  const rolloverAudits = source.audits.filter((row) => row.action === "loan.rollover" &&
    row.entityId === predecessor.id)
  const auditCount = (action: string, id: string, at: Date) =>
    source.audits.filter((row) => row.action === action && row.entityId === id &&
      row.occurredAt.getTime() === at.getTime()).length
  check("chronology", !!predecessor.id && !!successor.id &&
    predecessor.id !== successor.id && predecessor.rolledOverFrom === null &&
    successor.rolledOverFrom === predecessor.id &&
    predecessor.startDate < successor.startDate &&
    successor.startDate < successorDeleted && successorDeleted < predecessorDeleted &&
    rolloverAudits.length === 1 &&
    rolloverAudits[0].occurredAt >= successor.startDate &&
    rolloverAudits[0].occurredAt < successorDeleted &&
    auditCount("loan.delete", successor.id, successorDeleted) === 1 &&
    auditCount("loan.unroll", predecessor.id, successorDeleted) === 1 &&
    auditCount("loan.delete", predecessor.id, predecessorDeleted) === 1)
  check("no active settlements", [...source.payments, ...source.waivers]
    .every((row) => (row.loanId === predecessor.id || row.loanId === successor.id) &&
      validDate(row.deletedAt)))

  const groups = new Map<string, DeletedRolloverJournal[]>()
  for (const row of orderedJournals) {
    if (!row.journalGroupId) continue
    const group = groups.get(row.journalGroupId) ?? []
    group.push(row)
    groups.set(row.journalGroupId, group)
  }
  check("journal integrity", orderedJournals.length > 0 &&
    new Set(orderedJournals.map((row) => row.id)).size === orderedJournals.length &&
    orderedJournals.every((row) => !!row.id && !!row.journalGroupId &&
      CATEGORY_TYPES[row.categoryName] === row.categoryType &&
      (row.loanId === predecessor.id || row.loanId === successor.id ||
        row.loanId === null)))
  const balancedGroups = groups.size > 0 &&
    groups.size === new Set(orderedJournals.map((row) => row.journalGroupId)).size &&
    [...groups.values()].every((rows) => rows.length >= 2 &&
      rows.every((row) => row.createdAt.getTime() === rows[0].createdAt.getTime()) &&
      rows.reduce((sum, row) => row.type === "debit" ? sum.plus(row.amount) :
        sum.minus(row.amount), new BigNumber(0)).isZero())

  const candidateGroups = [...groups.entries()].filter(([, rows]) =>
    rows.length === 2 && rows.every((row) => row.loanId === successor.id &&
      row.referenceType === "loan_deletion_reversal" &&
      row.referenceId === predecessor.id &&
      row.createdAt.getTime() === predecessorDeleted.getTime() &&
      row.transactionDate.getTime() === successor.startDate.getTime()) &&
    rows.some((row) => row.categoryName === "Interest Earned" && row.type === "debit") &&
    rows.some((row) => row.categoryName === "Loans Receivable" && row.type === "credit"))
  const candidate = candidateGroups.length === 1 ? candidateGroups[0] : null
  const duplicateAmount = candidate && new BigNumber(candidate[1][0].amount)
  const exactCandidate = !!candidate && !!duplicateAmount &&
    groupMatches(candidate[1], successor.id, "loan_deletion_reversal",
      predecessor.id, predecessorDeleted, successor.startDate, duplicateAmount, "debit")
  const afterDeletion = [...groups.entries()].filter(([, rows]) =>
    rows.some((row) => row.loanId === successor.id && row.createdAt > successorDeleted))
  check("exact duplicate interest group", exactCandidate &&
    plan.sourceGroupId === candidate?.[0] &&
    afterDeletion.length === 1 && afterDeletion[0][0] === candidate?.[0] &&
    orderedJournals.every((row) => row.createdAt <= predecessorDeleted))

  let auditCarryMatches = false
  if (duplicateAmount && rolloverAudits.length === 1) {
    try {
      const after = JSON.parse(rolloverAudits[0].afterValue ?? "null") as unknown
      if (after && typeof after === "object") {
        const value = after as Record<string, unknown>
        auditCarryMatches = value.rolledIntoLoanId === successor.id &&
          typeof value.carriedInterest === "string" &&
          validAmount(value.carriedInterest) &&
          new BigNumber(value.carriedInterest).eq(duplicateAmount)
      }
    } catch { /* A malformed audit cannot prove the carry. */ }
  }
  const originalGroups = duplicateAmount ? [...groups.values()].filter((rows) =>
    groupMatches(rows, successor.id, "rollover", predecessor.id,
      rows[0].createdAt, successor.startDate, duplicateAmount, "credit") &&
    rows[0].createdAt >= successor.startDate &&
    rows[0].createdAt < successorDeleted) : []
  check("original carry", auditCarryMatches && originalGroups.length === 1)
  const unrollGroups = duplicateAmount ? [...groups.values()].filter((rows) =>
    groupMatches(rows, successor.id, "loan_deletion_reversal", successor.id,
      successorDeleted, successor.startDate, duplicateAmount, "debit")) : []
  check("successor unroll", unrollGroups.length === 1)

  const proposed = plan.classification === "ready" ? plan.legs : []
  const oppositeLegs = !!duplicateAmount && proposed.length === 2 &&
    proposed[0].category === "Loans Receivable" && proposed[0].type === "debit" &&
    proposed[1].category === "Interest Earned" && proposed[1].type === "credit" &&
    validAmount(proposed[0].amount) && validAmount(proposed[1].amount) &&
    new BigNumber(proposed[0].amount).eq(duplicateAmount) &&
    new BigNumber(proposed[1].amount).eq(duplicateAmount) &&
    validDate(plan.effectiveDate) &&
    plan.effectiveDate.getTime() === successor.startDate.getTime()
  check("balanced groups and opposite legs", balancedGroups && oppositeLegs)

  const accountNets = !!duplicateAmount && Object.keys(CATEGORY_TYPES).every((category) => {
    const expected = category === "Loans Receivable" ? duplicateAmount.negated() :
      category === "Interest Earned" ? duplicateAmount : new BigNumber(0)
    const after = accountNet(orderedJournals, successor.id, category)
    return accountNet(orderedJournals, successor.id, category, successorDeleted).isZero() &&
      accountNet(orderedJournals, predecessor.id, category).isZero() &&
      after.eq(expected) &&
      (category === "Loans Receivable" ? after.plus(duplicateAmount) :
        category === "Interest Earned" ? after.minus(duplicateAmount) : after).isZero()
  })
  check("account nets", accountNets)
  check("no Cash effect", !!candidate &&
    candidate[1].every((row) => row.categoryName !== "Cash") &&
    proposed.every((row) => String(row.category) !== "Cash") &&
    accountNet(orderedJournals, predecessor.id, "Cash").isZero() &&
    accountNet(orderedJournals, successor.id, "Cash", successorDeleted).isZero() &&
    accountNet(orderedJournals, successor.id, "Cash").isZero())
  return evidence()
}
