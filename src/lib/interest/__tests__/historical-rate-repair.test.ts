import { describe, expect, it } from "vitest";
import { planHistoricalRateRepair, type HistoricalRateSnapshot } from "../historical-rate-repair";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

function snapshot(): HistoricalRateSnapshot {
  return {
    loan: {
      id: "00000000-0000-4000-8000-000000000001",
      principalAmount: "30000",
      interestRate: "0.10",
      interestRateOverride: "0.15",
      penaltyMultiplier: "0.10",
      penaltyWaived: false,
      penaltyWaivedAt: null,
      penaltyWaivedBy: null,
      minInterestDays: 30,
      minPeriodOverride: null,
      rolledOverFrom: null,
      issuanceFee: "0",
      loanType: "perpetual",
      startDate: day("2026-01-01"),
      createdAt: day("2026-03-01"),
    },
    correctedRate: "0.15",
    asOf: day("2026-02-10"),
    settlements: [
      {
        id: "00000000-0000-4000-8000-000000000011",
        kind: "payment",
        date: day("2026-01-11"),
        amount: "5000",
        oldInterest: "3000",
        oldPrincipal: "2000",
        oldOverpayment: "0",
      },
      {
        id: "00000000-0000-4000-8000-000000000012",
        kind: "payment",
        date: day("2026-02-10"),
        amount: "5000",
        oldInterest: "800",
        oldPrincipal: "4200",
        oldOverpayment: "0",
      },
    ],
    sourceDigest: "a".repeat(64),
    sourceExceptions: [],
  };
}

describe("historical paid-rate repair preview", () => {
  it("replays each receipt at the corrected rate from loan start without changing cash", () => {
    const plan = planHistoricalRateRepair(snapshot());

    expect(plan.classification).toBe("review");
    expect(plan.exceptions).toEqual([]);
    expect(plan.changes.map((change) => [
      change.newInterest,
      change.newPrincipal,
      change.newOverpayment,
    ])).toEqual([
      ["4500.00", "500.00", "0.00"],
      ["1425.00", "3575.00", "0.00"],
    ]);
    expect(plan.changes.map((change) => [change.date, change.amount])).toEqual([
      [day("2026-01-11"), "5000"],
      [day("2026-02-10"), "5000"],
    ]);
    expect(plan.endingPrincipal).toBe("25925");
    expect(plan.accruedInterest).toBe("5925");
  });

  it("retains four-decimal rate precision rather than rounding a rate as money", () => {
    const input = snapshot();
    input.correctedRate = "0.1250";
    input.settlements = [
      {
        id: "00000000-0000-4000-8000-000000000013",
        kind: "payment",
        date: day("2026-01-31"),
        amount: "5000",
        oldInterest: "3000",
        oldPrincipal: "2000",
        oldOverpayment: "0",
      },
    ];
    input.asOf = day("2026-01-31");

    const plan = planHistoricalRateRepair(input);

    expect(plan.classification).toBe("review");
    expect(plan.changes[0].newInterest).toBe("3750.00");
    expect(plan.changes[0].newPrincipal).toBe("1250.00");
  });

  it("blocks source exceptions without producing a proposed allocation", () => {
    const input = snapshot();
    input.sourceExceptions = ["Payment cash leg is missing"];

    const plan = planHistoricalRateRepair(input);

    expect(plan.classification).toBe("blocked");
    expect(plan.changes).toEqual([]);
    expect(plan.exceptions).toContain("Payment cash leg is missing");
  });

  it("blocks two settlements at the same instant instead of inventing their order", () => {
    const input = snapshot();
    input.settlements[1].date = input.settlements[0].date;

    const plan = planHistoricalRateRepair(input);

    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions).toEqual(expect.arrayContaining([
      expect.stringMatching(/ambiguous same-time order/),
    ]));
  });

  it("does not enforce a first-payment minimum on a rollover successor", () => {
    const input = snapshot();
    input.loan.rolledOverFrom = "00000000-0000-4000-8000-000000000099";
    input.settlements = [input.settlements[0]];
    input.asOf = input.settlements[0].date;

    const plan = planHistoricalRateRepair(input);

    expect(plan.classification).toBe("review");
    expect(plan.changes[0].newInterest).toBe("1500.00");
    expect(plan.changes[0].newPrincipal).toBe("3500.00");
  });

  it("reports no-op after the corrected allocations and audit marker are present", () => {
    const input = snapshot();
    input.settlements[0].oldInterest = "4500";
    input.settlements[0].oldPrincipal = "500";
    input.settlements[1].oldInterest = "1425";
    input.settlements[1].oldPrincipal = "3575";
    input.correctionMarked = true;
    input.postedAccrual = "5925";

    const plan = planHistoricalRateRepair(input);

    expect(plan.classification).toBe("noop");
  });
});
