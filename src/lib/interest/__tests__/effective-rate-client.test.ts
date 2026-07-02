import { describe, it, expect } from "vitest";
import { computeDailyRate } from "../effective-rate-client";
import { computeLoanOverdueInfo } from "../overdue";

// ─── helpers ─────────────────────────────────────────────────────────────────

const baseLoan = {
  status: "active" as const,
  loanType: "perpetual" as const,
  principalAmount: "1000000",
  interestRate: "0.10",
  interestRateOverride: null as string | null,
  minInterestDays: 30,
};

function serverDailyRate(
  overrides: Parameters<typeof computeLoanOverdueInfo>[0],
): string {
  return computeLoanOverdueInfo(overrides).dailyRate;
}

// ─── plan starter cases ───────────────────────────────────────────────────────

describe("computeDailyRate — plan starter cases", () => {
  it("computes monthly rate × principal / 30 for perpetual", () => {
    // 0.10 × 300000 / 30 = 1000
    expect(
      computeDailyRate({
        status: "active",
        loanType: "perpetual",
        principalAmount: "300000",
        interestRate: "0.10",
        interestRateOverride: null,
        minInterestDays: 30,
      }),
    ).toBe("1000");
  });

  it("returns '0' for non-active loans", () => {
    expect(
      computeDailyRate({
        status: "fully_paid",
        loanType: "perpetual",
        principalAmount: "300000",
        interestRate: "0.10",
        interestRateOverride: null,
        minInterestDays: 30,
      }),
    ).toBe("0");
  });

  it("uses interestRateOverride when present", () => {
    // 0.05 × 300000 / 30 = 500
    expect(
      computeDailyRate({
        status: "active",
        loanType: "perpetual",
        principalAmount: "300000",
        interestRate: "0.10",
        interestRateOverride: "0.05",
        minInterestDays: 30,
      }),
    ).toBe("500");
  });
});

// ─── server equivalence (perpetual) ──────────────────────────────────────────

describe("computeDailyRate — server equivalence (perpetual)", () => {
  it("1M principal, 10%/month → 3333 daily (matches server)", () => {
    const client = computeDailyRate(baseLoan, "1000000");
    const srv = serverDailyRate({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: new Date("2026-01-01"),
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid: "0",
      paymentCount: 0,
      totalBalanceOwed: "1000000",
      penaltyWaived: false,
      loan: baseLoan,
      asOf: new Date("2026-03-02"),
    });
    expect(client).toBe(srv); // "3333"
  });

  it("uses outstandingBalance when provided (partially repaid loan)", () => {
    const outstandingBalance = "500000";
    const client = computeDailyRate(baseLoan, outstandingBalance);
    const srv = serverDailyRate({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: new Date("2026-01-01"),
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid: "0",
      paymentCount: 0,
      totalBalanceOwed: outstandingBalance,
      penaltyWaived: false,
      loan: baseLoan,
      asOf: new Date("2026-03-02"),
    });
    expect(client).toBe(srv); // "1667"
  });

  it("falls back to principalAmount when outstandingBalance is '0'", () => {
    // outstandingBalance = 0 → fallback to principalAmount
    const withZero = computeDailyRate(baseLoan, "0");
    const withPrincipal = computeDailyRate(baseLoan); // no outstandingBalance arg
    expect(withZero).toBe(withPrincipal); // both use principalAmount
  });

  it("interestRateOverride changes the rate used", () => {
    const overrideLoan = {
      ...baseLoan,
      interestRateOverride: "0.08" as string | null,
    };
    // 0.08 × 1000000 / 30 = 2667 (floor of 2666.666...)
    const client = computeDailyRate(overrideLoan, "1000000");
    const srv = serverDailyRate({
      principalAmount: "1000000",
      baseRate: "0.08", // caller passes getBaseRate result as baseRate
      startDate: new Date("2026-01-01"),
      loanType: "perpetual",
      termMonths: null,
      totalInterestPaid: "0",
      paymentCount: 0,
      totalBalanceOwed: "1000000",
      penaltyWaived: false,
      loan: overrideLoan,
      asOf: new Date("2026-03-02"),
    });
    expect(client).toBe(srv);
  });
});

// ─── server equivalence (term loans) ─────────────────────────────────────────

describe("computeDailyRate — server equivalence (fixed_rate)", () => {
  it("fixed_rate: uses originalPrincipal × rate / 30 (matches server)", () => {
    const fixedLoan = {
      ...baseLoan,
      loanType: "fixed_rate" as const,
      principalAmount: "1000000",
    };
    // Server: monthlyInterest = principalAmount × baseRate = 1M × 0.10 = 100k
    // dailyRate = 100k / 30 = 3333
    const client = computeDailyRate(fixedLoan, "700000"); // outstandingBalance ignored for fixed_rate
    const srv = serverDailyRate({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: new Date("2026-01-01"),
      loanType: "fixed_rate",
      termMonths: 6,
      totalInterestPaid: "0",
      paymentCount: 0,
      totalBalanceOwed: "700000",
      penaltyWaived: false,
      loan: fixedLoan,
      asOf: new Date("2026-02-01"),
    });
    expect(client).toBe(srv); // "3333"
  });
});

describe("computeDailyRate — server equivalence (reducing_balance)", () => {
  it("reducing_balance: uses outstandingBalance × rate / 30 (matches server)", () => {
    const reducingLoan = {
      ...baseLoan,
      loanType: "reducing_balance" as const,
      principalAmount: "1000000",
    };
    const outstandingBalance = "500000";
    // Server: monthlyInterest = outstandingBalance × baseRate = 500k × 0.10 = 50k
    // dailyRate = 50k / 30 = 1667 (floor of 1666.66...)
    const client = computeDailyRate(reducingLoan, outstandingBalance);
    const srv = serverDailyRate({
      principalAmount: "1000000",
      baseRate: "0.10",
      startDate: new Date("2026-01-01"),
      loanType: "reducing_balance",
      termMonths: 6,
      totalInterestPaid: "80000",
      paymentCount: 3,
      totalBalanceOwed: outstandingBalance,
      penaltyWaived: false,
      loan: reducingLoan,
      asOf: new Date("2026-04-01"),
    });
    expect(client).toBe(srv); // "1667"
  });
});

// ─── edge cases ───────────────────────────────────────────────────────────────

describe("computeDailyRate — edge cases", () => {
  it("zero interest rate → '0'", () => {
    expect(
      computeDailyRate({
        ...baseLoan,
        interestRate: "0",
        interestRateOverride: null,
      }),
    ).toBe("0");
  });

  it("non-active statuses all return '0'", () => {
    const statuses = [
      "pending",
      "fully_paid",
      "settled_with_collateral",
      "rolled_over",
    ] as const;
    for (const status of statuses) {
      expect(computeDailyRate({ ...baseLoan, status })).toBe("0");
    }
  });

  it("null loanType treated as perpetual", () => {
    // LoanBaseRow.loanType may be null if the enum defaults are not applied
    const nullTypeLoan = { ...baseLoan, loanType: null as any };
    // Perpetual path: uses outstandingBalance or principalAmount
    expect(computeDailyRate(nullTypeLoan, "1000000")).toBe("3333");
  });
});
