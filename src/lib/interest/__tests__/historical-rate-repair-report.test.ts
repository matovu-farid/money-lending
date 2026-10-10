import { describe, expect, it } from "vitest";
import { buildHistoricalRateRepairReport, parseHistoricalRateAsOf } from
  "../historical-rate-repair-report";
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
  accrualJournalTarget: "1425.00",
  accrualJournalDelta: "1425.00",
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
      accrualJournalTarget: "1425.00",
      accrualJournalDelta: "1425.00",
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

  it("requires an explicit instant rather than treating a date as midnight", () => {
    expect(() => parseHistoricalRateAsOf("2026-10-10"))
      .toThrow(/explicit.*instant/i);
    expect(parseHistoricalRateAsOf("2026-10-10T23:59:59.999+03:00",
      new Date("2026-10-11T00:00:00Z")).toISOString())
      .toBe("2026-10-10T20:59:59.999Z");
  });

  it("rejects a future as-of instant for a historical repair preview", () => {
    expect(() => parseHistoricalRateAsOf(
      "2026-10-10T23:59:59.999+03:00", new Date("2026-10-10T14:00:00Z"),
    )).toThrow(/future/i);
  });

  it("separates non-cash waiver value from unchanged receipt cash", () => {
    const withWaiver = buildHistoricalRateRepairReport({
      databaseHost: "db.example.test",
      databaseName: "review_db",
      plan: { ...plan, changes: [...plan.changes, {
        id: "00000000-0000-4000-8000-000000000012",
        kind: "waiver", date: new Date("2026-02-10T00:00:00Z"),
        amount: "100", oldInterest: "100", oldPrincipal: "0", oldOverpayment: "0",
        newInterest: "100", newPrincipal: "0", newOverpayment: "0",
      }] },
    });

    expect(withWaiver.summary.unchangedCashTotal).toBe("5000.00");
    expect(withWaiver.summary.waivedTotal).toBe("100.00");
  });
});
