import BigNumber from "bignumber.js"
import { PENALTY_THRESHOLD_DAYS } from "@/lib/interest/effective-rate"
import { planHistoricalRateRepair, type HistoricalRatePlan,
  type HistoricalRateSnapshot } from "@/lib/interest/historical-rate-repair"

const DAY_MS = 86_400_000
const Decimal = BigNumber.clone({ DECIMAL_PLACES: 20, ROUNDING_MODE: BigNumber.ROUND_HALF_UP })

export type HistoricalRateEvidence = {
  loanId: string
  asOf: string
  allocations: Array<{ id: string; kind: "payment" | "waiver"; date: string;
    amount: string; interest: string; principal: string; overpayment: string }>
  accruedInterest: string
  endingPrincipal: string
  accrualJournalTarget: string
  accrualJournalDelta: string
  checkedSettlementCount: number
  checkedPriorJournalCount: number
  checkedJournalGroupCount: number
  expectedEntries: Array<{ categoryName: string; type: "debit" | "credit";
    amount: string; referenceType: string; referenceId: string; date: string }>
}

function whole(value: BigNumber): BigNumber {
  return new Decimal(value.toFixed(0, BigNumber.ROUND_HALF_UP))
}

function eqMoney(a: string | null, b: string): boolean {
  return a !== null && new Decimal(a).eq(b)
}

export function normalizedHistoricalJournalEffects(
  rows: HistoricalRateEvidence["expectedEntries"],
): HistoricalRateEvidence["expectedEntries"] {
  return [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

function appendEffect(entries: HistoricalRateEvidence["expectedEntries"],
  categoryName: string, signedCredit: BigNumber, referenceType: string,
  referenceId: string, date: Date): void {
  if (signedCredit.isZero()) return
  entries.push({ categoryName, type: signedCredit.gt(0) ? "credit" : "debit",
    amount: signedCredit.abs().toFixed(2), referenceType, referenceId,
    date: date.toISOString() })
}

function net(rows: HistoricalRateSnapshot["journalLegs"], positive: "debit" | "credit") {
  return rows.reduce((sum, row) => row.type === positive
    ? sum.plus(row.amount) : sum.minus(row.amount), new Decimal(0))
}

type ReceiptJournalLeg = HistoricalRateSnapshot["journalLegs"][number] & {
  depositLocation?: string | null
  subLocationId?: string | null
}

/** Excluded receipts must have their original posting fully and faithfully reversed. */
export function verifyExcludedHistoricalReceipt(receipt: {
  id: string; loanId: string; date: Date; amount: string;
  depositLocation: string | null; subLocationId: string | null
}, rows: ReceiptJournalLeg[]): void {
  const legs = rows.filter((row) => row.referenceId === receipt.id)
  const amount = new Decimal(receipt.amount)
  if (!legs.length || !amount.isFinite() || amount.lte(0)) {
    throw new Error(`Excluded receipt ${receipt.id} lacks a valid journal`)
  }
  const accounts = new Set(["Cash", "Interest Earned", "Loans Receivable",
    "Overpayment Revenue"])
  for (const leg of legs) {
    const original = leg.referenceType === "payment"
    const reversal = leg.referenceType === "payment_reversal"
    const isCash = leg.categoryName === "Cash"
    if ((!original && !reversal) || !accounts.has(leg.categoryName) ||
        leg.loanId !== receipt.loanId && !(isCash && leg.loanId === null) ||
        leg.date.getTime() !== receipt.date.getTime() ||
        leg.type !== (isCash ? original ? "debit" : "credit"
          : original ? "credit" : "debit") ||
        (isCash && (leg.depositLocation !== receipt.depositLocation ||
          (leg.subLocationId ?? null) !== receipt.subLocationId))) {
      throw new Error(`Excluded receipt ${receipt.id} has invalid journal attribution or location`)
    }
  }
  const total = (referenceType: string, categoryName: string) => legs
    .filter((leg) => leg.referenceType === referenceType &&
      leg.categoryName === categoryName)
    .reduce((sum, leg) => sum.plus(leg.amount), new Decimal(0))
  if (!total("payment", "Cash").eq(amount) ||
      !total("payment_reversal", "Cash").eq(amount)) {
    throw new Error(`Excluded receipt ${receipt.id} cash was not fully reversed`)
  }
  let allocated = new Decimal(0)
  for (const account of ["Interest Earned", "Loans Receivable",
    "Overpayment Revenue"]) {
    const original = total("payment", account)
    if (!original.eq(total("payment_reversal", account))) {
      throw new Error(`Excluded receipt ${receipt.id} ${account} was not fully reversed`)
    }
    allocated = allocated.plus(original)
  }
  if (!allocated.eq(amount)) {
    throw new Error(`Excluded receipt ${receipt.id} original allocation differs from receipt`)
  }
}

/** A deleted waiver must undo its loss, allocation, and any accrual reversal. */
export function verifyExcludedHistoricalWaiver(waiver: {
  id: string; loanId: string; date: Date; deletedAt: Date; amount: string
}, rows: ReceiptJournalLeg[]): void {
  const legs = rows.filter((row) => row.referenceId === waiver.id)
  const amount = new Decimal(waiver.amount)
  if (!legs.length || !amount.isFinite() || amount.lte(0)) {
    throw new Error(`Excluded waiver ${waiver.id} lacks a valid journal`)
  }
  const shapes = new Set([
    "loan_waiver:Loan Losses:debit", "loan_waiver:Interest Earned:credit",
    "loan_waiver:Loans Receivable:credit",
    "loan_waiver_accrual_reversal:Interest Receivable:credit",
    "loan_waiver_accrual_reversal:Interest Earned:debit",
    "loan_waiver_reversal:Loan Losses:credit",
    "loan_waiver_reversal:Interest Earned:debit",
    "loan_waiver_reversal:Loans Receivable:debit",
    "loan_waiver_reversal:Interest Receivable:debit",
    "loan_waiver_reversal:Interest Earned:credit",
  ])
  for (const leg of legs) {
    const shape = `${leg.referenceType}:${leg.categoryName}:${leg.type}`
    const isReversal = leg.referenceType === "loan_waiver_reversal"
    const nullableLoan = isReversal && (leg.categoryName === "Interest Receivable" ||
      leg.categoryName === "Interest Earned" && leg.type === "credit")
    if (!shapes.has(shape) ||
        leg.loanId !== waiver.loanId && !(nullableLoan && leg.loanId === null) ||
        leg.date.getTime() !== (isReversal ? waiver.deletedAt : waiver.date).getTime()) {
      throw new Error(`Excluded waiver ${waiver.id} has invalid journal attribution or date`)
    }
  }
  const total = (referenceType: string, categoryName: string, type: "debit" | "credit") =>
    legs.filter((leg) => leg.referenceType === referenceType &&
      leg.categoryName === categoryName && leg.type === type)
      .reduce((sum, leg) => sum.plus(leg.amount), new Decimal(0))
  const originalLoss = total("loan_waiver", "Loan Losses", "debit")
  const originalInterest = total("loan_waiver", "Interest Earned", "credit")
  const originalPrincipal = total("loan_waiver", "Loans Receivable", "credit")
  const accrualReversal = total("loan_waiver_accrual_reversal",
    "Interest Receivable", "credit")
  if (!originalLoss.eq(amount) ||
      !total("loan_waiver_reversal", "Loan Losses", "credit").eq(amount) ||
      !originalInterest.plus(originalPrincipal).eq(amount) ||
      !total("loan_waiver_reversal", "Interest Earned", "debit")
        .eq(originalInterest) ||
      !total("loan_waiver_reversal", "Loans Receivable", "debit")
        .eq(originalPrincipal) ||
      !total("loan_waiver_accrual_reversal", "Interest Earned", "debit")
        .eq(accrualReversal) ||
      !total("loan_waiver_reversal", "Interest Receivable", "debit")
        .eq(accrualReversal) ||
      !total("loan_waiver_reversal", "Interest Earned", "credit")
        .eq(accrualReversal)) {
    throw new Error(`Excluded waiver ${waiver.id} was not fully reversed`)
  }
}

function verifySourceJournals(snapshot: HistoricalRateSnapshot): number {
  const groups = new Map<string, HistoricalRateSnapshot["journalLegs"]>()
  for (const leg of snapshot.journalLegs) {
    const amount = new Decimal(leg.amount)
    if (!leg.journalGroupId || !amount.isFinite() || amount.lt(0) ||
        amount.decimalPlaces()! > 2 || !Number.isFinite(leg.date.getTime())) {
      throw new Error(`Historical journal ${leg.id} is invalid`)
    }
    const group = groups.get(leg.journalGroupId) ?? []
    group.push(leg)
    groups.set(leg.journalGroupId, group)
  }
  for (const [id, group] of groups) {
    if (group.length < 2 || !net(group, "debit").isZero()) {
      throw new Error(`Historical journal group ${id} is unbalanced`)
    }
  }
  for (const event of snapshot.settlements) {
    const kinds = event.kind === "payment"
      ? ["payment", "payment_reversal"]
      : ["loan_waiver", "loan_waiver_reversal"]
    const rows = snapshot.journalLegs.filter((row) =>
      row.referenceId === event.id && kinds.includes(row.referenceType ?? ""))
    if (!rows.length || rows.some((row) => row.loanId !== snapshot.loan.id &&
        !(event.kind === "payment" && row.categoryName === "Cash" && row.loanId === null))) {
      throw new Error(`Settlement ${event.id} journal attribution is missing or cross-loan`)
    }
    const cashOrLoss = event.kind === "payment" ? "Cash" : "Loan Losses"
    const collection = rows.filter((row) => row.categoryName === cashOrLoss)
    const atEvent = collection.filter((row) => row.date.getTime() === event.date.getTime())
    const offDate = collection.filter((row) => row.date.getTime() !== event.date.getTime())
    if (!net(atEvent, "debit").eq(event.amount) || !net(offDate, "debit").isZero()) {
      throw new Error(`Settlement ${event.id} cash or waiver-loss journal does not match source`)
    }
    const expected = [
      ["Interest Earned", event.oldInterest],
      ["Loans Receivable", event.oldPrincipal],
      ["Overpayment Revenue", event.oldOverpayment],
    ] as const
    for (const [name, amount] of expected) {
      const legs = rows.filter((row) => row.categoryName === name)
      if (!net(legs, "credit").eq(amount)) {
        throw new Error(`Settlement ${event.id} old allocation disagrees with journal ${name}`)
      }
    }
    const permitted = new Set([cashOrLoss, ...expected.map(([name]) => name)])
    if (rows.some((row) => !permitted.has(row.categoryName))) {
      throw new Error(`Settlement ${event.id} journal has an unexpected account`)
    }
  }
  const settlementIds = new Set(snapshot.settlements.map((event) => event.id))
  const excludedJournalRefs = new Map<string, HistoricalRateSnapshot["journalLegs"]>()
  const settlementTypes = new Set(["payment", "payment_reversal", "loan_waiver",
    "loan_waiver_reversal", "loan_waiver_accrual_reversal"])
  for (const leg of snapshot.journalLegs) {
    if (!leg.referenceId || !settlementTypes.has(leg.referenceType ?? "") ||
        settlementIds.has(leg.referenceId)) continue
    const rows = excludedJournalRefs.get(leg.referenceId) ?? []
    rows.push(leg)
    excludedJournalRefs.set(leg.referenceId, rows)
  }
  for (const [referenceId, rows] of excludedJournalRefs) {
    for (const account of new Set(rows.map((row) => row.categoryName))) {
      if (!net(rows.filter((row) => row.categoryName === account), "debit").isZero()) {
        throw new Error(`Excluded settlement ${referenceId} has unreconciled ${account} journals`)
      }
    }
  }
  const receivable = snapshot.journalLegs.filter((row) =>
    row.categoryName === "Interest Receivable" && row.date <= snapshot.asOf &&
    (row.loanId === snapshot.loan.id || row.referenceId === snapshot.loan.id ||
      settlementIds.has(row.referenceId ?? "")))
  if (!net(receivable, "debit").eq(snapshot.postedAccrual ?? "NaN")) {
    throw new Error("Posted accrual does not match independently checked receivable journals")
  }
  for (const leg of receivable) {
    const group = groups.get(leg.journalGroupId!) ?? []
    if (group.length !== 2 || !group.some((row) =>
      row.id !== leg.id && row.categoryName === "Interest Earned" &&
      row.loanId === snapshot.loan.id && row.type !== leg.type &&
      new Decimal(row.amount).eq(leg.amount) &&
      row.date.getTime() === leg.date.getTime())) {
      throw new Error(`Interest Receivable journal ${leg.id} lacks a balanced counterpart`)
    }
  }
  return groups.size
}

/** Recalculate from dated receipts and original terms, without using proposal allocations. */
export function verifyHistoricalRateEvidence(
  snapshot: HistoricalRateSnapshot,
  plan: HistoricalRatePlan,
): HistoricalRateEvidence {
  const current = planHistoricalRateRepair(snapshot, plan.policyVersion)
  if (snapshot.sourceExceptions.length || current.classification !== "review" ||
      plan.classification !== "review" || !snapshot.postedAccrual ||
      snapshot.loan.rolledOverFrom || snapshot.loan.penaltyWaived && !snapshot.loan.penaltyWaivedAt) {
    throw new Error("Only a source-reconciled reviewable historical rate plan can be checked")
  }
  if (plan.loanId !== snapshot.loan.id || plan.asOf.getTime() !== snapshot.asOf.getTime() ||
      plan.planHash !== current.planHash ||
      plan.inputFingerprint !== current.inputFingerprint ||
      plan.policyVersion !== current.policyVersion) {
    throw new Error("Historical rate proposal identity or source fingerprint changed")
  }
  const checkedJournalGroupCount = verifySourceJournals(snapshot)
  const events = [...snapshot.settlements].sort((a, b) =>
    a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id))
  const opening = new Decimal(snapshot.loan.principalAmount)
  const baseRate = new Decimal(snapshot.correctedRate)
  const multiplier = new Decimal(snapshot.loan.penaltyMultiplier ?? "0.1000")
  const minimumDays = snapshot.loan.minPeriodOverride ?? snapshot.loan.minInterestDays
  let principal = opening
  let accrued = new Decimal(0)
  let settled = new Decimal(0)
  let nextEvent = 0
  const allocations: HistoricalRateEvidence["allocations"] = []
  const days = Math.max(0, Math.floor((snapshot.asOf.getTime() -
    snapshot.loan.startDate.getTime()) / DAY_MS))
  for (let day = 1; day <= days; day++) {
    const date = new Date(snapshot.loan.startDate.getTime() + day * DAY_MS)
    const dailyBase = principal.multipliedBy(baseRate).dividedBy(30)
    const overdue = dailyBase.isZero() ? 0 : Math.floor(Decimal.max(
      accrued.minus(settled), 0).dividedBy(dailyBase).toNumber())
    const penalty = overdue >= PENALTY_THRESHOLD_DAYS &&
      !(snapshot.loan.penaltyWaived && snapshot.loan.penaltyWaivedAt! <= date)
    const rate = penalty ? baseRate.plus(baseRate.multipliedBy(multiplier)) : baseRate
    accrued = accrued.plus(principal.multipliedBy(rate).dividedBy(30))
    while (nextEvent < events.length && Math.floor((events[nextEvent].date.getTime() -
        snapshot.loan.startDate.getTime()) / DAY_MS) <= day) {
      const event = events[nextEvent++]
      const amount = new Decimal(event.amount)
      const minimumDue = opening.multipliedBy(rate).multipliedBy(minimumDays).dividedBy(30)
      const due = whole(Decimal.max(accrued.minus(settled),
        minimumDue.minus(settled), 0))
      const interest = Decimal.min(amount, due)
      const principalPortion = Decimal.min(amount.minus(interest), principal)
      const overpayment = amount.minus(interest).minus(principalPortion)
      if (event.kind === "waiver" && !overpayment.isZero()) {
        throw new Error(`Waiver ${event.id} exceeds independently calculated amount due`)
      }
      const oldTotal = new Decimal(event.oldInterest).plus(event.oldPrincipal)
        .plus(event.oldOverpayment)
      const newTotal = interest.plus(principalPortion).plus(overpayment)
      if (!oldTotal.eq(newTotal) || !newTotal.eq(amount)) {
        throw new Error(`Settlement ${event.id} proposed non-cash reclassification is unbalanced`)
      }
      principal = principal.minus(principalPortion)
      settled = settled.plus(interest)
      allocations.push({ id: event.id, kind: event.kind, date: event.date.toISOString(),
        amount: event.amount, interest: interest.toFixed(2),
        principal: principalPortion.toFixed(2), overpayment: overpayment.toFixed(2) })
    }
  }
  const roundedAccrued = whole(accrued)
  const target = Decimal.max(roundedAccrued.minus(settled), 0)
  const delta = target.minus(snapshot.postedAccrual)
  const expectedEntries: HistoricalRateEvidence["expectedEntries"] = []
  for (const row of allocations) {
    const old = events.find((event) => event.id === row.id)!
    const referenceType = row.kind === "payment" ? "payment" : "loan_waiver"
    const at = new Date(row.date)
    appendEffect(expectedEntries, "Interest Earned",
      new Decimal(row.interest).minus(old.oldInterest), referenceType, row.id, at)
    appendEffect(expectedEntries, "Loans Receivable",
      new Decimal(row.principal).minus(old.oldPrincipal), referenceType, row.id, at)
    appendEffect(expectedEntries, "Overpayment Revenue",
      new Decimal(row.overpayment).minus(old.oldOverpayment), referenceType, row.id, at)
  }
  if (!delta.isZero()) {
    appendEffect(expectedEntries, "Interest Receivable", delta.negated(),
      "interest_accrual", snapshot.loan.id, snapshot.asOf)
    appendEffect(expectedEntries, "Interest Earned", delta,
      "interest_accrual", snapshot.loan.id, snapshot.asOf)
  }
  const evidence: HistoricalRateEvidence = { loanId: snapshot.loan.id,
    asOf: snapshot.asOf.toISOString(), allocations,
    accruedInterest: roundedAccrued.toFixed(0), endingPrincipal: principal.toFixed(0),
    accrualJournalTarget: target.toFixed(2), accrualJournalDelta: delta.toFixed(2),
    checkedSettlementCount: events.length,
    checkedPriorJournalCount: snapshot.journalLegs.length, checkedJournalGroupCount,
    expectedEntries: normalizedHistoricalJournalEffects(expectedEntries) }
  if (allocations.length !== plan.changes.length || allocations.some((row, index) => {
    const proposed = plan.changes[index]
    return !proposed || row.id !== proposed.id || row.kind !== proposed.kind ||
      row.date !== proposed.date.toISOString() || !eqMoney(row.amount, proposed.amount) ||
      !eqMoney(row.interest, proposed.newInterest) ||
      !eqMoney(row.principal, proposed.newPrincipal) ||
      !eqMoney(row.overpayment, proposed.newOverpayment) ||
      !new Decimal(proposed.newInterest).plus(proposed.newPrincipal)
        .plus(proposed.newOverpayment).eq(proposed.amount)
  }) || !eqMoney(plan.accruedInterest, evidence.accruedInterest) ||
      !eqMoney(plan.endingPrincipal, evidence.endingPrincipal) ||
      !eqMoney(plan.accrualJournalTarget, evidence.accrualJournalTarget) ||
      !eqMoney(plan.accrualJournalDelta, evidence.accrualJournalDelta)) {
    throw new Error("Historical rate proposal differs from independent dated replay")
  }
  return evidence
}
