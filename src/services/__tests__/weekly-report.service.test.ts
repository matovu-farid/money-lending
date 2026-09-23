import { beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

const mockedSelect = vi.fn();
vi.mock("@/lib/db", () => ({ db: { select: (...args: unknown[]) => mockedSelect(...args) } }));
const mockedBalances = vi.fn();
const mockedPortions = vi.fn();
vi.mock("@/lib/interest/loanBalanceData", () => ({ computeLoanBalanceData: (...args: unknown[]) => mockedBalances(...args) }));
vi.mock("@/services/ledger-queries.service", () => ({ getPaymentPortionsFromLedger: (...args: unknown[]) => mockedPortions(...args) }));

function selectChain(rows: unknown[]) {
  const terminal = {
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  const query: Record<string, unknown> = {};
  query.then = terminal.then;
  for (const key of ["from", "innerJoin", "where", "orderBy"]) {
    query[key] = vi.fn().mockReturnValue(query);
  }
  query.orderBy = vi.fn().mockReturnValue(terminal);
  return query;
}

describe("weekly report service", () => {
  beforeEach(() => {
    mockedSelect.mockReset();
    mockedBalances.mockReset().mockResolvedValue(new Map());
    mockedPortions.mockReset().mockResolvedValue(new Map());
  });

  it("sums weekly payments exactly and returns deterministic rows", async () => {
    mockedSelect.mockReturnValueOnce(selectChain([
      { id: "p2", loanId: "l2", customerName: "B", paymentDate: new Date("2026-09-22T10:00:00Z"), amount: "0.10", depositLocation: "cash" },
      { id: "p1", loanId: "l1", customerName: "A", paymentDate: new Date("2026-09-21T10:00:00Z"), amount: "0.20", depositLocation: "bank" },
    ])).mockReturnValueOnce(selectChain([])).mockReturnValueOnce(selectChain([]));
    const { getWeeklyPaymentsData } = await import("@/services/weekly-report.service");
    const result = await Effect.runPromise(getWeeklyPaymentsData("2026-09-21"));
    expect(result).toMatchObject({ week: "2026-09-21", count: 2, total: "0.30" });
    expect(result.rows.map((row) => row.id)).toEqual(["p2", "p1"]);
    expect(result.rows[0].paymentDate).toBe("2026-09-22T10:00:00.000Z");
    expect(result.calculatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns zero totals for an empty week", async () => {
    mockedSelect.mockReturnValue(selectChain([]));
    const { getWeeklyLoansData } = await import("@/services/weekly-report.service");
    const result = await Effect.runPromise(getWeeklyLoansData("2026-09-21"));
    expect(result).toMatchObject({ count: 0, total: "0.00", rows: [] });
  });

  it("enriches loan rows from one as-of balance projection", async () => {
    mockedSelect.mockReturnValueOnce(selectChain([{
      id: "loan-1", customerId: "customer-1", customerName: "A", contactNumber: "0700",
      startDate: new Date("2026-09-22T00:00:00Z"), status: "active", principalAmount: "100.00",
    }]));
    mockedBalances.mockImplementation(async (_ids: string[], asOf: Date) => new Map([[
      "loan-1", { totalBalanceOwed: "80", unpaidInterest: "4.50", daysOverdue: 2, lastPaymentDate: new Date("2026-09-22T12:00:00Z"), asOf },
    ]]));
    const { getWeeklyLoansData } = await import("@/services/weekly-report.service");
    const result = await Effect.runPromise(getWeeklyLoansData("2026-09-21"));
    expect(result.rows[0]).toMatchObject({
      customerName: "A", contactNumber: "0700", principalAmount: "100.00",
      principalBalance: "80", accruedInterest: "4.50", totalDue: "84.50",
      daysOverdue: 2, lastPaymentDate: "2026-09-22T12:00:00.000Z",
    });
    expect(result.calculatedAt).toBe(result.rows[0] && (mockedBalances.mock.calls[0][1] as Date).toISOString());
  });

  it("calculates after-payment principal from the full payment history including prior weeks", async () => {
    const queries = [
      [{ id: "week-p", loanId: "loan-1", customerName: "A", contactNumber: "0700", paymentDate: new Date("2026-09-24T00:00:00Z"), amount: "30.00", depositLocation: "cash", createdAt: new Date("2026-09-24T00:00:00Z") }],
      [{ id: "prior-p", loanId: "loan-1" }, { id: "week-p", loanId: "loan-1" }],
      [{ id: "loan-1", principalAmount: "100.00" }],
    ];
    mockedSelect.mockImplementation(() => selectChain(queries.shift() ?? []));
    mockedPortions.mockResolvedValue(new Map([
      ["prior-p", { interestPortion: "10.00", principalPortion: "20.00" }],
      ["week-p", { interestPortion: "5.00", principalPortion: "25.00" }],
    ]));
    const { getWeeklyPaymentsData } = await import("@/services/weekly-report.service");
    const result = await Effect.runPromise(getWeeklyPaymentsData("2026-09-21"));
    expect(result.rows[0]).toMatchObject({
      interestPortion: "5.00", principalPortion: "25.00", principalBalanceAfter: "55",
    });
  });
});
