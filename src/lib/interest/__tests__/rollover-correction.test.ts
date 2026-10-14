import { describe, expect, it } from "vitest";
import { planRolloverCorrection, type ChainSnapshot } from "../rollover-correction";

const start = (day: string) => new Date(`${day}T00:00:00Z`);
const terms = {
  interestRate: "0.10",
  interestRateOverride: null,
  penaltyMultiplier: "0.1000",
  penaltyWaived: false,
  penaltyWaivedAt: null,
  penaltyWaivedBy: null,
  minInterestDays: 30,
  minPeriodOverride: null,
  issuanceFee: "0",
  loanType: "perpetual",
  sourceExceptions: [],
  sourceDigest: "verified-fixture",
};

const samuel: ChainSnapshot = {
  loans: [
    { ...terms, id: "a", rolledOverFrom: null, principalAmount: "15000000", rolloverAmount: null, startDate: start("2026-08-28"), createdAt: start("2026-08-28"), status: "rolled_over", deletedAt: null, payments: [], waivers: [], rateChanges: [] },
    { ...terms, id: "b", rolledOverFrom: "a", principalAmount: "26550000", rolloverAmount: "16550000", startDate: start("2026-09-18"), createdAt: start("2026-09-28"), status: "rolled_over", deletedAt: null, payments: [], waivers: [], rateChanges: [] },
    { ...terms, id: "c", rolledOverFrom: "b", principalAmount: "29858500", rolloverAmount: "26858500", startDate: start("2026-10-01"), createdAt: start("2026-10-09"), status: "rolled_over", deletedAt: null, payments: [], waivers: [], rateChanges: [] },
    { ...terms, id: "d", rolledOverFrom: "c", principalAmount: "32346227", rolloverAmount: "30346227", startDate: start("2026-10-08"), createdAt: start("2026-10-09"), status: "active", deletedAt: null, payments: [], waivers: [], rateChanges: [] },
  ],
};

describe("planRolloverCorrection", () => {
  it("replays every successor from corrected effective-date carry", () => {
    const plan = planRolloverCorrection(samuel, "v1");
    expect(plan.classification).toBe("ready");
    expect(plan.edges.map((edge) => edge.proposedPrincipal)).toEqual([
      "26500000", "30648333", "33363461",
    ]);
    expect(plan.edges.map((edge) => edge.freshCash)).toEqual([
      "10000000", "3000000", "2000000",
    ]);
    expect(plan.edges.map((edge) => edge.carriedInterest)).toEqual([
      "1500000", "1148333", "715128",
    ]);
    expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(planRolloverCorrection(samuel, "v1")).toEqual(plan);
  });

  it("is a no-op when the same chain has already been corrected", () => {
    const corrected = structuredClone(samuel);
    const expected = planRolloverCorrection(samuel, "v1");
    for (const edge of expected.edges) {
      const row = corrected.loans.find((loan) => loan.id === edge.successorId)!;
      row.principalAmount = edge.proposedPrincipal;
      row.rolloverAmount = edge.proposedRolloverAmount;
    }
    const second = planRolloverCorrection(corrected, "v1");
    expect(second.edges.every((edge) => edge.deltaPrincipal === "0")).toBe(true);
  });

  it("blocks a payment made on the predecessor after its effective rollover date", () => {
    const snapshot = structuredClone(samuel);
    snapshot.loans[0].payments.push({
      id: "late", paymentDate: start("2026-09-19"), amount: "100000",
      interestPortion: "100000", principalPortion: "0", recorderName: "",
    });
    const plan = planRolloverCorrection(snapshot, "v1");
    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions).toContainEqual(expect.stringMatching(
      /payment late.*100000.*2026-09-19.*after.*effective.*2026-09-18/i));
  });

  it("replays a same-day predecessor receipt before a date-only rollover", () => {
    const snapshot: ChainSnapshot = { loans: [
      { ...structuredClone(samuel.loans[0]), id: "pred", principalAmount: "15000000",
        startDate: start("2026-08-28"), payments: [{ id: "same-day",
          paymentDate: new Date("2026-09-18T12:00:00Z"), amount: "1000000",
          interestPortion: "500000", principalPortion: "500000", recorderName: "" }] },
      { ...structuredClone(samuel.loans[1]), id: "succ", rolledOverFrom: "pred",
        principalAmount: "26550000", rolloverAmount: "16550000",
        startDate: start("2026-09-18"), status: "active" },
    ] };
    const plan = planRolloverCorrection(snapshot, "v5");
    expect(plan.classification).toBe("review");
    expect(plan.settlementChanges).toEqual([expect.objectContaining({
      id: "same-day", loanId: "pred", newInterest: "1000000.00",
      newPrincipal: "0.00" })]);
    expect(plan.edges[0]).toEqual(expect.objectContaining({
      carriedPrincipal: "15000000", carriedInterest: "500000",
      proposedPrincipal: "25500000" }));

    const corrected = structuredClone(snapshot);
    corrected.loans[0].payments[0].interestPortion = "1000000.00";
    corrected.loans[0].payments[0].principalPortion = "0.00";
    corrected.loans[1].principalAmount = plan.edges[0].proposedPrincipal;
    corrected.loans[1].rolloverAmount = plan.edges[0].proposedRolloverAmount;
    const repeated = planRolloverCorrection(corrected, "v5");
    expect(repeated.edges[0].deltaPrincipal).toBe("0");
    expect(repeated.settlementChanges[0].newInterest).toBe("1000000.00");
    expect(repeated.settlementChanges[0].oldInterest).toBe("1000000.00");
  });

  it("does not extend the same-day exception to a non-midnight predecessor", () => {
    const snapshot = structuredClone(samuel);
    snapshot.loans[0].startDate = new Date("2026-08-28T12:00:00Z");
    snapshot.loans[0].payments.push({ id: "ambiguous",
      paymentDate: new Date("2026-09-18T12:00:00Z"), amount: "100000",
      interestPortion: "100000", principalPortion: "0", recorderName: "" });
    const plan = planRolloverCorrection(snapshot, "v5");
    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions).toContainEqual(expect.stringMatching(/ambiguous.*attribution review/i));
  });

  it("blocks a deleted successor and a paid status with no settlement evidence", () => {
    const deleted = structuredClone(samuel);
    deleted.loans[3].deletedAt = start("2026-10-09");
    expect(planRolloverCorrection(deleted, "v1").classification).toBe("blocked");

    const settled = structuredClone(samuel);
    settled.loans[3].status = "fully_paid";
    expect(planRolloverCorrection(settled, "v1").classification).toBe("blocked");
  });

  it("does not call arithmetic-only input ready without source reconciliation", () => {
    const unverified = structuredClone(samuel);
    unverified.loans[1].sourceExceptions = undefined;
    expect(planRolloverCorrection(unverified, "v1").classification).toBe("blocked");
  });

  it("replays a successor payment before quoting the next rollover", () => {
    const snapshot = structuredClone(samuel);
    snapshot.loans[1].payments.push({
      id: "payment-b", paymentDate: start("2026-09-25"), amount: "1000000",
      interestPortion: "500000", principalPortion: "500000", recorderName: "",
    });
    const plan = planRolloverCorrection(snapshot, "v1");
    expect(plan.classification).toBe("review");
    expect(plan.edges[1].settlementChanges).toEqual([
      expect.objectContaining({
        id: "payment-b", kind: "payment", loanId: "b",
        oldInterest: "500000", oldPrincipal: "500000",
      }),
    ]);
    const allocation = plan.edges[1].settlementChanges[0];
    expect(Number(allocation.newInterest)).toBeGreaterThan(500000);
    expect(Number(allocation.newPrincipal)).toBeLessThan(500000);
    expect(Number(allocation.newInterest) + Number(allocation.newPrincipal)).toBe(1000000);
    expect(plan.edges[1].proposedPrincipal).not.toBe(samuel.loans[2].principalAmount);
    expect(plan.edges[2].proposedPrincipal).not.toBe(samuel.loans[3].principalAmount);
  });

  it("replays a waiver without inventing a cash payment", () => {
    const snapshot = structuredClone(samuel);
    snapshot.loans[1].waivers.push({
      id: "waiver-b", waiverDate: start("2026-09-25"), amount: "1000000",
      interestPortion: "500000", principalPortion: "500000", reason: "agreed",
    });
    const plan = planRolloverCorrection(snapshot, "v1");
    expect(plan.classification).toBe("review");
    expect(plan.edges[1].settlementChanges[0]).toEqual(expect.objectContaining({
      id: "waiver-b", kind: "waiver", loanId: "b",
    }));
  });

  it("preserves the full cash receipt while replaying an overpayment", () => {
    const snapshot = structuredClone(samuel);
    snapshot.loans[3].payments.push({
      id: "overpayment-d", paymentDate: start("2026-10-09"), amount: "34000000",
      interestPortion: "107821", principalPortion: "32346227",
      overpaymentPortion: "1545952", recorderName: "",
    });
    snapshot.loans[3].status = "fully_paid";
    const plan = planRolloverCorrection(snapshot, "v1");
    expect(plan.classification).toBe("review");
    const change = plan.settlementChanges[0];
    expect(change.oldOverpayment).toBe("1545952");
    expect(Number(change.newInterest) + Number(change.newPrincipal) +
      Number(change.newOverpayment)).toBe(34000000);
    expect(Number(change.newOverpayment)).toBeLessThan(1545952);
  });

  it("blocks ambiguous same-day rate changes instead of depending on query order", () => {
    const snapshot = structuredClone(samuel);
    snapshot.loans[0].rateChanges = [
      { effectiveDate: start("2026-09-10"), fromRate: "0.10", toRate: "0.11" },
      { effectiveDate: start("2026-09-10"), fromRate: "0.11", toRate: "0.12" },
    ];
    const plan = planRolloverCorrection(snapshot, "v1");
    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions).toContainEqual(expect.stringMatching(/same-date rate/i));
  });

  it("blocks a forked predecessor instead of correcting two successors from one balance", () => {
    const snapshot = structuredClone(samuel);
    snapshot.loans.push({ ...structuredClone(snapshot.loans[1]), id: "fork" });
    const plan = planRolloverCorrection(snapshot, "v1");
    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions).toContainEqual(expect.stringMatching(/multiple successors/i));
  });
});
