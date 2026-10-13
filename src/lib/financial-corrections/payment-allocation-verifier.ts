import BigNumber from "bignumber.js"
import { planFullyPaidAllocationRepair, type FullyPaidAllocationPlan,
  type FullyPaidAllocationSnapshot, type JournalEffect,
  type ReviewedCorrectionEvidence, type ReviewedCorrectionGroup } from
  "@/lib/interest/fully-paid-allocation-repair"

/** Check a fresh source snapshot and derive the evidence stored by the separate agent. */
export function verifyFullyPaidAllocationEvidence(
  snapshot: FullyPaidAllocationSnapshot,
  reviewed: FullyPaidAllocationPlan,
): ReviewedCorrectionEvidence {
  const current = planFullyPaidAllocationRepair(snapshot)
  if (current.status !== "ready" || reviewed.status !== "ready" ||
      current.planHash !== reviewed.planHash ||
      current.sourceFingerprint !== reviewed.sourceFingerprint ||
      current.policyVersion !== reviewed.policyVersion ||
      current.loanId !== reviewed.loanId || current.asOf !== reviewed.asOf ||
      snapshot.correctionProof !== null || snapshot.extraPaymentJournals.length ||
      snapshot.sourceExceptions.length || !/^[a-f0-9]{64}$/.test(snapshot.sourceDigest) ||
      current.finalPrincipal !== "0.00") {
    throw new Error("Only an unchanged, source-reconciled fully-paid allocation plan can be reviewed")
  }
  const entries = new Map<string, JournalEffect[]>()
  for (const effect of current.effects) {
    const rows = entries.get(effect.paymentId) ?? []
    rows.push(effect)
    entries.set(effect.paymentId, rows)
  }
  const expectedGroups: ReviewedCorrectionGroup[] = []
  for (const allocation of current.allocations) {
    const rows = entries.get(allocation.paymentId) ?? []
    if (!rows.length) continue
    if (rows.length < 2 || rows.length > 3 ||
        rows.some((row) => row.effectiveAt !== allocation.effectiveAt) ||
        new Set(rows.map((row) => row.account)).size !== rows.length) {
      throw new Error("Reviewed payment has an incomplete or duplicate journal effect")
    }
    const signed = rows.reduce((sum, row) => sum.plus(row.side === "debit"
      ? row.amount : `-${row.amount}`), new BigNumber(0))
    if (!signed.isZero()) throw new Error("Reviewed payment journal group is not balanced")
    for (const [account, before, after] of [
      ["Interest Earned", allocation.before.interest, allocation.after.interest],
      ["Loans Receivable", allocation.before.principal, allocation.after.principal],
      ["Overpayment Revenue", allocation.before.overpayment, allocation.after.overpayment],
    ] as const) {
      const delta = new BigNumber(after).minus(before)
      const matching = rows.filter((row) => row.account === account)
      if (delta.isZero() ? matching.length !== 0 : matching.length !== 1 ||
          matching[0].side !== (delta.gt(0) ? "credit" : "debit") ||
          !new BigNumber(matching[0].amount).eq(delta.abs())) {
        throw new Error(`Reviewed ${account} effect differs from payment replay`)
      }
    }
    expectedGroups.push({ paymentId: allocation.paymentId,
      effectiveAt: allocation.effectiveAt,
      entries: rows.map((row) => ({ account: row.account,
        side: row.side, amount: row.amount })) })
  }
  if (expectedGroups.length !== entries.size || !expectedGroups.length) {
    throw new Error("Reviewed journal groups do not cover the changed payments")
  }
  return { kind: "fully-paid-allocation-repair", loanId: current.loanId,
    reviewedAsOf: current.asOf, preapplySourceDigest: snapshot.sourceDigest,
    expectedGroups }
}
