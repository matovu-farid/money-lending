import { describe, expect, it } from "vitest"
import { planHistoricalRateRepair, type HistoricalRateSnapshot } from
  "@/lib/interest/historical-rate-repair"
import { verifyExcludedHistoricalReceipt, verifyExcludedHistoricalWaiver,
  verifyHistoricalRateEvidence } from "../historical-rate-verifier"

const day = (value: string) => new Date(`${value}T00:00:00.000Z`)

function source(): HistoricalRateSnapshot {
  return {
    loan: { id: "loan", principalAmount: "30000", interestRate: "0.10",
      interestRateOverride: "0.15", penaltyMultiplier: "0.10",
      penaltyWaived: false, penaltyWaivedAt: null, penaltyWaivedBy: null,
      minInterestDays: 30, minPeriodOverride: null, rolledOverFrom: null,
      issuanceFee: "0", loanType: "perpetual", startDate: day("2026-01-01"),
      createdAt: day("2026-03-01") },
    correctedRate: "0.15", asOf: day("2026-02-10"), sourceDigest: "a".repeat(64),
    sourceExceptions: [], postedAccrual: "0", journalLegs: [
      { id: "cash-one", loanId: "loan", journalGroupId: "group-one", referenceType: "payment",
        referenceId: "one", date: day("2026-01-11"), categoryName: "Cash",
        type: "debit", amount: "5000" },
      { id: "interest-one", loanId: "loan", journalGroupId: "group-one", referenceType: "payment",
        referenceId: "one", date: day("2026-01-11"), categoryName: "Interest Earned",
        type: "credit", amount: "3000" },
      { id: "principal-one", loanId: "loan", journalGroupId: "group-one", referenceType: "payment",
        referenceId: "one", date: day("2026-01-11"), categoryName: "Loans Receivable",
        type: "credit", amount: "2000" },
      { id: "cash-two", loanId: "loan", journalGroupId: "group-two", referenceType: "payment",
        referenceId: "two", date: day("2026-02-10"), categoryName: "Cash",
        type: "debit", amount: "5000" },
      { id: "interest-two", loanId: "loan", journalGroupId: "group-two", referenceType: "payment",
        referenceId: "two", date: day("2026-02-10"), categoryName: "Interest Earned",
        type: "credit", amount: "800" },
      { id: "principal-two", loanId: "loan", journalGroupId: "group-two", referenceType: "payment",
        referenceId: "two", date: day("2026-02-10"), categoryName: "Loans Receivable",
        type: "credit", amount: "4200" },
    ], settlements: [
      { id: "one", kind: "payment", date: day("2026-01-11"), amount: "5000",
        oldInterest: "3000", oldPrincipal: "2000", oldOverpayment: "0" },
      { id: "two", kind: "payment", date: day("2026-02-10"), amount: "5000",
        oldInterest: "800", oldPrincipal: "4200", oldOverpayment: "0" },
    ],
  }
}

function syncJournalLegs(snapshot: HistoricalRateSnapshot): void {
  snapshot.journalLegs = snapshot.settlements.flatMap((event) => {
    const group = `group-${event.id}`
    const common = { loanId: snapshot.loan.id, journalGroupId: group, referenceType: event.kind === "payment"
      ? "payment" : "loan_waiver", referenceId: event.id, date: event.date }
    const legs: HistoricalRateSnapshot["journalLegs"] = []
    if (event.kind === "payment") legs.push({ ...common,
      id: `cash-${event.id}`, categoryName: "Cash", type: "debit", amount: event.amount })
    else legs.push({ ...common, id: `loss-${event.id}`, categoryName: "Loan Losses",
      type: "debit", amount: event.amount })
    for (const [name, amount] of [["Interest Earned", event.oldInterest],
      ["Loans Receivable", event.oldPrincipal],
      ["Overpayment Revenue", event.oldOverpayment]] as const) {
      if (amount !== "0") legs.push({ ...common, id: `${name}-${event.id}`,
        categoryName: name, type: "credit", amount })
    }
    return legs
  })
}

describe("independent historical rate evidence", () => {
  it("checks dated interest-first allocations and final accrual from source facts", () => {
    const snapshot = source()
    const plan = planHistoricalRateRepair(snapshot)
    const evidence = verifyHistoricalRateEvidence(snapshot, plan)
    expect(evidence.allocations.map((row) => [row.interest, row.principal])).toEqual([
      ["4500.00", "500.00"], ["1425.00", "3575.00"],
    ])
    expect(evidence.endingPrincipal).toBe("25925")
    expect(evidence.accrualJournalTarget).toBe("0.00")
    expect(evidence.expectedEntries).toHaveLength(4)
    expect(evidence.expectedEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ categoryName: "Interest Earned", type: "credit",
        amount: "1500.00", referenceId: "one" }),
      expect.objectContaining({ categoryName: "Loans Receivable", type: "debit",
        amount: "1500.00", referenceId: "one" }),
    ]))
  })

  it("rejects a mutated proposed settlement", () => {
    const snapshot = source()
    const plan = planHistoricalRateRepair(snapshot)
    plan.changes[0].newInterest = "4499.00"
    expect(() => verifyHistoricalRateEvidence(snapshot, plan)).toThrow(/independent|proposal/i)
  })

  it("rejects a mutated journal target", () => {
    const snapshot = source()
    const plan = planHistoricalRateRepair(snapshot)
    plan.accrualJournalTarget = "1.00"
    expect(() => verifyHistoricalRateEvidence(snapshot, plan)).toThrow(/independent|proposal/i)
  })

  it("rejects a cash leg that no longer agrees with its immutable receipt", () => {
    const snapshot = source()
    snapshot.journalLegs[0].amount = "4999"
    expect(() => verifyHistoricalRateEvidence(snapshot,
      planHistoricalRateRepair(snapshot))).toThrow(/cash|journal/i)
  })

  it("rejects a balanced cash-and-revenue journal for a receipt absent from active settlements", () => {
    const snapshot = source()
    snapshot.journalLegs.push(
      { id: "excluded-cash", loanId: "loan", journalGroupId: "excluded-group",
        referenceType: "payment", referenceId: "excluded", date: day("2026-01-15"),
        categoryName: "Cash", type: "debit", amount: "100" },
      { id: "excluded-interest", loanId: "loan", journalGroupId: "excluded-group",
        referenceType: "payment", referenceId: "excluded", date: day("2026-01-15"),
        categoryName: "Interest Earned", type: "credit", amount: "100" },
    )
    expect(() => verifyHistoricalRateEvidence(snapshot,
      planHistoricalRateRepair(snapshot))).toThrow(/excluded|unreconciled|receipt/i)
  })

  it("accepts a deleted receipt only when each original account has a matching reversal", () => {
    const date = day("2026-01-15")
    const base = { loanId: "loan", referenceId: "excluded", date,
      depositLocation: "cash", subLocationId: null }
    const legs = [
      { ...base, id: "cash-in", journalGroupId: "in", referenceType: "payment",
        categoryName: "Cash", type: "debit", amount: "100" },
      { ...base, id: "revenue-in", journalGroupId: "in", referenceType: "payment",
        categoryName: "Interest Earned", type: "credit", amount: "100" },
      { ...base, id: "cash-out", journalGroupId: "out", referenceType: "payment_reversal",
        categoryName: "Cash", type: "credit", amount: "100" },
      { ...base, id: "revenue-out", journalGroupId: "out", referenceType: "payment_reversal",
        categoryName: "Interest Earned", type: "debit", amount: "100" },
    ] as const
    const receipt = { id: "excluded", loanId: "loan", date, amount: "100",
      depositLocation: "cash", subLocationId: null }
    expect(() => verifyExcludedHistoricalReceipt(receipt, [...legs])).not.toThrow()
    expect(() => verifyExcludedHistoricalReceipt(receipt, legs.slice(0, 2)))
      .toThrow(/excluded|reversal|receipt/i)
    expect(() => verifyExcludedHistoricalReceipt(receipt,
      legs.map((leg) => leg.id === "cash-out"
        ? { ...leg, depositLocation: "bank" } : leg)))
      .toThrow(/location|receipt/i)
  })

  it("requires a deleted waiver's loss and interest journals to reverse in full", () => {
    const date = day("2026-01-15")
    const deletedAt = day("2026-02-01")
    const base = { loanId: "loan", referenceId: "excluded-waiver" }
    const legs = [
      { ...base, id: "loss-in", journalGroupId: "waiver-in", referenceType: "loan_waiver",
        date, categoryName: "Loan Losses", type: "debit", amount: "100" },
      { ...base, id: "interest-in", journalGroupId: "waiver-in", referenceType: "loan_waiver",
        date, categoryName: "Interest Earned", type: "credit", amount: "100" },
      { ...base, id: "loss-out", journalGroupId: "waiver-out", referenceType: "loan_waiver_reversal",
        date: deletedAt, categoryName: "Loan Losses", type: "credit", amount: "100" },
      { ...base, id: "interest-out", journalGroupId: "waiver-out",
        referenceType: "loan_waiver_reversal", date: deletedAt,
        categoryName: "Interest Earned", type: "debit", amount: "100" },
    ] as const
    const waiver = { id: "excluded-waiver", loanId: "loan", date, deletedAt,
      amount: "100" }
    expect(() => verifyExcludedHistoricalWaiver(waiver, [...legs])).not.toThrow()
    expect(() => verifyExcludedHistoricalWaiver(waiver, legs.slice(0, 2)))
      .toThrow(/excluded|waiver|reversal/i)
  })

  it("accepts a deleted waiver that also restores its prior accrual reversal", () => {
    const date = day("2026-01-15")
    const deletedAt = day("2026-02-01")
    const base = { loanId: "loan", referenceId: "excluded-waiver" }
    const legs = [
      { ...base, id: "loss-in", journalGroupId: "waiver-in", referenceType: "loan_waiver",
        date, categoryName: "Loan Losses", type: "debit", amount: "100" },
      { ...base, id: "interest-in", journalGroupId: "waiver-in", referenceType: "loan_waiver",
        date, categoryName: "Interest Earned", type: "credit", amount: "100" },
      { ...base, id: "receivable-out", journalGroupId: "accrual-out",
        referenceType: "loan_waiver_accrual_reversal", date,
        categoryName: "Interest Receivable", type: "credit", amount: "40" },
      { ...base, id: "earned-out", journalGroupId: "accrual-out",
        referenceType: "loan_waiver_accrual_reversal", date,
        categoryName: "Interest Earned", type: "debit", amount: "40" },
      { ...base, id: "loss-out", journalGroupId: "waiver-out",
        referenceType: "loan_waiver_reversal", date: deletedAt,
        categoryName: "Loan Losses", type: "credit", amount: "100" },
      { ...base, id: "interest-out", journalGroupId: "waiver-out",
        referenceType: "loan_waiver_reversal", date: deletedAt,
        categoryName: "Interest Earned", type: "debit", amount: "100" },
      { ...base, loanId: null, id: "receivable-restored", journalGroupId: "accrual-restored",
        referenceType: "loan_waiver_reversal", date: deletedAt,
        categoryName: "Interest Receivable", type: "debit", amount: "40" },
      { ...base, loanId: null, id: "earned-restored", journalGroupId: "accrual-restored",
        referenceType: "loan_waiver_reversal", date: deletedAt,
        categoryName: "Interest Earned", type: "credit", amount: "40" },
    ] as const
    expect(() => verifyExcludedHistoricalWaiver({
      id: "excluded-waiver", loanId: "loan", date, deletedAt, amount: "100",
    }, [...legs])).not.toThrow()
    expect(() => verifyExcludedHistoricalWaiver({
      id: "excluded-waiver", loanId: "loan", date, deletedAt, amount: "100",
    }, legs.map((leg) => leg.id === "earned-restored"
      ? { ...leg, amount: "39" } : leg))).toThrow(/fully reversed/i)
  })

  it("rejects a forged old allocation even when the proposal is freshly rehashed", () => {
    const snapshot = source()
    snapshot.settlements[0].oldInterest = "2999"
    snapshot.settlements[0].oldPrincipal = "2001"
    expect(() => verifyHistoricalRateEvidence(snapshot,
      planHistoricalRateRepair(snapshot))).toThrow(/allocation|journal/i)
  })

  it("checks a negative non-cash accrual correction without touching receipts", () => {
    const snapshot = source()
    snapshot.postedAccrual = "200"
    snapshot.journalLegs.push(
      { id: "accrual-receivable", loanId: "loan", journalGroupId: "accrual-group",
        referenceType: "interest_accrual", referenceId: "loan", date: day("2026-02-10"),
        categoryName: "Interest Receivable", type: "debit", amount: "200" },
      { id: "accrual-earned", loanId: "loan", journalGroupId: "accrual-group",
        referenceType: "interest_accrual", referenceId: "loan", date: day("2026-02-10"),
        categoryName: "Interest Earned", type: "credit", amount: "200" },
    )
    const plan = planHistoricalRateRepair(snapshot)
    const evidence = verifyHistoricalRateEvidence(snapshot, plan)
    expect(evidence.accrualJournalDelta).toBe("-200.00")
    expect(evidence.expectedEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ categoryName: "Interest Receivable", type: "credit",
        amount: "200.00", referenceType: "interest_accrual" }),
      expect.objectContaining({ categoryName: "Interest Earned", type: "debit",
        amount: "200.00", referenceType: "interest_accrual" }),
    ]))
    expect(evidence.allocations.map((row) => row.amount)).toEqual(["5000", "5000"])
  })

  it("fails closed on source exceptions", () => {
    const snapshot = source()
    snapshot.sourceExceptions.push("cash mismatch")
    expect(() => verifyHistoricalRateEvidence(snapshot,
      planHistoricalRateRepair(snapshot))).toThrow(/reviewable|source/i)
  })

  it("does not guess the effective date of an undated penalty waiver", () => {
    const snapshot = source()
    snapshot.loan.penaltyWaived = true
    snapshot.loan.penaltyWaivedAt = null
    const plan = planHistoricalRateRepair(snapshot)
    expect(plan.classification).toBe("blocked")
    expect(() => verifyHistoricalRateEvidence(snapshot, plan)).toThrow(/reviewable/i)
  })

  it("agrees with the proposal across first-payment minimum and dated payment boundaries", () => {
    for (const minimumDays of [0, 14, 30]) {
      for (const firstDay of [1, 10, 30, 59, 62]) {
        for (const amount of [100, 1500, 5000, 40000]) {
          const snapshot = source()
          snapshot.loan.minInterestDays = minimumDays
          snapshot.settlements = [{ ...snapshot.settlements[0],
            date: new Date(snapshot.loan.startDate.getTime() + firstDay * 86_400_000),
            amount: String(amount), oldInterest: String(amount), oldPrincipal: "0",
            oldOverpayment: "0" }]
          syncJournalLegs(snapshot)
          snapshot.asOf = new Date(snapshot.loan.startDate.getTime() + 70 * 86_400_000)
          const plan = planHistoricalRateRepair(snapshot)
          expect(plan.classification).toBe("review")
          expect(() => verifyHistoricalRateEvidence(snapshot, plan),
            `minimum ${minimumDays}, day ${firstDay}, amount ${amount}`).not.toThrow()
        }
      }
    }
  })

  it("replays a payment followed by an interest waiver and later penalty cure", () => {
    for (const paymentDay of [10, 50, 65]) {
      for (const waiverDay of [paymentDay + 1, paymentDay + 8]) {
        const snapshot = source()
        snapshot.loan.minInterestDays = 0
        snapshot.settlements = [
          { ...snapshot.settlements[0],
            date: new Date(snapshot.loan.startDate.getTime() + paymentDay * 86_400_000),
            amount: "2000", oldInterest: "2000", oldPrincipal: "0" },
          { ...snapshot.settlements[1], id: "waiver", kind: "waiver",
            date: new Date(snapshot.loan.startDate.getTime() + waiverDay * 86_400_000),
            amount: "1000", oldInterest: "1000", oldPrincipal: "0" },
        ]
        syncJournalLegs(snapshot)
        snapshot.asOf = new Date(snapshot.loan.startDate.getTime() + 80 * 86_400_000)
        const plan = planHistoricalRateRepair(snapshot)
        expect(plan.classification).toBe("review")
        expect(() => verifyHistoricalRateEvidence(snapshot, plan),
          `payment ${paymentDay}, waiver ${waiverDay}`).not.toThrow()
      }
    }
  })

  it("checks a waiver that moves part of the balance from principal to interest", () => {
    const snapshot = source()
    snapshot.loan.minInterestDays = 0
    snapshot.settlements = [{ id: "waiver", kind: "waiver", date: day("2026-01-31"),
      amount: "5000", oldInterest: "2000", oldPrincipal: "3000", oldOverpayment: "0" }]
    snapshot.asOf = day("2026-01-31")
    syncJournalLegs(snapshot)
    const plan = planHistoricalRateRepair(snapshot)
    const evidence = verifyHistoricalRateEvidence(snapshot, plan)
    expect(evidence.allocations).toEqual([expect.objectContaining({
      kind: "waiver", interest: "4500.00", principal: "500.00", overpayment: "0.00",
    })])
    expect(evidence.endingPrincipal).toBe("29500")
  })
})
