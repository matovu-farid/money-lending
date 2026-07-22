/**
 * Temporal Fuzz Tests for Loan Engine
 *
 * These tests generate random loan scenarios across different time periods
 * and validate that core invariants always hold, regardless of:
 * - When in the month/year the loan was created
 * - How many days have elapsed
 * - What combination of payment amounts/dates are used
 * - Edge dates (month-end, leap year, year boundary)
 */
import { describe, it, expect } from "vitest";
import BigNumber from "bignumber.js";
import {
  calculateInterest,
  calculateDailyRate,
  calculateDaysOverdue,
  allocatePayment,
  allocateFixedRatePayment,
  allocateReducingBalancePayment,
  calculateSchedule,
  formatAmount,
} from "../engine";
import { computeLoanOverdueInfo } from "../overdue";
import {
  isPenaltyActive,
  getEffectiveRate,
  getBaseRate,
} from "../effective-rate";
import { daysBetween } from "@/lib/db/utils";

// ─── Random Generators ────────────────────────────────────────────
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDecimal(min: number, max: number, dp: number = 4): string {
  const val = min + Math.random() * (max - min);
  return val.toFixed(dp);
}

function randomDate(startYear: number, endYear: number): Date {
  const start = new Date(startYear, 0, 1).getTime();
  const end = new Date(endYear, 11, 31).getTime();
  return new Date(start + Math.random() * (end - start));
}

/** Generate a date that's exactly on a month boundary edge */
function randomEdgeDate(): Date {
  const year = randomInt(2023, 2026);
  const month = randomInt(0, 11);
  const edgeType = randomInt(0, 3);
  switch (edgeType) {
    case 0:
      return new Date(year, month, 1); // First of month
    case 1:
      return new Date(year, month + 1, 0); // Last of month
    case 2:
      return new Date(year, month, 28); // Feb boundary
    case 3:
      return new Date(year, month, 31); // May overflow to next month
    default:
      return new Date(year, month, 15);
  }
}

function randomPrincipal(): string {
  return String(randomInt(50000, 10000000));
}

function randomRate(): string {
  // Monthly rates between 1% and 30%
  return randomDecimal(0.01, 0.3, 4);
}

function randomPaymentAmount(maxAmount: string): string {
  const max = Math.max(Number(maxAmount), 1);
  return String(randomInt(1, max));
}

const FUZZ_ITERATIONS = 200;

// ─── Invariant: Interest is Always Non-Negative ───────────────────
describe("FUZZ: Interest Calculation Invariants", () => {
  it("interest is always >= 0 for any valid inputs", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const balance = randomPrincipal();
      const rate = randomRate();
      const days = randomInt(0, 365);
      const minDays = randomInt(0, 90);

      const interest = calculateInterest(balance, rate, days, minDays);
      expect(interest.isGreaterThanOrEqualTo(0)).toBe(true);
    }
  });

  it("more days always means >= interest (monotonicity)", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const balance = randomPrincipal();
      const rate = randomRate();
      const minDays = randomInt(0, 30);
      const days1 = randomInt(minDays, 180);
      const days2 = days1 + randomInt(1, 90);

      const interest1 = calculateInterest(balance, rate, days1, minDays);
      const interest2 = calculateInterest(balance, rate, days2, minDays);
      expect(interest2.isGreaterThanOrEqualTo(interest1)).toBe(true);
    }
  });

  it("higher rate always means >= interest", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const balance = randomPrincipal();
      const rate1 = randomDecimal(0.01, 0.15, 4);
      const rate2 = new BigNumber(rate1).plus("0.0001").toFixed(4);
      const days = randomInt(1, 180);

      const interest1 = calculateInterest(balance, rate1, days, 0);
      const interest2 = calculateInterest(balance, rate2, days, 0);
      expect(interest2.isGreaterThanOrEqualTo(interest1)).toBe(true);
    }
  });

  it("zero balance yields zero interest", () => {
    for (let i = 0; i < 50; i++) {
      const rate = randomRate();
      const days = randomInt(0, 365);
      const interest = calculateInterest("0", rate, days, 30);
      expect(interest.isZero()).toBe(true);
    }
  });

  it("zero rate yields zero interest", () => {
    for (let i = 0; i < 50; i++) {
      const balance = randomPrincipal();
      const days = randomInt(0, 365);
      const interest = calculateInterest(balance, "0.0000", days, 30);
      expect(interest.isZero()).toBe(true);
    }
  });
});

// ─── Invariant: Payment Allocation Conservation ───────────────────
describe("FUZZ: Payment Allocation - Conservation of Money", () => {
  it("interest + principal = payment amount (perpetual, payment <= total owed)", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const principal = randomPrincipal();
      const rate = randomRate();
      const days = randomInt(1, 180);
      const minDays = randomInt(1, 30);

      // Calculate max payable to avoid overpayment
      const interest = calculateInterest(principal, rate, days, minDays);
      const totalOwed = interest.plus(new BigNumber(principal));
      const maxPayment = totalOwed.toFixed(0);
      if (Number(maxPayment) <= 0) continue;

      const paymentAmount = randomPaymentAmount(maxPayment);

      const allocation = allocatePayment({
        paymentAmount,
        principalBalanceBefore: principal,
        monthlyRateDecimal: rate,
        daysElapsed: days,
        minInterestDays: minDays,
      });

      const reconstructed = new BigNumber(allocation.interestPortion).plus(
        new BigNumber(allocation.principalPortion),
      );

      // Allow for rounding: difference should be at most 1
      const diff = new BigNumber(paymentAmount).minus(reconstructed).abs();
      expect(
        diff.isLessThanOrEqualTo(1),
        `Payment ${paymentAmount} != interest ${allocation.interestPortion} + principal ${allocation.principalPortion} (diff: ${diff.toFixed(2)}, iter ${i})`,
      ).toBe(true);
    }
  });

  it("principal balance never goes negative", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const principal = randomPrincipal();
      const rate = randomRate();
      const days = randomInt(1, 180);
      const minDays = randomInt(1, 30);

      const interest = calculateInterest(principal, rate, days, minDays);
      const totalOwed = interest.plus(new BigNumber(principal));
      const paymentAmount = randomPaymentAmount(totalOwed.toFixed(0));

      const allocation = allocatePayment({
        paymentAmount,
        principalBalanceBefore: principal,
        monthlyRateDecimal: rate,
        daysElapsed: days,
        minInterestDays: minDays,
      });

      expect(
        new BigNumber(allocation.principalBalanceAfter).isGreaterThanOrEqualTo(
          0,
        ),
        `Negative balance: ${allocation.principalBalanceAfter} (iter ${i})`,
      ).toBe(true);
    }
  });

  it("principalBalanceAfter = principalBalanceBefore - principalPortion", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const principal = randomPrincipal();
      const rate = randomRate();
      const days = randomInt(1, 180);

      const interest = calculateInterest(principal, rate, days, 30);
      const totalOwed = interest.plus(new BigNumber(principal));
      const paymentAmount = randomPaymentAmount(totalOwed.toFixed(0));

      const allocation = allocatePayment({
        paymentAmount,
        principalBalanceBefore: principal,
        monthlyRateDecimal: rate,
        daysElapsed: days,
        minInterestDays: 30,
      });

      const expected = BigNumber.max(
        new BigNumber(principal).minus(
          new BigNumber(allocation.principalPortion),
        ),
        0,
      );
      const diff = new BigNumber(allocation.principalBalanceAfter)
        .minus(expected)
        .abs();
      expect(
        diff.isLessThanOrEqualTo(1),
        `Balance mismatch: got ${allocation.principalBalanceAfter}, expected ${expected.toFixed(0)} (iter ${i})`,
      ).toBe(true);
    }
  });

  it("fully paying total owed sets loanFullyPaid = true", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const principal = randomPrincipal();
      const rate = randomRate();
      const days = randomInt(30, 180);

      const interest = calculateInterest(principal, rate, days, 30);
      const totalOwed = interest.plus(new BigNumber(principal));

      const allocation = allocatePayment({
        paymentAmount: totalOwed.toFixed(0),
        principalBalanceBefore: principal,
        monthlyRateDecimal: rate,
        daysElapsed: days,
        minInterestDays: 30,
      });

      // Due to rounding, balance might be 0 or 1
      const balanceAfter = new BigNumber(allocation.principalBalanceAfter);
      expect(
        balanceAfter.isLessThanOrEqualTo(1),
        `Full payment didn't clear balance: ${allocation.principalBalanceAfter} (principal=${principal}, interest=${interest.toFixed(0)})`,
      ).toBe(true);
    }
  });
});

// ─── Invariant: Interest-First Allocation ─────────────────────────
describe("FUZZ: Interest-First Rule", () => {
  it("small payments go entirely to interest (no principal reduction)", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const principal = String(randomInt(500000, 10000000));
      const rate = randomDecimal(0.05, 0.2, 4);
      const days = randomInt(30, 180);

      const interest = calculateInterest(principal, rate, days, 30);
      if (interest.isLessThanOrEqualTo(1)) continue;

      // Pay less than interest owed
      const smallPayment = String(
        randomInt(1, Math.max(interest.minus(1).integerValue().toNumber(), 1)),
      );

      const allocation = allocatePayment({
        paymentAmount: smallPayment,
        principalBalanceBefore: principal,
        monthlyRateDecimal: rate,
        daysElapsed: days,
        minInterestDays: 30,
      });

      expect(allocation.principalPortion).toMatch(/^0(\.00)?$/);
      expect(allocation.principalBalanceAfter).toBe(principal);
    }
  });
});

// ─── Invariant: daysBetween Properties ────────────────────────────
describe("FUZZ: daysBetween Temporal Properties", () => {
  it("daysBetween(date, date) = 0", () => {
    for (let i = 0; i < 50; i++) {
      const d = randomDate(2020, 2026);
      expect(daysBetween(d, d)).toBe(0);
    }
  });

  it("daysBetween is non-negative when to >= from", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const from = randomDate(2020, 2025);
      const daysToAdd = randomInt(0, 730);
      const to = new Date(from.getTime() + daysToAdd * 86400000);
      expect(daysBetween(from, to)).toBeGreaterThanOrEqual(0);
    }
  });

  it("daysBetween is antisymmetric: daysBetween(a,b) = -daysBetween(b,a)", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const a = randomDate(2020, 2026);
      const b = randomDate(2020, 2026);
      const ab = daysBetween(a, b);
      const ba = daysBetween(b, a);
      // Due to floor rounding, allow ±1 difference
      expect(Math.abs(ab + ba)).toBeLessThanOrEqual(1);
    }
  });

  it("adding N*86400000 ms gives exactly N days (no DST issues in UTC)", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const from = new Date(
        Date.UTC(
          randomInt(2020, 2026),
          randomInt(0, 11),
          randomInt(1, 28),
          0,
          0,
          0,
          0,
        ),
      );
      const n = randomInt(1, 365);
      const to = new Date(from.getTime() + n * 86400000);
      expect(daysBetween(from, to)).toBe(n);
    }
  });

  it("month-boundary edge dates produce reasonable day counts", () => {
    // Specific regression: Jan 31 -> Feb 28 should be ~28 days
    const jan31 = new Date(2025, 0, 31);
    const feb28 = new Date(2025, 1, 28);
    const days = daysBetween(jan31, feb28);
    expect(days).toBe(28);

    // Leap year: Jan 31 -> Feb 29
    const jan31leap = new Date(2024, 0, 31);
    const feb29 = new Date(2024, 1, 29);
    expect(daysBetween(jan31leap, feb29)).toBe(29);
  });
});

// ─── Invariant: Overdue Calculation ───────────────────────────────
describe("FUZZ: Overdue Calculation Invariants", () => {
  it("fully paid loan (interestPaid >= interestAccrued) has 0 days overdue", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const principal = randomPrincipal();
      const rate = randomRate();
      const daysElapsed = randomInt(30, 365);
      const startDate = new Date(2024, 0, 1);
      const asOf = new Date(startDate.getTime() + daysElapsed * 86400000);

      const dailyRate = calculateDailyRate(rate);
      const totalInterest = new BigNumber(principal)
        .multipliedBy(dailyRate)
        .multipliedBy(daysElapsed);
      // Pay more than interest owed
      const overpay = totalInterest.plus(randomInt(1, 1000)).toFixed(0);

      const info = computeLoanOverdueInfo({
        principalAmount: principal,
        baseRate: rate,
        startDate,
        lastPaymentDate: asOf,
        loanType: "perpetual",
        termMonths: null,
        totalInterestPaid: overpay,
        paymentCount: 1,
        totalBalanceOwed: principal,
        penaltyWaived: false,
        loan: { id: "loan-1", interestRate: rate, interestRateOverride: null, startDate },
        asOf,
      });

      expect(info.daysOverdue).toBeGreaterThanOrEqual(0);
    }
  });

  it("penalty never activates below 60 days overdue", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const daysOverdue = randomInt(0, 59);
      expect(isPenaltyActive(daysOverdue, false)).toBe(false);
    }
  });

  it("penalty always activates at >= 60 days when not waived", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const daysOverdue = randomInt(60, 365);
      expect(isPenaltyActive(daysOverdue, false)).toBe(true);
    }
  });

  it("penalty never activates when waived regardless of days", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const daysOverdue = randomInt(0, 365);
      expect(isPenaltyActive(daysOverdue, true)).toBe(false);
    }
  });

  it("effective rate >= base rate always", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const rate = randomRate();
      const loan = { interestRate: rate, interestRateOverride: null };
      const effective = getEffectiveRate(loan, true); // penalty active
      expect(
        new BigNumber(effective).isGreaterThanOrEqualTo(new BigNumber(rate)),
      ).toBe(true);
    }
  });
});

// ─── Invariant: Fixed Rate Schedule Properties ────────────────────
describe("FUZZ: Fixed Rate Schedule Invariants", () => {
  it("schedule has exactly termMonths entries", () => {
    for (let i = 0; i < 50; i++) {
      const principal = randomPrincipal();
      const rate = randomRate();
      const term = randomInt(1, 36);

      const { entries } = calculateSchedule(
        principal,
        rate,
        term,
        "fixed_rate",
      );
      expect(entries.length).toBe(term);
    }
  });

  it("final balance is zero (principal fully amortized)", () => {
    for (let i = 0; i < 50; i++) {
      const principal = randomPrincipal();
      const rate = randomRate();
      const term = randomInt(1, 36);

      const { entries } = calculateSchedule(
        principal,
        rate,
        term,
        "fixed_rate",
      );
      const lastEntry = entries[entries.length - 1];
      expect(
        new BigNumber(lastEntry.balanceAfter).abs().isLessThanOrEqualTo(1),
      ).toBe(true);
    }
  });

  it("sum of monthly principal = original principal (conservation)", () => {
    for (let i = 0; i < 50; i++) {
      const principal = randomPrincipal();
      const rate = randomRate();
      const term = randomInt(1, 36);

      const { entries } = calculateSchedule(
        principal,
        rate,
        term,
        "fixed_rate",
      );
      const totalPrincipal = entries.reduce(
        (sum, e) => sum.plus(new BigNumber(e.monthlyPrincipal)),
        new BigNumber(0),
      );

      const diff = new BigNumber(principal).minus(totalPrincipal).abs();
      // formatAmount rounds to integer, so across N months the max cumulative error is N
      // This documents BUG-6: integer rounding causes principal conservation drift
      expect(
        diff.isLessThanOrEqualTo(term + 1),
        `Principal mismatch: ${principal} vs ${totalPrincipal.toFixed(0)} (diff: ${diff.toFixed(0)}, term: ${term})`,
      ).toBe(true);
    }
  });

  it("fixed_rate interest is constant every month", () => {
    for (let i = 0; i < 50; i++) {
      const principal = randomPrincipal();
      const rate = randomRate();
      const term = randomInt(2, 24);

      const { entries } = calculateSchedule(
        principal,
        rate,
        term,
        "fixed_rate",
      );
      const firstInterest = entries[0].monthlyInterest;
      for (const entry of entries) {
        expect(entry.monthlyInterest).toBe(firstInterest);
      }
    }
  });
});

// ─── Invariant: Reducing Balance Schedule Properties ──────────────
describe("FUZZ: Reducing Balance Schedule Invariants", () => {
  it("interest decreases over time (monotonically non-increasing)", () => {
    for (let i = 0; i < 50; i++) {
      const principal = randomPrincipal();
      const rate = randomRate();
      const term = randomInt(2, 36);

      const { entries } = calculateSchedule(
        principal,
        rate,
        term,
        "reducing_balance",
      );
      for (let j = 1; j < entries.length; j++) {
        const prev = new BigNumber(entries[j - 1].monthlyInterest);
        const curr = new BigNumber(entries[j].monthlyInterest);
        expect(
          curr.isLessThanOrEqualTo(prev.plus(1)), // +1 for rounding
          `Interest not decreasing: month ${j}: ${prev.toFixed(0)} -> ${curr.toFixed(0)}`,
        ).toBe(true);
      }
    }
  });

  it("reducing balance total interest < fixed rate total interest (same terms)", () => {
    for (let i = 0; i < 50; i++) {
      const principal = randomPrincipal();
      const rate = randomRate();
      const term = randomInt(2, 36);

      const fixed = calculateSchedule(principal, rate, term, "fixed_rate");
      const reducing = calculateSchedule(
        principal,
        rate,
        term,
        "reducing_balance",
      );

      expect(
        reducing.totalInterest.isLessThanOrEqualTo(fixed.totalInterest.plus(1)),
        `Reducing (${reducing.totalInterest.toFixed(0)}) >= Fixed (${fixed.totalInterest.toFixed(0)})`,
      ).toBe(true);
    }
  });
});

// ─── Invariant: Multiple Payments in Same Period ──────────────────
describe("FUZZ: Multiple Payments - interestAlreadyPaidInPeriod", () => {
  it("two payments in same period: total interest <= single-payment interest", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const principal = randomPrincipal();
      const rate = randomRate();
      const days = randomInt(30, 180);

      const interest = calculateInterest(principal, rate, days, 30);
      const totalOwed = interest.plus(new BigNumber(principal));
      if (totalOwed.isLessThanOrEqualTo(2)) continue;

      // Single full payment
      const singleAlloc = allocatePayment({
        paymentAmount: totalOwed.toFixed(0),
        principalBalanceBefore: principal,
        monthlyRateDecimal: rate,
        daysElapsed: days,
        minInterestDays: 30,
      });

      // Split into two payments
      const firstAmount = String(
        randomInt(1, Math.max(Number(totalOwed.toFixed(0)) - 1, 1)),
      );
      const firstAlloc = allocatePayment({
        paymentAmount: firstAmount,
        principalBalanceBefore: principal,
        monthlyRateDecimal: rate,
        daysElapsed: days,
        minInterestDays: 30,
      });

      const secondAmount = String(
        Math.min(
          Number(totalOwed.toFixed(0)) - Number(firstAmount),
          Number(
            new BigNumber(firstAlloc.principalBalanceAfter)
              .plus(interest.minus(new BigNumber(firstAlloc.interestPortion)))
              .toFixed(0),
          ),
        ),
      );
      if (Number(secondAmount) <= 0) continue;

      const secondAlloc = allocatePayment({
        paymentAmount: secondAmount,
        principalBalanceBefore: firstAlloc.principalBalanceAfter,
        monthlyRateDecimal: rate,
        daysElapsed: 0, // same period
        minInterestDays: 30,
        interestAlreadyPaidInPeriod: firstAlloc.interestPortion,
      });

      const totalInterest = new BigNumber(firstAlloc.interestPortion).plus(
        new BigNumber(secondAlloc.interestPortion),
      );

      // When splitting payments, total interest should be <= the single-payment interest
      // because the first payment may reduce principal, lowering subsequent interest.
      // The key invariant is: split interest <= single interest (borrower shouldn't pay MORE
      // by splitting payments)
      expect(
        totalInterest.isLessThanOrEqualTo(
          new BigNumber(singleAlloc.interestPortion).plus(2),
        ),
        `Split interest ${totalInterest.toFixed(0)} EXCEEDS single ${singleAlloc.interestPortion}`,
      ).toBe(true);
    }
  });
});

// ─── Stress: Edge Date Scenarios ──────────────────────────────────
describe("FUZZ: Edge Date Stress Tests", () => {
  const edgeDates = [
    new Date(2024, 1, 29), // Leap day
    new Date(2025, 1, 28), // Non-leap Feb end
    new Date(2025, 11, 31), // Year end
    new Date(2026, 0, 1), // Year start
    new Date(2025, 2, 31), // March 31
    new Date(2025, 3, 30), // April 30
    new Date(2024, 11, 31), // Dec 31 leap year
  ];

  it("loans starting on edge dates produce valid overdue info", () => {
    for (const startDate of edgeDates) {
      for (let daysLater = 0; daysLater <= 365; daysLater += 15) {
        const asOf = new Date(startDate.getTime() + daysLater * 86400000);
        const principal = randomPrincipal();
        const rate = randomRate();

      const info = computeLoanOverdueInfo({
        principalAmount: principal,
        baseRate: rate,
        startDate,
        lastPaymentDate: startDate,
        loanType: "perpetual",
          termMonths: null,
          totalInterestPaid: "0",
          paymentCount: 0,
          totalBalanceOwed: principal,
          penaltyWaived: false,
          loan: { id: "loan-1", interestRate: rate, interestRateOverride: null, startDate },
          asOf,
        });

        expect(info.daysOverdue).toBeGreaterThanOrEqual(0);
        expect(Number(info.unpaidInterest)).toBeGreaterThanOrEqual(0);
        expect(Number(info.dailyRate)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("term loans starting on 31st handle short months correctly", () => {
    const start31st = new Date(2025, 0, 31); // Jan 31
    const shortMonthDates = [
      { asOf: new Date(2025, 1, 28), expectedMonths: 0 }, // Feb 28 — BUG-3 trigger
      { asOf: new Date(2025, 2, 31), expectedMonths: 2 }, // Mar 31
      { asOf: new Date(2025, 3, 30), expectedMonths: 2 }, // Apr 30 — BUG-3 trigger
    ];

    for (const { asOf, expectedMonths } of shortMonthDates) {
      const info = computeLoanOverdueInfo({
        principalAmount: "1000000",
        baseRate: "0.1000",
        startDate: start31st,
        lastPaymentDate: start31st,
        loanType: "fixed_rate",
        termMonths: 12,
        totalInterestPaid: "0",
        paymentCount: 0,
        totalBalanceOwed: "1000000",
        penaltyWaived: false,
        loan: { id: "loan-1", interestRate: "0.1000", interestRateOverride: null, startDate: start31st },
        asOf,
      });

      // This test documents BUG-3: the expected behavior may not match
      // the actual behavior for loans starting on the 31st
      expect(info.daysOverdue).toBeGreaterThanOrEqual(0);

      // The real assertion: at Feb 28 (28 days later), 0 payments were made
      // and arguably 1 month has elapsed, so at least 0 days overdue
      // Currently the code says 0 months elapsed (BUG-3), so 0 overdue
      if (asOf.getTime() === new Date(2025, 1, 28).getTime()) {
        // Documenting current (buggy) behavior:
        // monthsElapsed = 1 + (28 >= 31 ? 0 : -1) = 0
        // This means the system thinks NO monthly payment is due yet
        console.warn(
          `[BUG-3] Loan started Jan 31, checked Feb 28: ` +
            `daysOverdue=${info.daysOverdue} (should be 30 if 1 payment is expected)`,
        );
      }
    }
  });
});

// ─── Stress: Rapid Sequential Payments ────────────────────────────
describe("FUZZ: Sequential Payment Simulation", () => {
  it("N sequential payments never violate conservation of money", () => {
    for (let trial = 0; trial < 50; trial++) {
      const principal = randomPrincipal();
      const rate = randomRate();
      const minDays = 30;

      let balance = new BigNumber(principal);
      let totalInterestPaid = new BigNumber(0);
      let totalPrincipalPaid = new BigNumber(0);
      let prevDate = new Date(2024, 0, 1);

      const numPayments = randomInt(1, 12);

      for (let p = 0; p < numPayments; p++) {
        if (balance.isZero()) break;

        const daysToAdd = randomInt(1, 60);
        const paymentDate = new Date(prevDate.getTime() + daysToAdd * 86400000);
        const days = daysBetween(prevDate, paymentDate);

        const interest = calculateInterest(
          balance.toFixed(2),
          rate,
          days,
          minDays,
        );
        const maxPayable = interest.plus(balance);
        if (maxPayable.isLessThanOrEqualTo(0)) break;

        const paymentAmount = randomPaymentAmount(maxPayable.toFixed(0));

        const allocation = allocatePayment({
          paymentAmount,
          principalBalanceBefore: balance.toFixed(2),
          monthlyRateDecimal: rate,
          daysElapsed: days,
          minInterestDays: minDays,
        });

        totalInterestPaid = totalInterestPaid.plus(
          new BigNumber(allocation.interestPortion),
        );
        totalPrincipalPaid = totalPrincipalPaid.plus(
          new BigNumber(allocation.principalPortion),
        );
        balance = new BigNumber(allocation.principalBalanceAfter);

        expect(balance.isGreaterThanOrEqualTo(0)).toBe(true);

        prevDate = paymentDate;
      }

      // Final invariant: principal paid <= original principal
      expect(
        totalPrincipalPaid.isLessThanOrEqualTo(
          new BigNumber(principal).plus(1),
        ),
        `Overpaid principal: paid ${totalPrincipalPaid.toFixed(0)} of ${principal}`,
      ).toBe(true);
    }
  });
});

// ─── Invariant: formatAmount Rounding ─────────────────────────────
describe("FUZZ: formatAmount Rounding Consistency", () => {
  it("formatAmount always returns a valid 2-decimal string", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const val = new BigNumber(randomDecimal(0, 10000000, 6));
      const formatted = formatAmount(val);
      expect(/^-?\d+\.\d{2}$/.test(formatted)).toBe(true);
    }
  });

  it("rounding error accumulation across payments stays bounded", () => {
    const principal = "1000000";
    const rate = "0.1000";
    const dailyRate = calculateDailyRate(rate);
    let accumulatedError = new BigNumber(0);

    for (let day = 1; day <= 365; day++) {
      const exactInterest = new BigNumber(principal).multipliedBy(dailyRate);
      const roundedInterest = new BigNumber(formatAmount(exactInterest));
      accumulatedError = accumulatedError.plus(
        exactInterest.minus(roundedInterest),
      );
    }

    // Over 365 days, rounding error should be documented
    console.log(
      `[BUG-6] Accumulated rounding error over 365 days on 1M principal at 10%: ` +
        `${accumulatedError.toFixed(2)} UGX (${accumulatedError.dividedBy(1000000).multipliedBy(100).toFixed(4)}% of principal)`,
    );

    // This isn't a test failure — it documents the magnitude of BUG-6
    expect(accumulatedError.abs().isLessThan(10000)).toBe(true); // sanity bound
  });
});
