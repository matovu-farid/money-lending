import { describe, expect, it, vi } from "vitest";
import BigNumber from "bignumber.js";
import { auditLog } from "@/lib/db/schema/audit";
import { loans } from "@/lib/db/schema/loans";
import { quoteRolloverCarry } from "@/lib/interest/rollover-carry";
import { quoteRecordedRollover } from "../rollover-quote.service";

vi.mock("../ledger-queries.service", () => ({
  getLoanBalancesFromLedger: vi.fn(async () => new Map([["loan", new BigNumber("10000000")]])),
  getPaymentPortionsFromLedger: vi.fn(async () => new Map()),
  getWaiverPortionsFromLedger: vi.fn(async () => new Map()),
}));

const date = (value: string) => new Date(`${value}T00:00:00Z`);
const loan = {
  id: "loan", principalAmount: "10000000", interestRate: "0.1000",
  interestRateOverride: "0.1200", minInterestDays: 30,
  minPeriodOverride: null, penaltyMultiplier: "0.1000",
  penaltyWaived: false, penaltyWaivedAt: null, penaltyWaivedBy: null,
  loanType: "perpetual", rolledOverFrom: "prior", issuanceFee: "0",
  startDate: date("2026-01-01"), createdAt: date("2026-01-01"),
} as typeof loans.$inferSelect;

function queryDb(rateAudits: unknown[] = []) {
  const query = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows = table === auditLog ? rateAudits : [];
          return {
            orderBy: () => Promise.resolve(rows),
            then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
          };
        },
      }),
    }),
  };
  return query as unknown as Parameters<typeof quoteRecordedRollover>[0];
}

describe("recorded rollover quote rate history", () => {
  it("rejects a changed current rate without dated audit history", async () => {
    await expect(quoteRecordedRollover(queryDb(), loan, date("2026-01-21")))
      .rejects.toThrow(/rate history/i);
  });

  it("uses the immediate rate adjustment on its recorded day", async () => {
    const changeAt = date("2026-01-11");
    const audits = [{
      id: "rate-audit", action: "loan.rate_change.immediate", occurredAt: changeAt,
      beforeValue: JSON.stringify({ interestRate: "0.1000" }),
      afterValue: JSON.stringify({ interestRateOverride: "0.1200" }),
    }];
    const expected = quoteRolloverCarry({
      loan: { ...loan, interestRateOverride: null },
      asOf: date("2026-01-21"), payments: [], waivers: [],
      rateChanges: [{ effectiveDate: changeAt, fromRate: "0.1000", toRate: "0.1200" }],
    });
    const actual = await quoteRecordedRollover(queryDb(audits), loan, date("2026-01-21"));
    expect(actual).toEqual(expected);
  });
});
