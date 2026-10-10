import { describe, expect, it } from "vitest";
import { buildHistoricalRateRepairReport } from "../historical-rate-repair-report";
import type { HistoricalRatePlan } from "../historical-rate-repair";

const plan: HistoricalRatePlan = {
  loanId: "00000000-0000-4000-8000-000000000001",
  asOf: new Date("2026-02-10T00:00:00Z"),
  policyVersion: "v1",
  inputFingerprint: "a".repeat(64),
  planHash: "b".repeat(64),
  classification: "review",
  exceptions: [],
  correctedRate: "0.1500",
  accruedInterest: "5925",
  endingPrincipal: "25925",
  changes: [{
    id: "00000000-0000-4000-8000-000000000011",
    kind: "payment",
    date: new Date("2026-01-11T00:00:00Z"),
    amount: "5000",
    oldInterest: "3000",
    oldPrincipal: "2000",
    oldOverpayment: "0",
    newInterest: "4500",
    newPrincipal: "500",
    newOverpayment: "0",
  }],
};

describe("historical rate repair report", () => {
  it("shows exact review identity and allocations without customer or credential fields", () => {
    const report = buildHistoricalRateRepairReport({
      databaseHost: "db.example.test",
      databaseName: "review_db",
      plan,
    });

    expect(report.summary).toEqual(expect.objectContaining({
      databaseHost: "db.example.test",
      databaseName: "review_db",
      loanId: plan.loanId,
      policyVersion: "v1",
      asOf: "2026-02-10T00:00:00.000Z",
      classification: "review",
      reviewable: true,
      inputFingerprint: plan.inputFingerprint,
      planHash: plan.planHash,
    }));
    expect(report.settlements).toEqual([expect.objectContaining({
      oldInterest: "3000", newInterest: "4500",
      oldPrincipal: "2000", newPrincipal: "500",
    })]);
    expect(JSON.stringify(report)).not.toMatch(/customerName|DATABASE_URL|password/i);
  });

  it("never presents a blocked plan as reviewable", () => {
    const blocked = buildHistoricalRateRepairReport({
      databaseHost: "db.example.test",
      databaseName: "review_db",
      plan: { ...plan, classification: "blocked", exceptions: ["Cash mismatch"] },
    });

    expect(blocked.summary.reviewable).toBe(false);
    expect(blocked.exceptions).toEqual(["Cash mismatch"]);
  });
});
