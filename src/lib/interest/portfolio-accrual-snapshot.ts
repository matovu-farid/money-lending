import { createHash } from "node:crypto"

type LoanPeriodSource = {
  id: string
  startDate: Date
  plan: {
    loanId: string
    asOf: Date
    classification: "ready" | "noop" | "blocked"
    inputFingerprint: string
    planHash: string
    entries: Array<{ date: Date }>
  }
}

/** A saved period can be republished only after every effective loan is reconciled. */
export function assessPortfolioSnapshotPeriod(
  periodEnd: Date,
  sources: LoanPeriodSource[],
): {
  eligible: boolean
  blockedLoanIds: string[]
  pendingLoanIds: string[]
  previewStale: boolean
  sourceHash: string
} {
  const relevant = [...sources].filter((source) => source.startDate <= periodEnd)
    .sort((a, b) => a.id.localeCompare(b.id))
  const blockedLoanIds: string[] = []
  const pendingLoanIds: string[] = []
  let previewStale = false
  for (const source of relevant) {
    if (source.plan.asOf < periodEnd) previewStale = true
    if (source.plan.loanId !== source.id || source.plan.classification === "blocked") {
      blockedLoanIds.push(source.id)
    } else if (source.plan.entries.some((entry) => entry.date <= periodEnd)) {
      pendingLoanIds.push(source.id)
    }
  }
  const sourceHash = createHash("sha256").update(JSON.stringify({ periodEnd,
    sources: relevant.map((source) => ({ id: source.id,
      startDate: source.startDate, asOf: source.plan.asOf,
      inputFingerprint: source.plan.inputFingerprint,
      planHash: source.plan.planHash })) })).digest("hex")
  return { eligible: !previewStale && blockedLoanIds.length === 0 &&
    pendingLoanIds.length === 0, blockedLoanIds, pendingLoanIds,
  previewStale, sourceHash }
}
