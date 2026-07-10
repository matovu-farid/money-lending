import { describe, it, expect } from "vitest";
import { computeLoanOverdueInfo } from "../overdue";
import { shouldResetPenaltyWaiver } from "@/app/api/cron/overdue/route";

const BASE_DATE = new Date(Date.UTC(2026, 0, 1));

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function makeLoan(overrides: Partial<{
  id: string;
  interestRate: string;
  interestRateOverride: string | null;
  penaltyMultiplier: string | null;
  startDate: Date;
}> = {}) {
  return {
    id: "loan-1",
    interestRate: "0.10",
    interestRateOverride: null,
    penaltyMultiplier: null,
    startDate: BASE_DATE,
    ...overrides,
  };
}

function makeParams(overrides: Partial<{
  principalAmount: string;
  baseRate: string;
  startDate: Date;
  lastPaymentDate: Date;
  loanType: "perpetual" | "fixed_rate" | "reducing_balance";
  termMonths: number | null;
  totalInterestPaid: string;
  paymentCount: number;
  totalBalanceOwed: string;
  penaltyWaived: boolean;
  asOf: Date;
  loan: ReturnType<typeof makeLoan>;
}> = {}) {
  const loanType = overrides.loanType ?? "perpetual";
  const lastPaymentDate = overrides.lastPaymentDate ?? BASE_DATE;
  const asOf = overrides.asOf ?? addDays(lastPaymentDate, 30);
  return {
    principalAmount: "1000000",
    baseRate: "0.10",
    startDate: BASE_DATE,
    lastPaymentDate,
    loanType,
    termMonths: loanType === "perpetual" ? null : 6,
    totalInterestPaid: "0",
    paymentCount: 0,
    totalBalanceOwed: "1000000",
    penaltyWaived: false,
    asOf,
    loan: makeLoan(),
    ...overrides,
  } as Parameters<typeof computeLoanOverdueInfo>[0];
}

describe("computeLoanOverdueInfo", () => {
  it("uses elapsed days and clears unpaid interest when payment covers accrued interest", () => {
    const result = computeLoanOverdueInfo(
      makeParams({
        lastPaymentDate: BASE_DATE,
        asOf: addDays(BASE_DATE, 30),
        totalInterestPaid: "100000",
      }),
    );

    expect(result.daysOverdue).toBe(30);
    expect(result.unpaidInterest).toBe("100000");
    expect(result.penaltyActive).toBe(false);
    expect(result.effectiveRate).toBe("0.10");
  });

  it("activates penalty at 60+ overdue days", () => {
    const result = computeLoanOverdueInfo(
      makeParams({
        asOf: addDays(BASE_DATE, 90),
      }),
    );

    expect(result.daysOverdue).toBe(90);
    expect(result.penaltyActive).toBe(true);
    expect(result.effectiveRate).toBe("0.1100");
  });

  it("respects custom penalty multiplier and rate override", () => {
    const result = computeLoanOverdueInfo(
      makeParams({
        asOf: addDays(BASE_DATE, 90),
        baseRate: "0.08",
        totalBalanceOwed: "500000",
        loan: makeLoan({
          interestRateOverride: "0.08",
          penaltyMultiplier: "0.2000",
        }),
      }),
    );

    expect(result.daysOverdue).toBe(89);
    expect(result.penaltyActive).toBe(true);
    expect(result.effectiveRate).toBe("0.0960");
  });

  it("keeps penalty waived when penaltyWaived is true", () => {
    const result = computeLoanOverdueInfo(
      makeParams({
        asOf: addDays(BASE_DATE, 90),
        penaltyWaived: true,
      }),
    );

    expect(result.daysOverdue).toBe(90);
    expect(result.penaltyActive).toBe(false);
    expect(result.effectiveRate).toBe("0.10");
  });

  it("uses principalAmount for fixed-rate interest accrual but current balance for the daily rate", () => {
    const result = computeLoanOverdueInfo(
      makeParams({
        loanType: "fixed_rate",
        termMonths: 6,
        lastPaymentDate: BASE_DATE,
        asOf: addDays(BASE_DATE, 60),
        totalBalanceOwed: "500000",
      }),
    );

    expect(result.dailyRate).toBe("1667");
    expect(result.daysOverdue).toBe(120);
  });

  it("uses outstanding balance for reducing_balance interest", () => {
    const result = computeLoanOverdueInfo(
      makeParams({
        loanType: "reducing_balance",
        termMonths: 6,
        lastPaymentDate: BASE_DATE,
        asOf: addDays(BASE_DATE, 60),
        totalBalanceOwed: "500000",
      }),
    );

    expect(result.dailyRate).toBe("1667");
    expect(result.daysOverdue).toBe(60);
  });

  it("never returns negative unpaid interest", () => {
    const result = computeLoanOverdueInfo(
      makeParams({
        asOf: addDays(BASE_DATE, 30),
        totalInterestPaid: "200000",
      }),
    );

    expect(Number(result.unpaidInterest)).toBeGreaterThanOrEqual(0);
  });
});

describe("shouldResetPenaltyWaiver", () => {
  it("only resets when the borrower is fully current", () => {
    expect(shouldResetPenaltyWaiver(55, true)).toBe(false);
    expect(shouldResetPenaltyWaiver(30, true)).toBe(false);
    expect(shouldResetPenaltyWaiver(0, true)).toBe(true);
    expect(shouldResetPenaltyWaiver(0, false)).toBe(false);
    expect(shouldResetPenaltyWaiver(55, false)).toBe(false);
    expect(shouldResetPenaltyWaiver(59, true)).toBe(false);
    expect(shouldResetPenaltyWaiver(1, true)).toBe(false);
  });
});
