import { createHash } from "node:crypto"
import BigNumber from "bignumber.js"

export const DELETED_ROLLOVER_LEDGER_POLICY = "deleted-rollover-ledger-v1"

type Loan = {
  id: string
  rolledOverFrom: string | null
  startDate: Date
  deletedAt: Date | null
}

type Settlement = {
  id: string
  loanId: string
  deletedAt: Date | null
  markedWrong?: boolean
}

export type DeletedRolloverJournal = {
  id: string
  journalGroupId: string | null
  loanId: string | null
  referenceType: string | null
  referenceId: string | null
  categoryName: string
  categoryType: string
  type: "debit" | "credit"
  amount: string
  transactionDate: Date
  createdAt: Date
}

export type DeletedRolloverSource = {
  /** Digest of complete DB rows, including fields omitted from the arithmetic model. */
  fullSourceDigest: string
  predecessor: Loan
  successor: Loan
  payments: Settlement[]
  waivers: Settlement[]
  rateChanges: Array<{ id: string; loanId: string; status: string }>
  journals: DeletedRolloverJournal[]
  audits: Array<{ action: string; entityId: string; occurredAt: Date;
    afterValue?: string | null }>
}

type Leg = {
  category: "Loans Receivable" | "Interest Earned"
  type: "debit" | "credit"
  amount: string
}

type BasePlan = {
  predecessorId: string
  successorId: string
  policyVersion: typeof DELETED_ROLLOVER_LEDGER_POLICY
  inputFingerprint: string
  planHash: string
  exceptions: string[]
}

export type DeletedRolloverPlan = BasePlan & (
  | { classification: "ready"; sourceGroupId: string; effectiveDate: Date;
      legs: [Leg, Leg] }
  | { classification: "blocked"; sourceGroupId: null; effectiveDate: null;
      legs: [] }
)

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

function validDate(date: Date | null): date is Date {
  return date instanceof Date && Number.isFinite(date.getTime())
}

function amount(value: string): BigNumber | null {
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value)) return null
  const parsed = new BigNumber(value)
  return parsed.isFinite() && parsed.gt(0) ? parsed : null
}

function net(rows: DeletedRolloverJournal[], loanId: string, category: string,
  cutoff?: Date): BigNumber {
  return rows.reduce((sum, row) => {
    if (row.loanId !== loanId || row.categoryName !== category ||
        cutoff && row.createdAt > cutoff) return sum
    const value = new BigNumber(row.amount)
    return row.type === "debit" ? sum.plus(value) : sum.minus(value)
  }, new BigNumber(0))
}

function hasAudit(source: DeletedRolloverSource, action: string, entityId: string,
  at?: Date): boolean {
  return source.audits.some((row) => row.action === action &&
    row.entityId === entityId && validDate(row.occurredAt) &&
    (!at || row.occurredAt.getTime() === at.getTime()))
}

function rolloverAuditMatches(source: DeletedRolloverSource, amount: BigNumber): boolean {
  const audits = source.audits.filter((row) => row.action === "loan.rollover" &&
    row.entityId === source.predecessor.id)
  if (audits.length !== 1) return false
  try {
    const after = JSON.parse(audits[0].afterValue ?? "null") as unknown
    if (!after || typeof after !== "object") return false
    const value = after as Record<string, unknown>
    return value.rolledIntoLoanId === source.successor.id &&
      typeof value.carriedInterest === "string" &&
      new BigNumber(value.carriedInterest).eq(amount)
  } catch {
    return false
  }
}

/** A fail-closed proposal to undo one provable duplicate non-cash deletion group. */
export function planDeletedRolloverLedgerRepair(
  source: DeletedRolloverSource,
): DeletedRolloverPlan {
  const { predecessor, successor } = source
  const orderedJournals = [...source.journals].sort((a, b) => a.id.localeCompare(b.id))
  const inputFingerprint = digest({ fullSourceDigest: source.fullSourceDigest,
    predecessor, successor,
    payments: [...source.payments].sort((a, b) => a.id.localeCompare(b.id)),
    waivers: [...source.waivers].sort((a, b) => a.id.localeCompare(b.id)),
    rateChanges: [...source.rateChanges].sort((a, b) => a.id.localeCompare(b.id)),
    journals: orderedJournals,
    audits: [...source.audits].sort((a, b) => a.action.localeCompare(b.action) ||
      a.entityId.localeCompare(b.entityId) || a.occurredAt.getTime() - b.occurredAt.getTime()),
  })
  const exceptions: string[] = []
  if (!/^[a-f0-9]{64}$/.test(source.fullSourceDigest)) {
    exceptions.push("Complete source-row digest is missing")
  }
  if (!predecessor.id || !successor.id || predecessor.id === successor.id ||
      predecessor.rolledOverFrom || successor.rolledOverFrom !== predecessor.id ||
      !validDate(predecessor.startDate) || !validDate(successor.startDate) ||
      successor.startDate <= predecessor.startDate ||
      !validDate(predecessor.deletedAt) || !validDate(successor.deletedAt) ||
      successor.deletedAt >= predecessor.deletedAt) {
    exceptions.push("Deleted predecessor and successor chronology is not proven")
  }
  if (source.payments.some((row) => row.deletedAt === null) ||
      source.waivers.some((row) => row.deletedAt === null)) {
    exceptions.push("Deleted chain retains an active payment or waiver")
  }
  if (validDate(predecessor.deletedAt) && validDate(successor.deletedAt) && (
      !hasAudit(source, "loan.rollover", predecessor.id) ||
      !hasAudit(source, "loan.delete", successor.id, successor.deletedAt) ||
      !hasAudit(source, "loan.unroll", predecessor.id, successor.deletedAt) ||
      !hasAudit(source, "loan.delete", predecessor.id, predecessor.deletedAt))) {
    exceptions.push("Deletion or unroll audit sequence is incomplete")
  }
  const rolloverAudits = source.audits.filter((row) =>
    row.action === "loan.rollover" && row.entityId === predecessor.id)
  if (validDate(successor.deletedAt) &&
      (rolloverAudits.length !== 1 || !validDate(rolloverAudits[0].occurredAt) ||
        rolloverAudits[0].occurredAt >= successor.deletedAt)) {
    exceptions.push("Rollover audit does not precede successor deletion")
  }
  const groups = new Map<string, DeletedRolloverJournal[]>()
  for (const row of orderedJournals) {
    if (!row.id || !row.journalGroupId || !validDate(row.createdAt) ||
        !validDate(row.transactionDate) || !amount(row.amount) ||
        CATEGORY_TYPES[row.categoryName] !== row.categoryType ||
        row.loanId && row.loanId !== predecessor.id && row.loanId !== successor.id) {
      exceptions.push(`Journal ${row.id} is malformed or outside the deleted chain`)
      continue
    }
    const group = groups.get(row.journalGroupId) ?? []
    group.push(row)
    groups.set(row.journalGroupId, group)
  }
  if (groups.size === 0 || groups.size !== new Set(orderedJournals.map((row) => row.journalGroupId)).size) {
    exceptions.push("Journal groups are incomplete")
  }
  for (const [groupId, rows] of groups) {
    const debit = rows.filter((row) => row.type === "debit")
      .reduce((sum, row) => sum.plus(row.amount), new BigNumber(0))
    const credit = rows.filter((row) => row.type === "credit")
      .reduce((sum, row) => sum.plus(row.amount), new BigNumber(0))
    if (rows.length < 2 || !debit.eq(credit) || debit.lte(0) ||
        rows.some((row) => row.createdAt.getTime() !== rows[0].createdAt.getTime())) {
      exceptions.push(`Journal group ${groupId} is unbalanced or has mixed posting times`)
    }
  }
  const candidates = [...groups.entries()].filter(([, rows]) =>
    validDate(predecessor.deletedAt) && validDate(successor.startDate) &&
    rows.length === 2 &&
    rows.every((row) => row.loanId === successor.id &&
      row.referenceType === "loan_deletion_reversal" &&
      row.referenceId === predecessor.id &&
      validDate(row.createdAt) && validDate(row.transactionDate) &&
      row.createdAt.getTime() === predecessor.deletedAt!.getTime() &&
      row.transactionDate.getTime() === successor.startDate.getTime()) &&
    rows.some((row) => row.categoryName === "Interest Earned" && row.type === "debit") &&
    rows.some((row) => row.categoryName === "Loans Receivable" && row.type === "credit"))
  if (candidates.length !== 1) {
    exceptions.push("Expected exactly one later non-cash rollover-interest reversal group")
  }
  const candidate = candidates[0]
  if (validDate(successor.deletedAt)) {
    const successorGroupsAfterDeletion = [...groups.entries()].filter(([, rows]) =>
      rows.some((row) => row.loanId === successor.id &&
        row.createdAt > successor.deletedAt!))
    if (successorGroupsAfterDeletion.length !== 1 ||
        successorGroupsAfterDeletion[0][0] !== candidate?.[0]) {
      exceptions.push("Additional successor journal appeared after its deletion")
    }
  }
  const candidateAmount = candidate && amount(candidate[1][0].amount)
  if (candidate && (!candidateAmount ||
      !candidate[1].every((row) => new BigNumber(row.amount).eq(candidateAmount)))) {
    exceptions.push("Later reversal legs do not have the same amount")
  }
  if (candidateAmount && !rolloverAuditMatches(source, candidateAmount)) {
    exceptions.push("Rollover audit successor or carried interest does not match the duplicate")
  }
  const originalCarry = orderedJournals.filter((row) =>
    row.loanId === successor.id && row.referenceType === "rollover" &&
    row.referenceId === predecessor.id && row.categoryName === "Interest Earned" &&
    row.type === "credit" && validDate(row.transactionDate) &&
    validDate(successor.startDate) &&
    row.transactionDate.getTime() === successor.startDate.getTime())
  if (originalCarry.length !== 1 || !candidateAmount ||
      !new BigNumber(originalCarry[0].amount).eq(candidateAmount)) {
    exceptions.push("Duplicate amount does not match the original carried interest")
  } else {
    const originalGroup = groups.get(originalCarry[0].journalGroupId ?? "")
    if (originalGroup?.length !== 2 || !originalGroup.some((row) =>
        row !== originalCarry[0] && row.loanId === successor.id &&
        row.referenceType === "rollover" && row.referenceId === predecessor.id &&
        row.categoryName === "Loans Receivable" && row.type === "debit" &&
        row.transactionDate.getTime() === successor.startDate.getTime() &&
        new BigNumber(row.amount).eq(candidateAmount))) {
      exceptions.push("Original carried interest lacks its receivable debit")
    }
  }
  if (candidateAmount && validDate(successor.deletedAt) &&
      validDate(successor.startDate)) {
    const unrollGroups = [...groups.values()].filter((rows) => rows.length === 2 &&
      rows.every((row) => row.loanId === successor.id &&
        row.referenceType === "loan_deletion_reversal" &&
        row.referenceId === successor.id &&
        row.createdAt.getTime() === successor.deletedAt!.getTime() &&
        row.transactionDate.getTime() === successor.startDate.getTime() &&
        new BigNumber(row.amount).eq(candidateAmount)) &&
      rows.some((row) => row.categoryName === "Interest Earned" && row.type === "debit") &&
      rows.some((row) => row.categoryName === "Loans Receivable" && row.type === "credit"))
    if (unrollGroups.length !== 1) {
      exceptions.push("Successor deletion did not reverse the original carried interest exactly once")
    }
  }
  if (validDate(successor.deletedAt)) {
    for (const category of Object.keys(CATEGORY_TYPES)) {
      if (!net(orderedJournals, successor.id, category, successor.deletedAt).isZero()) {
        exceptions.push(`Successor ${category} was not zero after its deletion`)
      }
    }
  }
  if (validDate(predecessor.deletedAt) && candidateAmount) {
    for (const category of Object.keys(CATEGORY_TYPES)) {
      if (!net(orderedJournals, predecessor.id, category).isZero()) {
        exceptions.push(`Deleted predecessor ${category} has a residual`)
      }
      const expected = category === "Loans Receivable" ? candidateAmount.negated() :
        category === "Interest Earned" ? candidateAmount : new BigNumber(0)
      if (!net(orderedJournals, successor.id, category).eq(expected)) {
        exceptions.push(`Deleted successor ${category} residual is not explained by the duplicate`)
      }
    }
    if (orderedJournals.some((row) => row.createdAt > predecessor.deletedAt!)) {
      exceptions.push("Deleted chain has a later journal")
    }
  }
  const common: Omit<BasePlan, "planHash"> = {
    predecessorId: predecessor.id, successorId: successor.id,
    policyVersion: DELETED_ROLLOVER_LEDGER_POLICY, inputFingerprint, exceptions }
  if (exceptions.length || !candidate || !candidateAmount) {
    return { ...common, classification: "blocked", sourceGroupId: null,
      effectiveDate: null, legs: [], planHash: digest({ ...common, classification: "blocked" }) }
  }
  const legs: [Leg, Leg] = [
    { category: "Loans Receivable", type: "debit", amount: candidateAmount.toFixed(2) },
    { category: "Interest Earned", type: "credit", amount: candidateAmount.toFixed(2) },
  ]
  const ready = { ...common, classification: "ready" as const,
    sourceGroupId: candidate[0], effectiveDate: candidate[1][0].transactionDate, legs }
  return { ...ready, planHash: digest(ready) }
}
