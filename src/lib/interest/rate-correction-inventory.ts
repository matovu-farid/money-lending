export type RateCorrectionInventoryRow = {
  loanId: string
  startDate: Date
  status: string
  action: string
  afterValue: string | null
  paymentRecorded: boolean
  waiverRecorded: boolean
  successorRecorded: boolean
}

export type RateCorrectionInventorySummary = {
  appliedAudits: number
  markedCorrections: number
  invalidMarkedCorrections: number
  unmarkedAppliedAudits: number
  loansWithUnmarkedAudits: number
  legacyLoansByLock: { eligible: number; payment: number; waiver: number; rollover: number }
}

export function summarizeRateCorrectionInventory(
  rows: RateCorrectionInventoryRow[],
): RateCorrectionInventorySummary {
  const summary: RateCorrectionInventorySummary = {
    appliedAudits: 0,
    markedCorrections: 0,
    invalidMarkedCorrections: 0,
    unmarkedAppliedAudits: 0,
    loansWithUnmarkedAudits: 0,
    legacyLoansByLock: { eligible: 0, payment: 0, waiver: 0, rollover: 0 },
  }
  const legacyLoans = new Map<string, keyof RateCorrectionInventorySummary["legacyLoansByLock"]>()
  for (const row of rows) {
    let after: Record<string, unknown> | null = null
    if (row.afterValue) {
      try {
        const parsed: unknown = JSON.parse(row.afterValue)
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          after = parsed as Record<string, unknown>
        }
      } catch {
        // Malformed applied audits remain legacy records requiring review.
      }
    }
    if (row.action === "loan.update" &&
        !Object.hasOwn(after ?? {}, "interestRate") &&
        !Object.hasOwn(after ?? {}, "interestRateOverride")) continue
    summary.appliedAudits++
    if (after?.rateSemantics === "correction") {
      if (after.effectiveFrom === row.startDate.toISOString()) {
        summary.markedCorrections++
      } else {
        summary.invalidMarkedCorrections++
      }
      continue
    }
    summary.unmarkedAppliedAudits++
    const reason = rateCorrectionLockReason({
      paymentRecorded: row.paymentRecorded,
      waiverRecorded: row.waiverRecorded,
      rolledOver: row.status === "rolled_over",
      successorRecorded: row.successorRecorded,
    })
    legacyLoans.set(row.loanId, reason ?? "eligible")
  }
  summary.loansWithUnmarkedAudits = legacyLoans.size
  for (const reason of legacyLoans.values()) summary.legacyLoansByLock[reason]++
  return summary
}
import { rateCorrectionLockReason } from "./rate-correction-policy"
