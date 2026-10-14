import { describe, expect, it } from "vitest";
import { quoteRolloverCarry } from "../rollover-carry";

const baseLoan = {
  id: "first",
  principalAmount: "15000000",
  interestRate: "0.10",
  interestRateOverride: null,
  penaltyMultiplier: "0.1000",
  penaltyWaived: false,
  penaltyWaivedAt: null,
  penaltyWaivedBy: null,
  minInterestDays: 30,
  minPeriodOverride: null,
  rolledOverFrom: null,
  issuanceFee: "50000",
  loanType: "perpetual",
  startDate: new Date("2026-08-28T00:00:00Z"),
  createdAt: new Date("2026-08-28T00:00:00Z"),
};

describe("quoteRolloverCarry", () => {
  it("enforces the first loan's minimum period at the effective rollover date", () => {
    const quote = quoteRolloverCarry({
      loan: baseLoan,
      asOf: new Date("2026-09-18T00:00:00Z"),
      payments: [],
      waivers: [],
    });

    expect(quote.carriedPrincipal).toBe("15000000");
    expect(quote.carriedInterest).toBe("1500000");
  });

  it("uses actual elapsed days for a rolled-over successor", () => {
    const quote = quoteRolloverCarry({
      loan: {
        ...baseLoan,
        id: "second",
        principalAmount: "26500000",
        rolledOverFrom: "first",
        startDate: new Date("2026-09-18T00:00:00Z"),
        createdAt: new Date("2026-09-28T00:00:00Z"),
      },
      asOf: new Date("2026-10-01T00:00:00Z"),
      payments: [],
      waivers: [],
    });

    expect(quote.carriedPrincipal).toBe("26500000");
    expect(quote.carriedInterest).toBe("1148333");
  });

  it("never counts predecessor interest capitalized into principal as paid interest", () => {
    const quote = quoteRolloverCarry({
      loan: {
        ...baseLoan,
        id: "third",
        principalAmount: "30648333",
        rolledOverFrom: "second",
        startDate: new Date("2026-10-01T00:00:00Z"),
      },
      asOf: new Date("2026-10-08T00:00:00Z"),
      payments: [],
      waivers: [],
      openingInterestSettled: "1148333",
    });

    expect(quote.carriedInterest).toBe("715128");
  });

  it("rejects a predecessor payment on or after the successor effective date", () => {
    expect(() =>
      quoteRolloverCarry({
        loan: baseLoan,
        asOf: new Date("2026-09-18T00:00:00Z"),
        payments: [{
          paymentDate: new Date("2026-09-19T00:00:00Z"),
          amount: "100000",
          interestPortion: "100000",
          principalPortion: "0",
          recorderName: "",
        }],
        waivers: [],
      }),
    ).toThrow(/after.*effective date/i);
  });

  it("includes a date-only rollover day's predecessor payment without another interest day", () => {
    const quote = quoteRolloverCarry({
      loan: { ...baseLoan, minInterestDays: 0 },
      asOf: new Date("2026-09-18T00:00:00Z"),
      payments: [{
        paymentDate: new Date("2026-09-18T12:00:00Z"),
        amount: "100000",
        interestPortion: "100000",
        principalPortion: "0",
        recorderName: "",
      }],
      waivers: [],
    });
    expect(quote).toEqual({ carriedPrincipal: "15000000", carriedInterest: "950000" });
  });

  it("blocks the same-day exception when the predecessor start is not UTC midnight", () => {
    expect(() => quoteRolloverCarry({
      loan: { ...baseLoan, startDate: new Date("2026-08-28T12:00:00Z") },
      asOf: new Date("2026-09-18T00:00:00Z"),
      payments: [{ paymentDate: new Date("2026-09-18T12:00:00Z"),
        amount: "100000", interestPortion: "100000", principalPortion: "0", recorderName: "" }],
      waivers: [],
    })).toThrow(/after.*effective date/i);
  });

  it("keeps an exactly simultaneous payment blocked for a time-specific rollover", () => {
    expect(() => quoteRolloverCarry({
      loan: baseLoan,
      asOf: new Date("2026-09-18T12:00:00Z"),
      payments: [{ paymentDate: new Date("2026-09-18T12:00:00Z"),
        amount: "100000", interestPortion: "100000", principalPortion: "0", recorderName: "" }],
      waivers: [],
    })).toThrow(/after.*effective date/i);
  });

  it("still blocks a same-day waiver and rate change", () => {
    const asOf = new Date("2026-09-18T00:00:00Z");
    expect(() => quoteRolloverCarry({
      loan: baseLoan, asOf, payments: [],
      waivers: [{ waiverDate: new Date("2026-09-18T12:00:00Z"), amount: "100",
        interestPortion: "100", principalPortion: "0", reason: "test" }],
    })).toThrow(/after.*effective date/i);
    expect(() => quoteRolloverCarry({
      loan: baseLoan, asOf, payments: [], waivers: [],
      rateChanges: [{ effectiveDate: new Date("2026-09-18T12:00:00Z"),
        fromRate: "0.10", toRate: "0.11" }],
    })).toThrow(/after.*effective date/i);
  });

  it("does not apply perpetual accrual to a scheduled loan", () => {
    expect(() => quoteRolloverCarry({
      loan: { ...baseLoan, loanType: "fixed_rate" },
      asOf: new Date("2026-09-18T00:00:00Z"),
      payments: [], waivers: [],
    })).toThrow(/scheduled loan/i);
  });

  it("rejects a backdate preceding a penalty waiver recorded later", () => {
    expect(() => quoteRolloverCarry({
      loan: { ...baseLoan, penaltyWaived: true,
        penaltyWaivedAt: new Date("2026-09-20T00:00:00Z") },
      asOf: new Date("2026-09-18T00:00:00Z"),
      payments: [], waivers: [],
    })).toThrow(/penalty waiver/i);
  });
});
