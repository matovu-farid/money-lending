import { describe, it, expect } from "vitest";
import BigNumber from "bignumber.js";
import { allocatePayment } from "@/lib/interest/engine";

describe("loan waiver allocation (shared allocatePayment rules)", () => {
  it("perpetual: interest-first then principal", () => {
    const result = allocatePayment({
      paymentAmount: "500000",
      principalBalanceBefore: "7000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 30,
      loanType: "perpetual",
      paymentNumber: 1,
    });

    expect(result.interestPortion).toBe("500000.00");
    expect(result.principalPortion).toBe("0.00");
    expect(result.loanFullyPaid).toBe(false);
  });

  it("perpetual: full payoff sets loanFullyPaid on principal only (economic check is server-side)", () => {
    const result = allocatePayment({
      paymentAmount: "7700000",
      principalBalanceBefore: "7000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 30,
      loanType: "perpetual",
      paymentNumber: 1,
    });

    expect(new BigNumber(result.principalBalanceAfter).isZero()).toBe(true);
    expect(result.interestPortion).toBe("700000.00");
    expect(result.principalPortion).toBe("7000000.00");
  });

  it("fixed_rate: normal payment covers one month interest first", () => {
    const result = allocatePayment({
      paymentAmount: "500000",
      principalBalanceBefore: "7000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 30,
      loanType: "fixed_rate",
      originalPrincipal: "7000000",
      termMonths: 12,
      paymentNumber: 1,
    });

    expect(result.interestPortion).toBe("500000.00");
    expect(result.principalPortion).toBe("0.00");
  });

  it("fixed_rate: early payoff charges remaining term interest", () => {
    const result = allocatePayment({
      paymentAmount: "9100000",
      principalBalanceBefore: "7000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 30,
      loanType: "fixed_rate",
      originalPrincipal: "7000000",
      termMonths: 12,
      paymentNumber: 1,
    });

    // 12 months × 700k interest + 7M principal
    expect(result.interestPortion).toBe("8400000.00");
    expect(result.principalPortion).toBe("700000.00");
  });

  it("reducing_balance: interest on current balance first", () => {
    const result = allocatePayment({
      paymentAmount: "500000",
      principalBalanceBefore: "5000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 30,
      loanType: "reducing_balance",
      originalPrincipal: "7000000",
      termMonths: 12,
    });

    expect(result.interestPortion).toBe("500000.00");
    expect(result.principalPortion).toBe("0.00");
  });

  it("honors interestAlreadyPaidInPeriod (min-period floor)", () => {
    const withoutPrior = allocatePayment({
      paymentAmount: "700000",
      principalBalanceBefore: "7000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 30,
      loanType: "perpetual",
      paymentNumber: 1,
      interestAlreadyPaidInPeriod: "0",
    });

    const withPrior = allocatePayment({
      paymentAmount: "700000",
      principalBalanceBefore: "7000000",
      monthlyRateDecimal: "0.10",
      daysElapsed: 30,
      minInterestDays: 30,
      loanType: "perpetual",
      paymentNumber: 1,
      interestAlreadyPaidInPeriod: "300000",
    });

    expect(withoutPrior.interestPortion).toBe("700000.00");
    expect(withPrior.interestPortion).toBe("400000.00");
    expect(withPrior.principalPortion).toBe("300000.00");
  });
});
