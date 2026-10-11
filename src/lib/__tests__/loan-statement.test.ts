import { describe, it, expect } from "vitest"
import { buildLoanStatement } from "../loan-statement"

const baseLoan = {
  id: "test-loan-1",
  principalAmount: "1000000",
  interestRate: "0.10",
  interestRateOverride: null,
  penaltyMultiplier: "0.1000",
  penaltyWaived: false,
  penaltyWaivedAt: null,
  penaltyWaivedBy: null,
  minInterestDays: 30,
  issuanceFee: "0",
  loanType: "perpetual",
  startDate: new Date("2026-01-01T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
}

describe("buildLoanStatement — basic accrual", () => {
  it("uses a backdated loan start, not its entry date, for elapsed interest", () => {
    const stmt = buildLoanStatement({
      loan: {
        ...baseLoan,
        principalAmount: "15488333",
        rolledOverFrom: "predecessor",
        startDate: new Date("2026-06-30T00:00:00Z"),
        createdAt: new Date("2026-07-23T08:36:10Z"),
      },
      payments: [],
      today: new Date("2026-08-12T00:00:00Z"),
    })
    expect(stmt.daysSinceStart).toBe(43)
    expect(stmt.terms.backdated).toBe(true)
    expect(stmt.finalState.cumulativeInterestAccrued).toBe("2219994")
  })

  it("starts with the original rate before applying a dated override", () => {
    const stmt = buildLoanStatement({
      loan: { ...baseLoan, interestRateOverride: "0.1200", rolledOverFrom: "previous-loan" },
      rateChanges: [{
        effectiveDate: new Date("2026-01-11T00:00:00Z"),
        fromRate: "0.1000", toRate: "0.1200",
      }],
      payments: [],
      today: new Date("2026-01-21T00:00:00Z"),
    })
    expect(stmt.terms.baseRate).toBe("0.10")
    expect(stmt.finalState.cumulativeInterestAccrued).toBe("73333")
  })
  it("applies a rate change effective at issuance before the first interval", () => {
    const stmt = buildLoanStatement({
      loan: { ...baseLoan, interestRateOverride: "0.1200", rolledOverFrom: "previous-loan" },
      rateChanges: [{
        effectiveDate: new Date("2026-01-01T00:00:00Z"),
        fromRate: "0.1000", toRate: "0.1200",
      }],
      payments: [],
      today: new Date("2026-01-11T00:00:00Z"),
    })
    expect(stmt.finalState.cumulativeInterestAccrued).toBe("40000")
    expect(stmt.events).toContainEqual(expect.objectContaining({
      kind: "rate_changed", day: 0, to: "0.1200",
    }))
  })
  it("does not reduce interest already accrued through the payment date", () => {
    const loan = { ...baseLoan, rolledOverFrom: "previous-loan" }
    const paymentDate = new Date("2026-01-11T00:00:00Z")
    const before = buildLoanStatement({ loan, payments: [], today: paymentDate })
    const after = buildLoanStatement({
      loan,
      payments: [{
        paymentDate, amount: "100000", interestPortion: "33333",
        principalPortion: "66667", recorderName: "Test",
      }],
      today: paymentDate,
    })
    expect(after.finalState.cumulativeInterestAccrued)
      .toBe(before.finalState.cumulativeInterestAccrued)
  })
  it("preserves the full overdue interval when principal is paid on a penalty-rate day", () => {
    const loan = { ...baseLoan, rolledOverFrom: "previous-loan" }
    const paymentDate = new Date("2026-03-12T00:00:00Z")
    const before = buildLoanStatement({ loan, payments: [], today: paymentDate })
    const after = buildLoanStatement({
      loan,
      payments: [{
        paymentDate, amount: "100000", interestPortion: "0",
        principalPortion: "100000", recorderName: "Test",
      }],
      today: paymentDate,
    })
    expect(before.finalState.penaltyActive).toBe(true)
    expect(after.finalState.cumulativeInterestAccrued)
      .toBe(before.finalState.cumulativeInterestAccrued)
  })
  it("returns to the base rate after a payment cures all overdue interest", () => {
    const paymentDate = new Date("2026-03-12T00:00:00Z")
    const before = buildLoanStatement({ loan: baseLoan, payments: [], today: paymentDate })
    expect(before.finalState.penaltyActive).toBe(true)
    const payment = { paymentDate, amount: before.finalState.cumulativeInterestAccrued,
      interestPortion: before.finalState.cumulativeInterestAccrued,
      principalPortion: "0", recorderName: "Test" }
    const next = buildLoanStatement({ loan: baseLoan, payments: [payment],
      today: new Date("2026-03-13T00:00:00Z") })
    const nextDayInterest = Number(next.finalState.cumulativeInterestAccrued) -
      Number(before.finalState.cumulativeInterestAccrued)
    expect(nextDayInterest).toBeGreaterThanOrEqual(3332)
    expect(nextDayInterest).toBeLessThanOrEqual(3334)
    expect(next.finalState.penaltyActive).toBe(false)
  })
  it("charges only eight days of interest on a rollover, including with a minimum override", () => {
    const stmt = buildLoanStatement({
      loan: { ...baseLoan, principalAmount: "10000000", rolledOverFrom: "previous-loan", minPeriodOverride: 45 },
      payments: [],
      today: new Date("2026-01-09T00:00:00Z"),
    })
    expect(stmt.terms.minInterestDays).toBe(0)
    expect(stmt.finalState.minimumInterestAdjustment).toBe("0")
    expect(stmt.finalState.netUnpaidInterest).toBe("266667")
    expect(stmt.finalState.totalDue).toBe("10266667")
  })

  it("captures the issuance event on day 0", () => {
    const stmt = buildLoanStatement({
      loan: baseLoan,
      payments: [],
      today: new Date("2026-01-01T00:00:00Z"),
    })
    expect(stmt.events).toHaveLength(1)
    expect(stmt.events[0].kind).toBe("issue")
    expect(stmt.daysSinceStart).toBe(0)
  })

  it("accrues 30 days of base-rate interest in cycle 1 with no payments", () => {
    const stmt = buildLoanStatement({
      loan: baseLoan,
      payments: [],
      today: new Date("2026-01-31T00:00:00Z"),
    })
    expect(stmt.cycles).toHaveLength(1)
    const c = stmt.cycles[0]
    expect(c.daysAtBaseRate).toBe(30)
    expect(c.daysAtEffectiveRate).toBe(0)
    // 1,000,000 × 0.10 × 30 / 30 = 100,000
    expect(c.accruedInCycle).toBe("100000")
    expect(c.netUnpaidAtEnd).toBe("100000")
    expect(c.penaltyActiveAtEnd).toBe(false)
  })

  it("includes a partial cycle when today is mid-cycle", () => {
    // 45 days = full cycle (30) + partial (15)
    const stmt = buildLoanStatement({
      loan: baseLoan,
      payments: [],
      today: new Date("2026-02-15T00:00:00Z"),
    })
    expect(stmt.cycles).toHaveLength(2)
    expect(stmt.cycles[0].isPartial).toBe(false)
    expect(stmt.cycles[1].isPartial).toBe(true)
    expect(stmt.cycles[1].endDay - stmt.cycles[1].startDay).toBe(15)
  })
})

describe("buildLoanStatement — payments", () => {
  it("records a payment as an event and reduces the principal balance", () => {
    const stmt = buildLoanStatement({
      loan: baseLoan,
      payments: [
        {
          paymentDate: new Date("2026-01-07T00:00:00Z"),
          amount: "200000",
          interestPortion: "100000",
          principalPortion: "100000",
          recorderName: "Alice",
        },
      ],
      today: new Date("2026-01-31T00:00:00Z"),
    })
    const payEvent = stmt.events.find((e) => e.kind === "payment")
    expect(payEvent).toBeDefined()
    if (payEvent?.kind === "payment") {
      expect(payEvent.balanceBefore).toBe("1000000")
      expect(payEvent.balanceAfter).toBe("900000")
    }
    expect(stmt.finalState.principalBalance).toBe("900000")
    expect(stmt.finalState.cumulativeInterestPaid).toBe("100000")
  })

  it("treats overpaid interest as a credit against future accrual", () => {
    // Pay 200k of interest on day 7, then accrue 23 more days at 900k balance.
    // Linear accrual: days 1-7 at 1,000,000 (66,666) + days 8-30 at 900,000 (69,000) = ~135,666
    // Paid: 200,000 → unpaid = max(135,666 - 200,000, 0) = 0
    const stmt = buildLoanStatement({
      loan: baseLoan,
      payments: [
        {
          paymentDate: new Date("2026-01-07T00:00:00Z"),
          amount: "300000",
          interestPortion: "200000",
          principalPortion: "100000",
          recorderName: "Alice",
        },
      ],
      today: new Date("2026-01-31T00:00:00Z"),
    })
    expect(stmt.finalState.netUnpaidInterest).toBe("0")
  })
})

describe("buildLoanStatement — rollover settlement", () => {
  it("accepts serialized loan dates and keeps capitalized interest out of payments", () => {
    const stmt = buildLoanStatement({
      loan: {
        ...baseLoan,
        id: "samuel-current",
        principalAmount: "33363461",
        rolledOverFrom: "samuel-predecessor",
        startDate: "2026-10-08T00:00:00Z" as unknown as Date,
        createdAt: "2026-10-09T00:00:00Z" as unknown as Date,
      },
      payments: [],
      openingInterestSettled: "715128",
      today: new Date("2026-10-09T00:00:00Z"),
    })

    expect(stmt.daysSinceStart).toBe(1)
    expect(stmt.terms.backdated).toBe(true)
    expect(stmt.finalState.cumulativeInterestPaid).toBe("0")
    expect(stmt.finalState.netUnpaidInterest).toBe("111212")
    expect(stmt.events).toContainEqual(expect.objectContaining({
      kind: "rollover_settled", amount: "715128",
    }))
  })

  it("ends a predecessor at its rollover date and does not present a collectible balance", () => {
    const stmt = buildLoanStatement({
      loan: { ...baseLoan, principalAmount: "15000000", startDate: new Date("2026-08-28T00:00:00Z") },
      payments: [],
      today: new Date("2026-10-09T00:00:00Z"),
      closingRollover: { date: new Date("2026-09-18T00:00:00Z"), amount: "16500000", remainingReceivable: "0" },
    });
    expect(stmt.today).toEqual(new Date("2026-09-18T00:00:00Z"));
    expect(stmt.daysSinceStart).toBe(21);
    expect(stmt.finalState.cumulativeInterestAccrued).toBe("1050000");
    expect(stmt.finalState.totalDue).toBe("0");
    expect(stmt.events).toContainEqual(expect.objectContaining({
      kind: "rollover_closed", amount: "16500000",
    }));
  });
  it("rejects a successor date before the predecessor loan started", () => {
    expect(() => buildLoanStatement({
      loan: { ...baseLoan, startDate: new Date("2026-05-18T00:00:00Z") },
      payments: [],
      today: new Date("2026-10-09T00:00:00Z"),
      closingRollover: { date: new Date("2026-04-24T00:00:00Z"), amount: "1000000" },
    })).toThrow(/precedes the predecessor loan start date/i);
  });
  it("does not report zero due when a recorded rollover left receivable unresolved", () => {
    const stmt = buildLoanStatement({
      loan: { ...baseLoan, principalAmount: "15000000", startDate: new Date("2026-08-28T00:00:00Z") },
      payments: [],
      today: new Date("2026-10-09T00:00:00Z"),
      closingRollover: {
        date: new Date("2026-09-18T00:00:00Z"), amount: "15000000", remainingReceivable: "500000",
      },
    });
    expect(stmt.closingReceivable).toBe("500000");
    expect(stmt.finalState.totalDue).not.toBe("0");
  });
  it("does not infer reconciliation when the predecessor receivable is unavailable", () => {
    const stmt = buildLoanStatement({
      loan: baseLoan, payments: [], today: new Date("2026-01-31T00:00:00Z"),
      closingRollover: { date: new Date("2026-01-31T00:00:00Z"), amount: "1000000" },
    });
    expect(stmt.finalState.totalDue).not.toBe("0");
  });
  it("does not count capitalized predecessor interest as a payment on the new loan", () => {
    const stmt = buildLoanStatement({
      loan: { ...baseLoan, principalAmount: "1100000", rolledOverFrom: "previous-loan" },
      payments: [],
      openingInterestSettled: "100000",
      today: new Date("2026-01-31T00:00:00Z"),
    })

    expect(stmt.events.some((event) => event.kind === "rollover_settled")).toBe(true)
    expect(stmt.finalState.cumulativeInterestAccrued).toBe("110000")
    expect(stmt.finalState.cumulativeInterestPaid).toBe("0")
    expect(stmt.finalState.netUnpaidInterest).toBe("110000")
    expect(stmt.finalState.totalDue).toBe("1210000")
    expect(stmt.finalState.daysOverdue).toBe(30)
  })

  it("shows all eight days of interest unpaid for the reported rollover with no payments", () => {
    const stmt = buildLoanStatement({
      loan: {
        ...baseLoan,
        principalAmount: "29858500",
        rolledOverFrom: "previous-loan",
        startDate: new Date("2026-10-01T00:00:00Z"),
        createdAt: new Date("2026-10-09T00:00:00Z"),
      },
      payments: [],
      openingInterestSettled: "308500",
      today: new Date("2026-10-09T00:00:00Z"),
    })

    expect(stmt.cycles[0].accruedInCycle).toBe("796227")
    expect(stmt.events[0]).toMatchObject({ kind: "issue", rolledOver: true })
    expect(stmt.cycles[0].cumulativePaid).toBe("0")
    expect(stmt.cycles[0].netUnpaidAtEnd).toBe("796227")
    expect(stmt.cycles[0].daysOverdueAtEnd).toBe(8)
    expect(stmt.finalState.cumulativeInterestPaid).toBe("0")
    expect(stmt.finalState.totalDue).toBe("30654727")
  })

  it("matches the production rollover loan after recognizing opening interest", () => {
    const stmt = buildLoanStatement({
      loan: {
        ...baseLoan,
        id: "loan-production-rollover",
        principalAmount: "15358484",
        interestRate: "0.12",
        startDate: new Date("2025-02-21T00:00:00Z"),
        createdAt: new Date("2026-08-03T13:12:05.926Z"),
      },
      openingInterestSettled: "3636606.34",
      payments: [
        {
          paymentDate: new Date("2025-04-15T12:00:00Z"),
          amount: "1350000",
          interestPortion: "0",
          principalPortion: "1350000",
          recorderName: "",
        },
        {
          paymentDate: new Date("2025-08-07T12:00:00Z"),
          amount: "1500000",
          interestPortion: "0",
          principalPortion: "1500000",
          recorderName: "",
        },
        {
          paymentDate: new Date("2025-09-12T12:00:00Z"),
          amount: "3000000",
          interestPortion: "1513221.69",
          principalPortion: "1486778.31",
          recorderName: "",
        },
        {
          paymentDate: new Date("2025-11-07T12:00:00Z"),
          amount: "2000000",
          interestPortion: "2000000",
          principalPortion: "0",
          recorderName: "",
        },
        {
          paymentDate: new Date("2026-03-31T12:00:00Z"),
          amount: "1000000",
          interestPortion: "1000000",
          principalPortion: "0",
          recorderName: "",
        },
      ],
      today: new Date("2026-08-03T00:00:00Z"),
    })

    expect(stmt.finalState.principalBalance).toBe("11021706")
    // Principal reductions take effect after interest through their payment dates.
    expect(stmt.finalState.cumulativeInterestAccrued).toBe("28013830")
    expect(stmt.finalState.cumulativeInterestPaid).toBe("4513222")
    expect(stmt.finalState.netUnpaidInterest).toBe("23500609")
    expect(stmt.finalState.totalDue).toBe("34522315")
    expect(stmt.finalState.daysOverdue).toBeGreaterThan(450)
  })
})

describe("buildLoanStatement — waivers", () => {
  it("settles waiver allocations and matches the ledger-backed total due", () => {
    const stmt = buildLoanStatement({
      loan: {
        ...baseLoan,
        id: "loan-with-waivers",
        principalAmount: "10000000",
        startDate: new Date("2025-11-12T00:00:00Z"),
        createdAt: new Date("2026-07-22T12:03:55.601Z"),
      },
      payments: [],
      waivers: [
        {
          waiverDate: new Date("2026-07-22T12:36:52.130Z"),
          amount: "4000000",
          interestPortion: "4000000",
          principalPortion: "0",
          reason: "Moved from old system",
        },
        {
          waiverDate: new Date("2026-07-22T12:37:51.228Z"),
          amount: "100000",
          interestPortion: "0",
          principalPortion: "100000",
          reason: "Old loan amount",
        },
        {
          waiverDate: new Date("2026-07-22T12:58:16.899Z"),
          amount: "100000",
          interestPortion: "0",
          principalPortion: "100000",
          reason: "Moving to new system",
        },
      ],
      today: new Date("2026-08-03T00:00:00Z"),
    })

    expect(stmt.events.filter((event) => event.kind === "waiver")).toHaveLength(3)
    expect(stmt.finalState.principalBalance).toBe("9800000")
    // The two UGX 100,000 principal waivers stop interest accruing on that
    // principal from their settlement date onward.
    expect(stmt.finalState.cumulativeInterestAccrued).toBe("9471200")
    expect(stmt.finalState.cumulativeInterestPaid).toBe("0")
    expect(stmt.finalState.cumulativeInterestWaived).toBe("4000000")
    expect(stmt.finalState.netUnpaidInterest).toBe("5471200")
    expect(stmt.finalState.totalDue).toBe("15271200")
    expect(stmt.finalState.daysOverdue).toBe(167)
  })
})

describe("buildLoanStatement — penalty activation", () => {
  it("emits a penalty_active event when daysOverdue crosses the 60-day threshold", () => {
    // 90 days, no payments → daysOverdue hits 60 around day 60
    const stmt = buildLoanStatement({
      loan: baseLoan,
      payments: [],
      today: new Date("2026-04-01T00:00:00Z"),
    })
    const penalty = stmt.events.find((e) => e.kind === "penalty_active")
    expect(penalty).toBeDefined()
    if (penalty?.kind === "penalty_active") {
      // crosses on or near day 60
      expect(penalty.day).toBeGreaterThanOrEqual(60)
      expect(penalty.day).toBeLessThanOrEqual(62)
    }
    expect(stmt.finalState.penaltyActive).toBe(true)
  })

  it("uses effective rate (base × 1.10) after penalty kicks in", () => {
    const stmt = buildLoanStatement({
      loan: baseLoan,
      payments: [],
      today: new Date("2026-04-01T00:00:00Z"),
    })
    const cycle2 = stmt.cycles[1] // days 30-60
    const cycle3 = stmt.cycles[2] // days 60-90
    // Cycle 2 is all base rate (penalty hasn't activated yet) → 100,000
    expect(cycle2.accruedAtBase).toBe("100000")
    expect(cycle2.accruedAtEffective).toBe("0")
    // Cycle 3 contains the penalty crossover. Most days at effective (11%).
    expect(Number(cycle3.accruedAtEffective)).toBeGreaterThan(80000)
  })

  it("does not penalize when loan.penaltyWaived is true", () => {
    const stmt = buildLoanStatement({
      loan: { ...baseLoan, penaltyWaived: true },
      payments: [],
      today: new Date("2026-04-01T00:00:00Z"),
    })
    expect(stmt.finalState.penaltyActive).toBe(false)
    expect(stmt.events.find((e) => e.kind === "penalty_active")).toBeUndefined()
    // All 90 days at base = 300,000
    expect(stmt.finalState.cumulativeInterestAccrued).toBe("300000")
  })

  it("applies a dated penalty waiver only from its recorded day", () => {
    const stmt = buildLoanStatement({
      loan: { ...baseLoan, penaltyWaived: true,
        penaltyWaivedAt: new Date("2026-03-20T00:00:00Z") },
      payments: [],
      today: new Date("2026-04-01T00:00:00Z"),
    })
    expect(stmt.events.some((event) => event.kind === "penalty_active")).toBe(true)
    expect(stmt.events.some((event) => event.kind === "penalty_waived")).toBe(true)
    expect(stmt.finalState.penaltyActive).toBe(false)
    expect(Number(stmt.finalState.cumulativeInterestAccrued)).toBeGreaterThan(300000)
    expect(Number(stmt.finalState.cumulativeInterestAccrued)).toBeLessThan(310000)

    const beforeWaiver = buildLoanStatement({
      loan: { ...baseLoan, penaltyWaived: true,
        penaltyWaivedAt: new Date("2026-03-20T00:00:00Z") },
      payments: [],
      closingRollover: { date: new Date("2026-03-15T00:00:00Z"), amount: "0" },
      today: new Date("2026-04-01T00:00:00Z"),
    })
    expect(beforeWaiver.events.some((event) => event.kind === "penalty_waived")).toBe(false)
  })
})

describe("buildLoanStatement — rate changes", () => {
  it("emits a rate_changed event and applies the new rate from its effective date", () => {
    // 50 days. Rate changes from 10% → 12% on day 20.
    // (Going UP avoids the subtle penalty-trigger interaction when the rate
    // cuts, where shrinking daily-base inflates daysOverdue.)
    // Day 1-19 at 10%: 19 × 3,333.33 = 63,333
    // Day 20-50 at 12%: 31 × 4,000 = 124,000
    // Total: ~187,333. We assert the order of magnitude rather than the
    // exact integer to keep the test resilient to BigNumber rounding.
    const stmt = buildLoanStatement({
      loan: baseLoan,
      payments: [],
      rateChanges: [
        { effectiveDate: new Date("2026-01-21T00:00:00Z"), fromRate: "0.10", toRate: "0.12" },
      ],
      today: new Date("2026-02-20T00:00:00Z"),
    })
    expect(stmt.events.some((e) => e.kind === "rate_changed")).toBe(true)
    const accrued = Number(stmt.finalState.cumulativeInterestAccrued)
    expect(accrued).toBeGreaterThan(180000)
    expect(accrued).toBeLessThan(200000)
  })
})

describe("buildLoanStatement — finalState", () => {
  it("includes the first-payment minimum in settlement due before any payment", () => {
    const stmt = buildLoanStatement({
      loan: {
        ...baseLoan,
        id: "loan-production-minimum-interest",
        principalAmount: "19000000",
        startDate: new Date("2026-07-14T00:00:00Z"),
        createdAt: new Date("2026-07-14T12:39:24.996659Z"),
      },
      payments: [],
      today: new Date("2026-08-04T00:00:00Z"),
    })

    expect(stmt.finalState.cumulativeInterestAccrued).toBe("1330000")
    expect(stmt.finalState.minimumInterestAdjustment).toBe("570000")
    expect(stmt.finalState.netUnpaidInterest).toBe("1900000")
    expect(stmt.finalState.totalDue).toBe("20900000")
  })

  it("totalDue = principalBalance + netUnpaidInterest", () => {
    const stmt = buildLoanStatement({
      loan: baseLoan,
      payments: [],
      today: new Date("2026-01-31T00:00:00Z"),
    })
    expect(stmt.finalState.totalDue).toBe(
      (
        Number(stmt.finalState.principalBalance) +
        Number(stmt.finalState.netUnpaidInterest)
      ).toString(),
    )
  })
})
