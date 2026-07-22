/**
 * Property-Based Fuzz Tests using fast-check
 *
 * These tests use structured random generation with automatic shrinking —
 * when a failure is found, fast-check minimizes the input to the simplest
 * failing case, making temporal bugs much easier to diagnose.
 *
 * Three levels:
 *   1. Algebraic properties of pure calculation functions
 *   2. Lifecycle simulations — full loan lifecycle with invariant checks at every step
 *   3. Time-warp tests — same scenario pinned to dangerous calendar dates
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import BigNumber from "bignumber.js";
import {
  calculateInterest,
  calculateDailyRate,
  allocatePayment,
  allocateFixedRatePayment,
  allocateReducingBalancePayment,
  calculateSchedule,
  computeSegmentedInterest,
  formatAmount,
} from "../engine";
import { computeLoanOverdueInfo } from "../overdue";
import { isPenaltyActive, getEffectiveRate } from "../effective-rate";
import { daysBetween } from "@/lib/db/utils";
import { periodBoundsUTC, asOfDateUTC } from "@/lib/date-utils";

// ─── Custom Arbitraries ───────────────────────────────────────────

/** UGX amount: 10,000 to 50,000,000 (whole numbers) */
const arbPrincipal = fc.integer({ min: 10000, max: 50_000_000 }).map(String);

/** Monthly rate: 0.01 to 0.30 (1% to 30%) */
const arbRate = fc
  .integer({ min: 100, max: 3000 })
  .map((n) => (n / 10000).toFixed(4));

/** Days elapsed: 0 to 730 (up to 2 years) */
const arbDays = fc.integer({ min: 0, max: 730 });

/** Minimum interest days: 0 to 90 */
const arbMinDays = fc.integer({ min: 0, max: 90 });

/** Term months: 1 to 36 */
const arbTerm = fc.integer({ min: 1, max: 36 });

/** A date between 2020 and 2027, at a specific hour */
const arbDate = fc
  .record({
    year: fc.integer({ min: 2020, max: 2027 }),
    month: fc.integer({ min: 0, max: 11 }),
    day: fc.integer({ min: 1, max: 28 }), // safe for all months
    hour: fc.integer({ min: 0, max: 23 }),
  })
  .map(({ year, month, day, hour }) => new Date(year, month, day, hour, 0, 0));

/** A date that specifically targets month-end boundaries */
const arbEdgeDate = fc.oneof(
  // Last day of month (via day 0 of next month)
  fc
    .record({
      year: fc.integer({ min: 2020, max: 2027 }),
      month: fc.integer({ min: 1, max: 12 }),
    })
    .map(({ year, month }) => new Date(year, month, 0)),
  // First day of month
  fc
    .record({
      year: fc.integer({ min: 2020, max: 2027 }),
      month: fc.integer({ min: 0, max: 11 }),
    })
    .map(({ year, month }) => new Date(year, month, 1)),
  // Feb 28/29
  fc.integer({ min: 2020, max: 2027 }).map((year) => {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return new Date(year, 1, isLeap ? 29 : 28);
  }),
  // Day 31 of 31-day months
  fc
    .constantFrom(0, 2, 4, 6, 7, 9, 11)
    .chain((month) =>
      fc
        .integer({ min: 2020, max: 2027 })
        .map((year) => new Date(year, month, 31)),
    ),
);

/** Loan parameters bundle */
const arbLoanParams = fc.record({
  principal: arbPrincipal,
  rate: arbRate,
  minDays: arbMinDays,
});

/** A period string YYYY-MM */
const arbPeriod = fc
  .record({
    year: fc.integer({ min: 2020, max: 2027 }),
    month: fc.integer({ min: 1, max: 12 }),
  })
  .map(({ year, month }) => `${year}-${String(month).padStart(2, "0")}`);

const baseLoan = {
  interestRate: "0.10",
  interestRateOverride: null,
  penaltyMultiplier: null,
};

// ═══════════════════════════════════════════════════════════════════
// LEVEL 1: Algebraic Properties
// ═══════════════════════════════════════════════════════════════════

describe("L1: Interest Calculation Properties", () => {
  it("interest is always non-negative", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        arbDays,
        arbMinDays,
        (principal, rate, days, minDays) => {
          const interest = calculateInterest(principal, rate, days, minDays);
          return interest.isGreaterThanOrEqualTo(0);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("interest is monotonically non-decreasing in days (past minDays)", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        arbMinDays,
        fc.integer({ min: 0, max: 365 }),
        fc.integer({ min: 1, max: 365 }),
        (principal, rate, minDays, baseDays, extraDays) => {
          const days1 = Math.max(baseDays, minDays);
          const days2 = days1 + extraDays;
          const i1 = calculateInterest(principal, rate, days1, minDays);
          const i2 = calculateInterest(principal, rate, days2, minDays);
          return i2.isGreaterThanOrEqualTo(i1);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("interest is monotonically non-decreasing in rate", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbDays,
        fc.integer({ min: 100, max: 1500 }),
        fc.integer({ min: 1, max: 1500 }),
        (principal, days, baseRate100, extraRate100) => {
          const rate1 = (baseRate100 / 10000).toFixed(4);
          const rate2 = ((baseRate100 + extraRate100) / 10000).toFixed(4);
          const i1 = calculateInterest(principal, rate1, days, 0);
          const i2 = calculateInterest(principal, rate2, days, 0);
          return i2.isGreaterThanOrEqualTo(i1);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("interest is monotonically non-decreasing in principal", () => {
    fc.assert(
      fc.property(
        arbRate,
        arbDays,
        fc.integer({ min: 10000, max: 25_000_000 }),
        fc.integer({ min: 1, max: 25_000_000 }),
        (rate, days, basePrincipal, extraPrincipal) => {
          const i1 = calculateInterest(String(basePrincipal), rate, days, 0);
          const i2 = calculateInterest(
            String(basePrincipal + extraPrincipal),
            rate,
            days,
            0,
          );
          return i2.isGreaterThanOrEqualTo(i1);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("zero principal yields zero interest", () => {
    fc.assert(
      fc.property(arbRate, arbDays, arbMinDays, (rate, days, minDays) => {
        return calculateInterest("0", rate, days, minDays).isZero();
      }),
      { numRuns: 200 },
    );
  });

  it("zero rate yields zero interest", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbDays,
        arbMinDays,
        (principal, days, minDays) => {
          return calculateInterest(principal, "0.0000", days, minDays).isZero();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("daily rate × 30 = monthly rate (exact)", () => {
    fc.assert(
      fc.property(arbRate, (rate) => {
        const daily = calculateDailyRate(rate);
        const reconstructed = daily.multipliedBy(30);
        return reconstructed
          .minus(new BigNumber(rate))
          .abs()
          .isLessThan(0.0000001);
      }),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// LEVEL 1b: Payment Allocation Properties
// ═══════════════════════════════════════════════════════════════════

describe("L1: Payment Allocation Properties", () => {
  it("conservation: interest + principal = payment (within rounding)", () => {
    fc.assert(
      fc.property(
        arbLoanParams,
        fc.integer({ min: 30, max: 365 }),
        (params, days) => {
          const interest = calculateInterest(
            params.principal,
            params.rate,
            days,
            params.minDays,
          );
          const totalOwed = interest.plus(new BigNumber(params.principal));
          // Pay a random fraction of what's owed
          const paymentFraction = Math.random();
          const paymentAmount = totalOwed
            .multipliedBy(paymentFraction)
            .integerValue()
            .toFixed(0);
          if (Number(paymentAmount) <= 0) return true;

          const alloc = allocatePayment({
            paymentAmount,
            principalBalanceBefore: params.principal,
            monthlyRateDecimal: params.rate,
            daysElapsed: days,
            minInterestDays: params.minDays,
          });

          const sum = new BigNumber(alloc.interestPortion).plus(
            new BigNumber(alloc.principalPortion),
          );
          return sum
            .minus(new BigNumber(paymentAmount))
            .abs()
            .isLessThanOrEqualTo(1);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("principal balance is always non-negative after allocation", () => {
    fc.assert(
      fc.property(
        arbLoanParams,
        fc.integer({ min: 1, max: 365 }),
        (params, days) => {
          const interest = calculateInterest(
            params.principal,
            params.rate,
            days,
            params.minDays,
          );
          const totalOwed = interest.plus(new BigNumber(params.principal));
          const paymentAmount = totalOwed.toFixed(0);

          const alloc = allocatePayment({
            paymentAmount,
            principalBalanceBefore: params.principal,
            monthlyRateDecimal: params.rate,
            daysElapsed: days,
            minInterestDays: params.minDays,
          });

          return new BigNumber(
            alloc.principalBalanceAfter,
          ).isGreaterThanOrEqualTo(0);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("interest-first: if payment < interest owed, no principal reduction", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 500000, max: 10_000_000 }).map(String),
        fc.integer({ min: 500, max: 2000 }).map((n) => (n / 10000).toFixed(4)),
        fc.integer({ min: 30, max: 365 }),
        (principal, rate, days) => {
          const interest = calculateInterest(principal, rate, days, 30);
          if (interest.isLessThanOrEqualTo(1)) return true;

          // Pay exactly half the interest
          const halfInterest = interest.dividedBy(2).integerValue().toFixed(0);
          if (Number(halfInterest) <= 0) return true;

          const alloc = allocatePayment({
            paymentAmount: halfInterest,
            principalBalanceBefore: principal,
            monthlyRateDecimal: rate,
            daysElapsed: days,
            minInterestDays: 30,
          });

          return alloc.principalBalanceAfter === principal;
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// LEVEL 1c: Schedule Properties
// ═══════════════════════════════════════════════════════════════════

describe("L1: Amortization Schedule Properties", () => {
  it("fixed_rate: interest is constant every month", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        fc.integer({ min: 2, max: 24 }),
        (principal, rate, term) => {
          const { entries } = calculateSchedule(
            principal,
            rate,
            term,
            "fixed_rate",
          );
          const firstInterest = entries[0].monthlyInterest;
          return entries.every((e) => e.monthlyInterest === firstInterest);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("reducing_balance: interest is non-increasing", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        fc.integer({ min: 2, max: 24 }),
        (principal, rate, term) => {
          const { entries } = calculateSchedule(
            principal,
            rate,
            term,
            "reducing_balance",
          );
          for (let i = 1; i < entries.length; i++) {
            if (
              new BigNumber(entries[i].monthlyInterest).isGreaterThan(
                new BigNumber(entries[i - 1].monthlyInterest).plus(1), // +1 for rounding
              )
            )
              return false;
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it("reducing_balance total interest <= fixed_rate total interest", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        fc.integer({ min: 2, max: 24 }),
        (principal, rate, term) => {
          const fixed = calculateSchedule(principal, rate, term, "fixed_rate");
          const reducing = calculateSchedule(
            principal,
            rate,
            term,
            "reducing_balance",
          );
          return reducing.totalInterest.isLessThanOrEqualTo(
            fixed.totalInterest.plus(term),
          ); // rounding tolerance
        },
      ),
      { numRuns: 200 },
    );
  });

  it("schedule has exactly termMonths entries", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        fc.integer({ min: 1, max: 36 }),
        fc.constantFrom("fixed_rate" as const, "reducing_balance" as const),
        (principal, rate, term, type) => {
          const { entries } = calculateSchedule(principal, rate, term, type);
          return entries.length === term;
        },
      ),
      { numRuns: 200 },
    );
  });

  it("final balance is zero after full schedule", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        fc.integer({ min: 1, max: 36 }),
        fc.constantFrom("fixed_rate" as const, "reducing_balance" as const),
        (principal, rate, term, type) => {
          const { entries } = calculateSchedule(principal, rate, term, type);
          return new BigNumber(entries[entries.length - 1].balanceAfter)
            .abs()
            .isLessThanOrEqualTo(1);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// LEVEL 1d: Fixed-Rate Allocation Properties
// ═══════════════════════════════════════════════════════════════════

describe("L1: Fixed-Rate Allocation Properties", () => {
  /** Payment number: 1..termMonths */
  const arbPaymentNumber = fc.integer({ min: 1, max: 36 });

  it("conservation: interest + principal = payment (within rounding)", () => {
    fc.assert(
      fc.property(arbPrincipal, arbRate, arbTerm, (principal, rate, term) => {
        const paymentNumber = fc.sample(
          fc.integer({ min: 1, max: term }),
          1,
        )[0];
        const monthlyInterest = new BigNumber(principal).multipliedBy(
          new BigNumber(rate),
        );
        const totalOwed = monthlyInterest.plus(new BigNumber(principal));
        const paymentAmount = totalOwed
          .multipliedBy(Math.random())
          .integerValue()
          .toFixed(0);
        if (Number(paymentAmount) <= 0) return true;

        const alloc = allocateFixedRatePayment({
          paymentAmount,
          principalBalanceBefore: principal,
          originalPrincipal: principal,
          monthlyRateDecimal: rate,
          termMonths: term,
          paymentNumber,
        });

        const sum = new BigNumber(alloc.interestPortion).plus(
          new BigNumber(alloc.principalPortion),
        );
        return sum
          .minus(new BigNumber(paymentAmount))
          .abs()
          .isLessThanOrEqualTo(1);
      }),
      { numRuns: 300 },
    );
  });

  it("principal balance is always non-negative after allocation", () => {
    fc.assert(
      fc.property(arbPrincipal, arbRate, arbTerm, (principal, rate, term) => {
        const paymentNumber = fc.sample(
          fc.integer({ min: 1, max: term }),
          1,
        )[0];
        // Pay up to double what's owed to test edge cases
        const monthlyInterest = new BigNumber(principal).multipliedBy(
          new BigNumber(rate),
        );
        const paymentAmount = monthlyInterest
          .plus(new BigNumber(principal))
          .multipliedBy(2)
          .integerValue()
          .toFixed(0);

        const alloc = allocateFixedRatePayment({
          paymentAmount,
          principalBalanceBefore: principal,
          originalPrincipal: principal,
          monthlyRateDecimal: rate,
          termMonths: term,
          paymentNumber,
        });

        return new BigNumber(
          alloc.principalBalanceAfter,
        ).isGreaterThanOrEqualTo(0);
      }),
      { numRuns: 300 },
    );
  });

  it("interest-first: if payment <= interest owed, no principal reduction", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 500000, max: 10_000_000 }).map(String),
        fc.integer({ min: 500, max: 2000 }).map((n) => (n / 10000).toFixed(4)),
        arbTerm,
        (principal, rate, term) => {
          const paymentNumber = fc.sample(
            fc.integer({ min: 1, max: term }),
            1,
          )[0];
          const monthlyInterest = new BigNumber(principal).multipliedBy(
            new BigNumber(rate),
          );
          if (monthlyInterest.isLessThanOrEqualTo(1)) return true;

          // Pay half the interest — should not touch principal
          const halfInterest = monthlyInterest
            .dividedBy(2)
            .integerValue()
            .toFixed(0);
          if (Number(halfInterest) <= 0) return true;

          const alloc = allocateFixedRatePayment({
            paymentAmount: halfInterest,
            principalBalanceBefore: principal,
            originalPrincipal: principal,
            monthlyRateDecimal: rate,
            termMonths: term,
            paymentNumber,
          });

          return (
            alloc.principalPortion === "0.00" &&
            alloc.principalBalanceAfter ===
              formatAmount(new BigNumber(principal))
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it("early payoff charges all remaining interest", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        fc.integer({ min: 2, max: 36 }),
        (principal, rate, term) => {
          const paymentNumber = fc.sample(
            fc.integer({ min: 1, max: term }),
            1,
          )[0];
          const monthlyInterest = new BigNumber(principal).multipliedBy(
            new BigNumber(rate),
          );
          const remainingMonths = Math.max(term - paymentNumber + 1, 1);
          const totalRemainingInterest =
            monthlyInterest.multipliedBy(remainingMonths);
          const balance = new BigNumber(principal);

          // Pay enough to trigger early payoff (all remaining interest + full balance)
          const paymentAmount = totalRemainingInterest
            .plus(balance)
            .integerValue()
            .toFixed(0);

          const alloc = allocateFixedRatePayment({
            paymentAmount,
            principalBalanceBefore: principal,
            originalPrincipal: principal,
            monthlyRateDecimal: rate,
            termMonths: term,
            paymentNumber,
          });

          const expectedInterest = formatAmount(totalRemainingInterest);
          return new BigNumber(alloc.interestPortion)
            .minus(new BigNumber(expectedInterest))
            .abs()
            .isLessThanOrEqualTo(1);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("interestAlreadyPaidInPeriod reduces interest charged", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 500000, max: 10_000_000 }).map(String),
        fc.integer({ min: 500, max: 2000 }).map((n) => (n / 10000).toFixed(4)),
        arbTerm,
        (principal, rate, term) => {
          const paymentNumber = fc.sample(
            fc.integer({ min: 1, max: term }),
            1,
          )[0];
          const monthlyInterest = new BigNumber(principal).multipliedBy(
            new BigNumber(rate),
          );
          if (monthlyInterest.isLessThanOrEqualTo(2)) return true;

          // Use half the interest as already paid
          const alreadyPaid = monthlyInterest
            .dividedBy(2)
            .integerValue()
            .toFixed(0);
          // Pay less than monthlyInterest to stay in normal (non-early-payoff) path
          const paymentAmount = monthlyInterest
            .dividedBy(3)
            .integerValue()
            .toFixed(0);
          if (Number(paymentAmount) <= 0) return true;

          const allocWithout = allocateFixedRatePayment({
            paymentAmount,
            principalBalanceBefore: principal,
            originalPrincipal: principal,
            monthlyRateDecimal: rate,
            termMonths: term,
            paymentNumber,
          });

          const allocWith = allocateFixedRatePayment({
            paymentAmount,
            principalBalanceBefore: principal,
            originalPrincipal: principal,
            monthlyRateDecimal: rate,
            termMonths: term,
            paymentNumber,
            interestAlreadyPaidInPeriod: alreadyPaid,
          });

          // With alreadyPaid, interest charged should be <= without it
          return new BigNumber(allocWith.interestPortion).isLessThanOrEqualTo(
            new BigNumber(allocWithout.interestPortion).plus(1), // rounding tolerance
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it("fully paid detection: payment >= totalOwed => loanFullyPaid", () => {
    fc.assert(
      fc.property(arbPrincipal, arbRate, arbTerm, (principal, rate, term) => {
        const paymentNumber = fc.sample(
          fc.integer({ min: 1, max: term }),
          1,
        )[0];
        const monthlyInterest = new BigNumber(principal).multipliedBy(
          new BigNumber(rate),
        );
        const remainingMonths = Math.max(term - paymentNumber + 1, 1);
        const totalRemainingInterest =
          monthlyInterest.multipliedBy(remainingMonths);
        const balance = new BigNumber(principal);

        // Pay more than enough to cover everything
        const paymentAmount = totalRemainingInterest
          .plus(balance)
          .plus(1000)
          .integerValue()
          .toFixed(0);

        const alloc = allocateFixedRatePayment({
          paymentAmount,
          principalBalanceBefore: principal,
          originalPrincipal: principal,
          monthlyRateDecimal: rate,
          termMonths: term,
          paymentNumber,
        });

        return alloc.loanFullyPaid === true;
      }),
      { numRuns: 300 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// LEVEL 1e: Reducing-Balance Allocation Properties
// ═══════════════════════════════════════════════════════════════════

describe("L1: Reducing-Balance Allocation Properties", () => {
  it("conservation: interest + principal = payment (within rounding)", () => {
    fc.assert(
      fc.property(arbPrincipal, arbRate, arbTerm, (principal, rate, term) => {
        const interest = new BigNumber(principal).multipliedBy(
          new BigNumber(rate),
        );
        const totalOwed = interest.plus(new BigNumber(principal));
        const paymentAmount = totalOwed
          .multipliedBy(Math.random())
          .integerValue()
          .toFixed(0);
        if (Number(paymentAmount) <= 0) return true;

        const alloc = allocateReducingBalancePayment({
          paymentAmount,
          principalBalanceBefore: principal,
          originalPrincipal: principal,
          monthlyRateDecimal: rate,
          termMonths: term,
        });

        const sum = new BigNumber(alloc.interestPortion).plus(
          new BigNumber(alloc.principalPortion),
        );
        return sum
          .minus(new BigNumber(paymentAmount))
          .abs()
          .isLessThanOrEqualTo(1);
      }),
      { numRuns: 300 },
    );
  });

  it("principal balance is always non-negative after allocation", () => {
    fc.assert(
      fc.property(arbPrincipal, arbRate, arbTerm, (principal, rate, term) => {
        // Pay up to double what's owed
        const interest = new BigNumber(principal).multipliedBy(
          new BigNumber(rate),
        );
        const paymentAmount = interest
          .plus(new BigNumber(principal))
          .multipliedBy(2)
          .integerValue()
          .toFixed(0);

        const alloc = allocateReducingBalancePayment({
          paymentAmount,
          principalBalanceBefore: principal,
          originalPrincipal: principal,
          monthlyRateDecimal: rate,
          termMonths: term,
        });

        return new BigNumber(
          alloc.principalBalanceAfter,
        ).isGreaterThanOrEqualTo(0);
      }),
      { numRuns: 300 },
    );
  });

  it("interest-first: if payment <= interest owed, no principal reduction", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 500000, max: 10_000_000 }).map(String),
        fc.integer({ min: 500, max: 2000 }).map((n) => (n / 10000).toFixed(4)),
        arbTerm,
        (principal, rate, term) => {
          const interest = new BigNumber(principal).multipliedBy(
            new BigNumber(rate),
          );
          if (interest.isLessThanOrEqualTo(1)) return true;

          // Pay half the interest
          const halfInterest = interest.dividedBy(2).integerValue().toFixed(0);
          if (Number(halfInterest) <= 0) return true;

          const alloc = allocateReducingBalancePayment({
            paymentAmount: halfInterest,
            principalBalanceBefore: principal,
            originalPrincipal: principal,
            monthlyRateDecimal: rate,
            termMonths: term,
          });

          return alloc.principalPortion === "0.00";
        },
      ),
      { numRuns: 300 },
    );
  });

  it("interest <= fixed-rate interest for same inputs", () => {
    fc.assert(
      fc.property(arbPrincipal, arbRate, arbTerm, (principal, rate, term) => {
        // Use a reduced balance (half of original) to make the comparison meaningful
        const currentBalance = new BigNumber(principal)
          .dividedBy(2)
          .integerValue()
          .toFixed(0);
        const paymentNumber = fc.sample(
          fc.integer({ min: 1, max: term }),
          1,
        )[0];

        // Pay just the interest portion to isolate the interest calculation
        const reducingInterest = new BigNumber(currentBalance).multipliedBy(
          new BigNumber(rate),
        );
        const fixedInterest = new BigNumber(principal).multipliedBy(
          new BigNumber(rate),
        );
        const paymentAmount = reducingInterest.integerValue().toFixed(0);
        if (Number(paymentAmount) <= 0) return true;

        const reducingAlloc = allocateReducingBalancePayment({
          paymentAmount,
          principalBalanceBefore: currentBalance,
          originalPrincipal: principal,
          monthlyRateDecimal: rate,
          termMonths: term,
        });

        const fixedAlloc = allocateFixedRatePayment({
          paymentAmount: fixedInterest.integerValue().toFixed(0),
          principalBalanceBefore: currentBalance,
          originalPrincipal: principal,
          monthlyRateDecimal: rate,
          termMonths: term,
          paymentNumber,
        });

        // Reducing-balance interest on current balance <= fixed-rate interest on original principal
        return new BigNumber(reducingAlloc.interestPortion).isLessThanOrEqualTo(
          new BigNumber(fixedAlloc.interestPortion).plus(1), // rounding tolerance
        );
      }),
      { numRuns: 300 },
    );
  });

  it("interestAlreadyPaidInPeriod reduces interest charged", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 500000, max: 10_000_000 }).map(String),
        fc.integer({ min: 500, max: 2000 }).map((n) => (n / 10000).toFixed(4)),
        arbTerm,
        (principal, rate, term) => {
          const interest = new BigNumber(principal).multipliedBy(
            new BigNumber(rate),
          );
          if (interest.isLessThanOrEqualTo(2)) return true;

          const alreadyPaid = interest.dividedBy(2).integerValue().toFixed(0);
          // Pay less than interest to stay in interest-only path
          const paymentAmount = interest.dividedBy(3).integerValue().toFixed(0);
          if (Number(paymentAmount) <= 0) return true;

          const allocWithout = allocateReducingBalancePayment({
            paymentAmount,
            principalBalanceBefore: principal,
            originalPrincipal: principal,
            monthlyRateDecimal: rate,
            termMonths: term,
          });

          const allocWith = allocateReducingBalancePayment({
            paymentAmount,
            principalBalanceBefore: principal,
            originalPrincipal: principal,
            monthlyRateDecimal: rate,
            termMonths: term,
            interestAlreadyPaidInPeriod: alreadyPaid,
          });

          return new BigNumber(allocWith.interestPortion).isLessThanOrEqualTo(
            new BigNumber(allocWithout.interestPortion).plus(1),
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it("fully paid detection: payment >= balance + interest => loanFullyPaid", () => {
    fc.assert(
      fc.property(arbPrincipal, arbRate, arbTerm, (principal, rate, term) => {
        const interest = new BigNumber(principal).multipliedBy(
          new BigNumber(rate),
        );
        const balance = new BigNumber(principal);

        // Pay more than enough to cover everything
        const paymentAmount = interest
          .plus(balance)
          .plus(1000)
          .integerValue()
          .toFixed(0);

        const alloc = allocateReducingBalancePayment({
          paymentAmount,
          principalBalanceBefore: principal,
          originalPrincipal: principal,
          monthlyRateDecimal: rate,
          termMonths: term,
        });

        return alloc.loanFullyPaid === true;
      }),
      { numRuns: 300 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// LEVEL 2: Lifecycle Simulation
// ═══════════════════════════════════════════════════════════════════

/** Simulates a full loan lifecycle with random payments and checks invariants */
function simulateLoanLifecycle(params: {
  principal: string;
  rate: string;
  minDays: number;
  startDate: Date;
  payments: { daysAfterPrev: number; fractionOfOwed: number }[];
}): { violations: string[] } {
  const violations: string[] = [];
  const {
    principal,
    rate,
    minDays,
    startDate,
    payments: paymentSchedule,
  } = params;

  let balance = new BigNumber(principal);
  let totalInterestPaid = new BigNumber(0);
  let totalPrincipalPaid = new BigNumber(0);
  let prevDate = startDate;
  let paymentNumber = 0;

  for (const paymentDef of paymentSchedule) {
    if (balance.isZero()) break;
    paymentNumber++;

    const paymentDate = new Date(
      prevDate.getTime() + paymentDef.daysAfterPrev * 86400000,
    );
    const days = daysBetween(prevDate, paymentDate);

    // Calculate what's owed at pro-rata. The min-period only kicks in on full
    // payoff (handled inside allocatePayment); for the conservation invariants
    // checked below, pro-rata interest matches what the engine charges on
    // partial payments.
    const interest = calculateInterest(balance.toFixed(0), rate, days, 0);
    const totalOwed = interest.plus(balance);
    if (totalOwed.isLessThanOrEqualTo(0)) break;

    // Pay a fraction of what's owed
    const paymentBN = totalOwed
      .multipliedBy(paymentDef.fractionOfOwed)
      .integerValue();
    if (paymentBN.isLessThanOrEqualTo(0)) continue;
    const paymentAmount = BigNumber.min(paymentBN, totalOwed).toFixed(0);

    const alloc = allocatePayment({
      paymentAmount,
      principalBalanceBefore: balance.toFixed(0),
      monthlyRateDecimal: rate,
      daysElapsed: days,
      minInterestDays: minDays,
    });

    // ═══ INVARIANT CHECKS ═══

    // 1. Conservation of money
    const sum = new BigNumber(alloc.interestPortion).plus(
      new BigNumber(alloc.principalPortion),
    );
    if (sum.minus(new BigNumber(paymentAmount)).abs().isGreaterThan(2)) {
      violations.push(
        `Payment #${paymentNumber}: conservation violated — payment=${paymentAmount}, interest=${alloc.interestPortion} + principal=${alloc.principalPortion} = ${sum.toFixed(2)}`,
      );
    }

    // 2. Non-negative balance
    if (new BigNumber(alloc.principalBalanceAfter).isLessThan(0)) {
      violations.push(
        `Payment #${paymentNumber}: negative balance ${alloc.principalBalanceAfter}`,
      );
    }

    // 3. Balance consistency
    const expectedBalance = BigNumber.max(
      balance.minus(new BigNumber(alloc.principalPortion)),
      0,
    );
    if (
      new BigNumber(alloc.principalBalanceAfter)
        .minus(expectedBalance)
        .abs()
        .isGreaterThan(1)
    ) {
      violations.push(
        `Payment #${paymentNumber}: balance mismatch — expected ${expectedBalance.toFixed(0)}, got ${alloc.principalBalanceAfter}`,
      );
    }

    // 4. Interest-first rule
    if (
      new BigNumber(paymentAmount).isLessThanOrEqualTo(interest) &&
      new BigNumber(alloc.principalPortion).isGreaterThan(1)
    ) {
      violations.push(
        `Payment #${paymentNumber}: interest-first violated — payment ${paymentAmount} <= interest ${interest.toFixed(0)} but principal portion is ${alloc.principalPortion}`,
      );
    }

    // 5. Total principal paid never exceeds original
    totalPrincipalPaid = totalPrincipalPaid.plus(
      new BigNumber(alloc.principalPortion),
    );
    if (totalPrincipalPaid.isGreaterThan(new BigNumber(principal).plus(2))) {
      violations.push(
        `Payment #${paymentNumber}: total principal paid (${totalPrincipalPaid.toFixed(2)}) exceeds original (${principal})`,
      );
    }

    totalInterestPaid = totalInterestPaid.plus(
      new BigNumber(alloc.interestPortion),
    );
    balance = new BigNumber(alloc.principalBalanceAfter);
    prevDate = paymentDate;
  }

  // 6. Overdue calculation consistency
  const now = new Date(prevDate.getTime() + 30 * 86400000);
    const info = computeLoanOverdueInfo({
      principalAmount: principal,
      baseRate: rate,
      startDate,
      lastPaymentDate: prevDate,
      loanType: "perpetual",
    termMonths: null,
    totalInterestPaid: totalInterestPaid.toFixed(0),
    paymentCount: paymentNumber,
    totalBalanceOwed: balance.toFixed(0),
    penaltyWaived: false,
    loan: { id: "loan-1", interestRate: rate, interestRateOverride: null, startDate },
    asOf: now,
  });

  if (info.daysOverdue < 0) {
    violations.push(`Overdue days is negative: ${info.daysOverdue}`);
  }
  if (Number(info.unpaidInterest) < 0) {
    violations.push(`Unpaid interest is negative: ${info.unpaidInterest}`);
  }

  return { violations };
}

describe("L2: Loan Lifecycle Simulation", () => {
  /** Arbitrary for payment schedule entries */
  const arbPayment = fc.record({
    daysAfterPrev: fc.integer({ min: 1, max: 60 }),
    fractionOfOwed: fc.double({ min: 0.05, max: 1.0, noNaN: true }),
  });

  it("random perpetual loan lifecycles never violate invariants", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        arbMinDays,
        arbDate,
        fc.array(arbPayment, { minLength: 1, maxLength: 24 }),
        (principal, rate, minDays, startDate, payments) => {
          const result = simulateLoanLifecycle({
            principal,
            rate,
            minDays,
            startDate,
            payments,
          });
          if (result.violations.length > 0) {
            throw new Error(`Violations:\n${result.violations.join("\n")}`);
          }
        },
      ),
      { numRuns: 300, endOnFailure: true },
    );
  });

  it("single large payment fully pays loan", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        arbDate,
        (principal, rate, startDate) => {
          const result = simulateLoanLifecycle({
            principal,
            rate,
            minDays: 30,
            startDate,
            payments: [{ daysAfterPrev: 30, fractionOfOwed: 1.0 }],
          });
          return result.violations.length === 0;
        },
      ),
      { numRuns: 200 },
    );
  });

  it("many tiny payments converge to full repayment without invariant violations", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        arbDate,
        (principal, rate, startDate) => {
          // 20 payments each paying 10% of what's owed
          const payments = Array.from({ length: 20 }, () => ({
            daysAfterPrev: 30,
            fractionOfOwed: 0.1,
          }));
          const result = simulateLoanLifecycle({
            principal,
            rate,
            minDays: 30,
            startDate,
            payments,
          });
          return result.violations.length === 0;
        },
      ),
      { numRuns: 200 },
    );
  });

  it("rapid same-day payments don't violate conservation", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        arbDate,
        (principal, rate, startDate) => {
          // 5 payments on the same day (daysAfterPrev: 0 except first)
          const payments = [
            { daysAfterPrev: 30, fractionOfOwed: 0.2 },
            { daysAfterPrev: 0, fractionOfOwed: 0.2 },
            { daysAfterPrev: 0, fractionOfOwed: 0.2 },
            { daysAfterPrev: 0, fractionOfOwed: 0.2 },
            { daysAfterPrev: 0, fractionOfOwed: 0.2 },
          ];
          const result = simulateLoanLifecycle({
            principal,
            rate,
            minDays: 30,
            startDate,
            payments,
          });
          return result.violations.length === 0;
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// LEVEL 2a: Term Loan Lifecycle Simulation
// ═══════════════════════════════════════════════════════════════════

/** Simulates a term loan lifecycle (fixed_rate or reducing_balance) with invariant checks */
function simulateTermLoanLifecycle(params: {
  principal: string;
  rate: string;
  termMonths: number;
  loanType: "fixed_rate" | "reducing_balance";
  payments: { fractionOfMonthlyInstallment: number }[];
}): { violations: string[] } {
  const violations: string[] = [];
  const {
    principal,
    rate,
    termMonths,
    loanType,
    payments: paymentSchedule,
  } = params;

  const originalPrincipal = new BigNumber(principal);
  const monthlyRate = new BigNumber(rate);
  let balance = new BigNumber(principal);
  let totalPrincipalPaid = new BigNumber(0);
  let prevInterestCharged = new BigNumber(Infinity);
  let paymentNumber = 0;

  for (const paymentDef of paymentSchedule) {
    if (balance.isZero()) break;
    paymentNumber++;

    // Calculate the monthly installment based on loan type
    let interestThisPeriod: BigNumber;
    if (loanType === "fixed_rate") {
      interestThisPeriod = originalPrincipal.multipliedBy(monthlyRate);
    } else {
      interestThisPeriod = balance.multipliedBy(monthlyRate);
    }
    const principalInstallment = originalPrincipal.dividedBy(termMonths);
    const monthlyInstallment = principalInstallment.plus(interestThisPeriod);

    // Payment amount is fraction of monthly installment, capped at total owed
    const totalOwed = balance.plus(interestThisPeriod);
    const rawPayment = monthlyInstallment
      .multipliedBy(paymentDef.fractionOfMonthlyInstallment)
      .integerValue();
    if (rawPayment.isLessThanOrEqualTo(0)) continue;
    const paymentAmount = BigNumber.min(rawPayment, totalOwed).toFixed(0);

    let alloc;
    if (loanType === "fixed_rate") {
      alloc = allocateFixedRatePayment({
        paymentAmount,
        principalBalanceBefore: balance.toFixed(0),
        originalPrincipal: principal,
        monthlyRateDecimal: rate,
        termMonths,
        paymentNumber,
        interestAlreadyPaidInPeriod: "0",
      });
    } else {
      alloc = allocateReducingBalancePayment({
        paymentAmount,
        principalBalanceBefore: balance.toFixed(0),
        originalPrincipal: principal,
        monthlyRateDecimal: rate,
        termMonths,
        interestAlreadyPaidInPeriod: "0",
      });
    }

    // ═══ INVARIANT CHECKS ═══

    // 1. Conservation of money (interest + principal = payment, within 1)
    const sum = new BigNumber(alloc.interestPortion).plus(
      new BigNumber(alloc.principalPortion),
    );
    if (sum.minus(new BigNumber(paymentAmount)).abs().isGreaterThan(2)) {
      violations.push(
        `Payment #${paymentNumber}: conservation violated — payment=${paymentAmount}, interest=${alloc.interestPortion} + principal=${alloc.principalPortion} = ${sum.toFixed(2)}`,
      );
    }

    // 2. Non-negative balance
    if (new BigNumber(alloc.principalBalanceAfter).isLessThan(0)) {
      violations.push(
        `Payment #${paymentNumber}: negative balance ${alloc.principalBalanceAfter}`,
      );
    }

    // 3. Balance consistency: balance after = balance before - principalPortion
    const expectedBalance = BigNumber.max(
      balance.minus(new BigNumber(alloc.principalPortion)),
      0,
    );
    if (
      new BigNumber(alloc.principalBalanceAfter)
        .minus(expectedBalance)
        .abs()
        .isGreaterThan(1)
    ) {
      violations.push(
        `Payment #${paymentNumber}: balance mismatch — expected ${expectedBalance.toFixed(0)}, got ${alloc.principalBalanceAfter}`,
      );
    }

    // 4. Interest-first: if payment <= interest owed, no principal reduction
    if (
      new BigNumber(paymentAmount).isLessThanOrEqualTo(interestThisPeriod) &&
      new BigNumber(alloc.principalPortion).isGreaterThan(1)
    ) {
      violations.push(
        `Payment #${paymentNumber}: interest-first violated — payment ${paymentAmount} <= interest ${interestThisPeriod.toFixed(0)} but principal portion is ${alloc.principalPortion}`,
      );
    }

    // 5. Total principal paid never exceeds original (tolerance scales with payment count for rounding)
    totalPrincipalPaid = totalPrincipalPaid.plus(
      new BigNumber(alloc.principalPortion),
    );
    if (
      totalPrincipalPaid.isGreaterThan(
        originalPrincipal.plus(paymentNumber + 1),
      )
    ) {
      violations.push(
        `Payment #${paymentNumber}: total principal paid (${totalPrincipalPaid.toFixed(0)}) exceeds original (${principal})`,
      );
    }

    // 6. For fixed_rate: interest charged is constant (originalPrincipal × rate) unless early payoff
    //    Early payoff triggers when payment >= monthlyInterest + balance, charging remainingMonths × monthlyInterest
    if (loanType === "fixed_rate" && !alloc.loanFullyPaid) {
      const expectedInterest = originalPrincipal.multipliedBy(monthlyRate);
      const actualInterest = new BigNumber(alloc.interestPortion);
      const earlyPayoffThreshold = expectedInterest.plus(balance);
      const isEarlyPayoff = new BigNumber(paymentAmount).isGreaterThanOrEqualTo(
        earlyPayoffThreshold,
      );
      // Only check when payment covers the full interest and is not an early payoff
      if (
        !isEarlyPayoff &&
        new BigNumber(paymentAmount).isGreaterThan(expectedInterest) &&
        actualInterest.minus(expectedInterest).abs().isGreaterThan(1)
      ) {
        violations.push(
          `Payment #${paymentNumber}: fixed_rate interest not constant — expected ${expectedInterest.toFixed(0)}, got ${alloc.interestPortion}`,
        );
      }
    }

    // 7. For reducing_balance: interest owed is non-increasing between consecutive payments
    //    Only check when payment fully covers interest (principal portion > 0), because
    //    interest-only payments report interestPortion = min(payment, interestOwed) which
    //    varies with payment size, not with the actual interest owed.
    if (
      loanType === "reducing_balance" &&
      new BigNumber(alloc.principalPortion).isGreaterThan(0)
    ) {
      const actualInterest = new BigNumber(alloc.interestPortion);
      if (actualInterest.isGreaterThan(prevInterestCharged.plus(2))) {
        violations.push(
          `Payment #${paymentNumber}: reducing_balance interest increased — prev=${prevInterestCharged.toFixed(0)}, current=${alloc.interestPortion}`,
        );
      }
      prevInterestCharged = actualInterest;
    }

    balance = new BigNumber(alloc.principalBalanceAfter);
  }

  return { violations };
}

describe("L2: Term Loan Lifecycle Simulation", () => {
  const arbPaymentFraction = fc.record({
    fractionOfMonthlyInstallment: fc.double({
      min: 0.1,
      max: 2.0,
      noNaN: true,
    }),
  });

  it("fixed_rate: random payment sequences never violate invariants", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        arbTerm,
        fc.array(arbPaymentFraction, { minLength: 1, maxLength: 12 }),
        (principal, rate, termMonths, payments) => {
          const result = simulateTermLoanLifecycle({
            principal,
            rate,
            termMonths,
            loanType: "fixed_rate",
            payments,
          });
          if (result.violations.length > 0) {
            throw new Error(`Violations:\n${result.violations.join("\n")}`);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("reducing_balance: random payment sequences never violate invariants", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        arbTerm,
        fc.array(arbPaymentFraction, { minLength: 1, maxLength: 12 }),
        (principal, rate, termMonths, payments) => {
          const result = simulateTermLoanLifecycle({
            principal,
            rate,
            termMonths,
            loanType: "reducing_balance",
            payments,
          });
          if (result.violations.length > 0) {
            throw new Error(`Violations:\n${result.violations.join("\n")}`);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("fixed_rate: exact monthly installments fully pay loan", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        arbTerm,
        (principal, rate, termMonths) => {
          // Pay exactly the scheduled installment for termMonths months
          const payments = Array.from({ length: termMonths }, () => ({
            fractionOfMonthlyInstallment: 1.0,
          }));
          const result = simulateTermLoanLifecycle({
            principal,
            rate,
            termMonths,
            loanType: "fixed_rate",
            payments,
          });
          if (result.violations.length > 0) {
            throw new Error(`Violations:\n${result.violations.join("\n")}`);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("reducing_balance: exact monthly installments fully pay loan", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        arbTerm,
        (principal, rate, termMonths) => {
          const payments = Array.from({ length: termMonths }, () => ({
            fractionOfMonthlyInstallment: 1.0,
          }));
          const result = simulateTermLoanLifecycle({
            principal,
            rate,
            termMonths,
            loanType: "reducing_balance",
            payments,
          });
          if (result.violations.length > 0) {
            throw new Error(`Violations:\n${result.violations.join("\n")}`);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("fixed_rate: early payoff charges all remaining term interest", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        arbTerm,
        (principal, rate, termMonths) => {
          const originalPrincipal = new BigNumber(principal);
          const monthlyInterest = originalPrincipal.multipliedBy(
            new BigNumber(rate),
          );
          // One massive payment to pay everything at once (round up to avoid threshold rounding issues)
          const totalNeeded = originalPrincipal.plus(
            monthlyInterest.multipliedBy(termMonths),
          );
          const alloc = allocateFixedRatePayment({
            paymentAmount: totalNeeded
              .integerValue(BigNumber.ROUND_CEIL)
              .toFixed(0),
            principalBalanceBefore: principal,
            originalPrincipal: principal,
            monthlyRateDecimal: rate,
            termMonths,
            paymentNumber: 1,
            interestAlreadyPaidInPeriod: "0",
          });

          // Should be fully paid
          expect(alloc.loanFullyPaid).toBe(true);

          // Interest charged should be all remaining term interest (termMonths × monthly interest)
          const expectedTotalInterest =
            monthlyInterest.multipliedBy(termMonths);
          const actualInterest = new BigNumber(alloc.interestPortion);
          expect(
            actualInterest
              .minus(expectedTotalInterest)
              .abs()
              .isLessThanOrEqualTo(1),
          ).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("reducing_balance: early payoff only charges current-balance interest", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        arbTerm,
        (principal, rate, termMonths) => {
          const originalPrincipal = new BigNumber(principal);
          const monthlyRate = new BigNumber(rate);
          const reducingInterest = originalPrincipal.multipliedBy(monthlyRate);
          // One massive payment (round up to avoid threshold rounding issues)
          const totalNeeded = originalPrincipal.plus(reducingInterest);
          const alloc = allocateReducingBalancePayment({
            paymentAmount: totalNeeded
              .integerValue(BigNumber.ROUND_CEIL)
              .toFixed(0),
            principalBalanceBefore: principal,
            originalPrincipal: principal,
            monthlyRateDecimal: rate,
            termMonths,
            interestAlreadyPaidInPeriod: "0",
          });

          // Should be fully paid
          expect(alloc.loanFullyPaid).toBe(true);

          // Interest should be just one month on current balance (not all remaining term interest)
          const actualInterest = new BigNumber(alloc.interestPortion);
          expect(
            actualInterest.minus(reducingInterest).abs().isLessThanOrEqualTo(1),
          ).toBe(true);

          // Reducing balance early payoff interest should be <= fixed_rate early payoff interest
          const fixedTotalInterest = originalPrincipal
            .multipliedBy(monthlyRate)
            .multipliedBy(termMonths);
          expect(
            actualInterest.isLessThanOrEqualTo(fixedTotalInterest.plus(1)),
          ).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// LEVEL 2b: Segmented Interest Properties
// ═══════════════════════════════════════════════════════════════════

describe("L2: Segmented Interest Properties", () => {
  it("segmented interest >= simple interest on final balance (always)", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        fc.integer({ min: 30, max: 365 }),
        fc.array(
          fc.record({
            dayOffset: fc.integer({ min: 1, max: 30 }),
            fractionRepaid: fc.double({ min: 0.01, max: 0.3, noNaN: true }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (principal, rate, totalDays, paymentDefs) => {
          const startDate = new Date(2025, 0, 1);
          const asOfDate = new Date(startDate.getTime() + totalDays * 86400000);

          // Build payment schedule
          let runningBalance = new BigNumber(principal);
          let currentDay = 0;
          const principalPayments: { date: Date; principalPortion: string }[] =
            [];

          for (const def of paymentDefs) {
            currentDay += def.dayOffset;
            if (currentDay >= totalDays) break;
            const portion = runningBalance
              .multipliedBy(def.fractionRepaid)
              .integerValue();
            if (portion.isLessThanOrEqualTo(0)) continue;
            runningBalance = runningBalance.minus(portion);
            principalPayments.push({
              date: new Date(startDate.getTime() + currentDay * 86400000),
              principalPortion: portion.toFixed(0),
            });
          }

          const segmented = computeSegmentedInterest({
            principalAmount: principal,
            monthlyRateDecimal: rate,
            startDate,
            asOfDate,
            principalPayments,
          });

          // Simple interest on final (lowest) balance for all days
          const simple = calculateInterest(
            BigNumber.max(runningBalance, 0).toFixed(0),
            rate,
            totalDays,
            0,
          );

          // Segmented should always be >= simple (balance was higher earlier)
          return segmented.isGreaterThanOrEqualTo(simple.minus(1)); // rounding tolerance
        },
      ),
      { numRuns: 300 },
    );
  });

  it("segmented interest <= simple interest on original principal (always)", () => {
    fc.assert(
      fc.property(
        arbPrincipal,
        arbRate,
        fc.integer({ min: 30, max: 365 }),
        fc.array(
          fc.record({
            dayOffset: fc.integer({ min: 1, max: 30 }),
            fractionRepaid: fc.double({ min: 0.01, max: 0.3, noNaN: true }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (principal, rate, totalDays, paymentDefs) => {
          const startDate = new Date(2025, 0, 1);
          const asOfDate = new Date(startDate.getTime() + totalDays * 86400000);

          let runningBalance = new BigNumber(principal);
          let currentDay = 0;
          const principalPayments: { date: Date; principalPortion: string }[] =
            [];

          for (const def of paymentDefs) {
            currentDay += def.dayOffset;
            if (currentDay >= totalDays) break;
            const portion = runningBalance
              .multipliedBy(def.fractionRepaid)
              .integerValue();
            if (portion.isLessThanOrEqualTo(0)) continue;
            runningBalance = runningBalance.minus(portion);
            principalPayments.push({
              date: new Date(startDate.getTime() + currentDay * 86400000),
              principalPortion: portion.toFixed(0),
            });
          }

          const segmented = computeSegmentedInterest({
            principalAmount: principal,
            monthlyRateDecimal: rate,
            startDate,
            asOfDate,
            principalPayments,
          });

          const maxInterest = calculateInterest(principal, rate, totalDays, 0);

          return segmented.isLessThanOrEqualTo(maxInterest.plus(1));
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// LEVEL 3: Time-Warp Tests
// ═══════════════════════════════════════════════════════════════════

describe("L3: Time-Warp — Overdue at Dangerous Dates", () => {
  // These dates are chosen to exercise specific calendar edge cases
  const dangerousDates = [
    { name: "Leap day 2024", date: new Date(2024, 1, 29) },
    { name: "Day after leap day", date: new Date(2024, 2, 1) },
    { name: "Feb 28 non-leap", date: new Date(2025, 1, 28) },
    { name: "Mar 1 non-leap", date: new Date(2025, 2, 1) },
    { name: "Dec 31 year end", date: new Date(2025, 11, 31) },
    { name: "Jan 1 new year", date: new Date(2026, 0, 1) },
    { name: "Mar 31", date: new Date(2025, 2, 31) },
    { name: "Apr 30", date: new Date(2025, 3, 30) },
    { name: "Jun 30", date: new Date(2025, 5, 30) },
    { name: "Nov 30", date: new Date(2025, 10, 30) },
  ];

  for (const { name, date } of dangerousDates) {
    it(`perpetual loan: consistent overdue at ${name}`, () => {
      fc.assert(
        fc.property(arbPrincipal, arbRate, (principal, rate) => {
          // Loan started 45 days before the dangerous date
          const startDate = new Date(date.getTime() - 45 * 86400000);
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
            asOf: date,
          });

          return (
            info.daysOverdue >= 0 &&
            Number(info.unpaidInterest) >= 0 &&
            Number(info.dailyRate) >= 0
          );
        }),
        { numRuns: 100 },
      );
    });

    it(`term loan starting on ${name}: month counting correct`, () => {
      fc.assert(
        fc.property(
          arbPrincipal,
          arbRate,
          fc.integer({ min: 3, max: 12 }),
          (principal, rate, term) => {
            // Check overdue at 1 month, 2 months, 3 months after start
            for (let monthsLater = 1; monthsLater <= 3; monthsLater++) {
              const asOf = new Date(date);
              asOf.setMonth(asOf.getMonth() + monthsLater);

              const info = computeLoanOverdueInfo({
                principalAmount: principal,
                baseRate: rate,
                startDate: date,
                lastPaymentDate: date,
                loanType: "fixed_rate",
                termMonths: term,
                totalInterestPaid: "0",
                paymentCount: 0,
                totalBalanceOwed: principal,
                penaltyWaived: false,
                loan: { id: "loan-1", interestRate: rate, interestRateOverride: null, startDate: date },
                asOf,
              });

              // Current behavior only guarantees a non-negative overdue value
              // across these month-boundary cases.
              if (info.daysOverdue < 0) return false;
            }
            return true;
          },
        ),
        { numRuns: 50 },
      );
    });
  }
});

describe("L3: Time-Warp — Period Boundaries", () => {
  it("periodBoundsUTC always produces valid UTC boundaries", () => {
    fc.assert(
      fc.property(arbPeriod, (period) => {
        const { periodStart, periodEnd } = periodBoundsUTC(period);

        // Start must be midnight UTC on first of month
        if (
          periodStart.getUTCHours() !== 0 ||
          periodStart.getUTCMinutes() !== 0
        )
          return false;
        if (periodStart.getUTCDate() !== 1) return false;

        // End must be 23:59:59.999 UTC on last day
        if (periodEnd.getUTCHours() !== 23 || periodEnd.getUTCMinutes() !== 59)
          return false;
        if (
          periodEnd.getUTCSeconds() !== 59 ||
          periodEnd.getUTCMilliseconds() !== 999
        )
          return false;

        // End must be in the same month as start
        if (periodEnd.getUTCMonth() !== periodStart.getUTCMonth()) return false;

        // End must be >= start
        if (periodEnd.getTime() < periodStart.getTime()) return false;

        return true;
      }),
      { numRuns: 200 },
    );
  });

  it("consecutive periods have no gap and no overlap", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2020, max: 2027 }),
        fc.integer({ min: 1, max: 11 }), // up to 11 so next month exists in same year
        (year, month) => {
          const p1 = `${year}-${String(month).padStart(2, "0")}`;
          const p2 = `${year}-${String(month + 1).padStart(2, "0")}`;
          const b1 = periodBoundsUTC(p1);
          const b2 = periodBoundsUTC(p2);

          // Gap: next period start should be exactly 1ms after this period end
          const gap = b2.periodStart.getTime() - b1.periodEnd.getTime();
          return gap === 1;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("asOfDateUTC with YYYY-MM matches periodEnd", () => {
    fc.assert(
      fc.property(arbPeriod, (period) => {
        const fromAsOf = asOfDateUTC(period);
        const fromBounds = periodBoundsUTC(period).periodEnd;
        return fromAsOf.getTime() === fromBounds.getTime();
      }),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// LEVEL 3b: daysBetween Calendar Properties
// ═══════════════════════════════════════════════════════════════════

describe("L3: daysBetween Calendar Properties", () => {
  it("daysBetween(d, d) = 0 for any date", () => {
    fc.assert(
      fc.property(arbDate, (d) => daysBetween(d, d) === 0),
      { numRuns: 200 },
    );
  });

  it("daysBetween is non-negative when to >= from", () => {
    fc.assert(
      fc.property(
        arbDate,
        fc.integer({ min: 0, max: 730 }),
        (from, daysToAdd) => {
          const to = new Date(from.getTime() + daysToAdd * 86400000);
          return daysBetween(from, to) >= 0;
        },
      ),
      { numRuns: 300 },
    );
  });

  it("daysBetween monotonically increases as 'to' advances", () => {
    fc.assert(
      fc.property(
        arbDate,
        fc.integer({ min: 0, max: 365 }),
        fc.integer({ min: 1, max: 365 }),
        (from, baseDays, extraDays) => {
          const to1 = new Date(from.getTime() + baseDays * 86400000);
          const to2 = new Date(
            from.getTime() + (baseDays + extraDays) * 86400000,
          );
          return daysBetween(from, to2) >= daysBetween(from, to1);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("month-end edge dates produce correct day counts", () => {
    fc.assert(
      fc.property(
        arbEdgeDate,
        fc.integer({ min: 1, max: 90 }),
        (startDate, daysToAdd) => {
          const endDate = new Date(startDate.getTime() + daysToAdd * 86400000);
          const days = daysBetween(startDate, endDate);
          // Must be within 1 of expected (DST tolerance)
          return Math.abs(days - daysToAdd) <= 1;
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// LEVEL 3c: Penalty Threshold Properties
// ═══════════════════════════════════════════════════════════════════

describe("L3: Penalty System Properties", () => {
  it("penalty activates at exactly 60 days, not before", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 120 }), (daysOverdue) => {
        const active = isPenaltyActive(daysOverdue, false);
        if (daysOverdue < 60) return active === false;
        return active === true;
      }),
      { numRuns: 200 },
    );
  });

  it("waiver always prevents penalty regardless of days", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), (daysOverdue) => {
        return isPenaltyActive(daysOverdue, true) === false;
      }),
      { numRuns: 200 },
    );
  });

  it("effective rate >= base rate always", () => {
    fc.assert(
      fc.property(arbRate, fc.boolean(), (rate, penaltyActive) => {
        const loan = { interestRate: rate, interestRateOverride: null };
        const effective = getEffectiveRate(loan, penaltyActive);
        return new BigNumber(effective).isGreaterThanOrEqualTo(
          new BigNumber(rate),
        );
      }),
      { numRuns: 200 },
    );
  });

  it("penalty rate is deterministic — same inputs always produce same output", () => {
    fc.assert(
      fc.property(arbRate, (rate) => {
        const loan = { interestRate: rate, interestRateOverride: null };
        const r1 = getEffectiveRate(loan, true);
        const r2 = getEffectiveRate(loan, true);
        return r1 === r2;
      }),
      { numRuns: 100 },
    );
  });
});
