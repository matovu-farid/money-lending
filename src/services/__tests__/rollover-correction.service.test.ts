import { describe, expect, it } from "vitest";
import type { loans } from "@/lib/db/schema/loans";
import type { payments } from "@/lib/db/schema/payments";
import type { loanWaivers } from "@/lib/db/schema/loan-waivers";
import { planRolloverCorrection } from "@/lib/interest/rollover-correction";
import { assembleRolloverChains } from "../rollover-correction.service";

type Loan = typeof loans.$inferSelect;
type Payment = typeof payments.$inferSelect;
type Waiver = typeof loanWaivers.$inferSelect;
const date = (value: string) => new Date(`${value}T00:00:00Z`);
const base = {
  interestRate: "0.1000", interestRateOverride: null,
  penaltyMultiplier: "0.1000", penaltyWaived: false,
  penaltyWaivedAt: null, penaltyWaivedBy: null,
  minInterestDays: 30, minPeriodOverride: null,
  issuanceFee: "0", loanType: "perpetual",
  disbursementSource: "cash", subLocationId: null,
  status: "rolled_over", deletedAt: null,
};
const root = {
  ...base, id: "root", principalAmount: "15000000.00",
  rolloverAmount: null, rolledOverFrom: null,
  startDate: date("2026-08-28"), createdAt: date("2026-08-28"),
} as Loan;
const successor = {
  ...base, id: "next", principalAmount: "26550000.00",
  rolloverAmount: "16550000.00", rolledOverFrom: "root",
  startDate: date("2026-09-18"), createdAt: date("2026-09-28"),
  status: "active",
} as Loan;

const journals: Array<{
  loanId: string | null; referenceType: string; referenceId: string;
  categoryName: string; type: "debit" | "credit"; amount: string;
  journalGroupId: string; depositLocation?: string;
}> = [
  { loanId: "root", referenceType: "loan", referenceId: "root", categoryName: "Loans Receivable", type: "debit" as const, amount: "15000000.00", journalGroupId: "issue" },
  { loanId: null, referenceType: "loan", referenceId: "root", categoryName: "Cash", type: "credit" as const, amount: "15000000.00", journalGroupId: "issue", depositLocation: "cash" },
  { loanId: "next", referenceType: "rollover", referenceId: "root", categoryName: "Loans Receivable", type: "debit" as const, amount: "15000000.00", journalGroupId: "principal" },
  { loanId: "root", referenceType: "rollover", referenceId: "next", categoryName: "Loans Receivable", type: "credit" as const, amount: "15000000.00", journalGroupId: "principal" },
  { loanId: "next", referenceType: "rollover", referenceId: "root", categoryName: "Loans Receivable", type: "debit" as const, amount: "1550000.00", journalGroupId: "interest" },
  { loanId: "next", referenceType: "rollover", referenceId: "root", categoryName: "Interest Earned", type: "credit" as const, amount: "1550000.00", journalGroupId: "interest" },
  { loanId: "next", referenceType: "loan", referenceId: "next", categoryName: "Loans Receivable", type: "debit" as const, amount: "10000000.00", journalGroupId: "fresh" },
  { loanId: null, referenceType: "loan", referenceId: "next", categoryName: "Cash", type: "credit" as const, amount: "10000000.00", journalGroupId: "fresh", depositLocation: "cash" },
];

function assemble(rows = journals) {
  return assembleRolloverChains({
    loans: [root, successor], payments: [], waivers: [], rates: [], journals: rows,
    paymentPortions: new Map(), waiverPortions: new Map(),
  });
}

describe("rollover correction snapshot assembly", () => {
  it("requires same-day receipt journal legs to stay on the predecessor", () => {
    const receipt = { id: "same-day", loanId: "root", amount: "1000000.00",
      paymentDate: new Date("2026-09-18T12:00:00Z") } as Payment;
    const rows = [
      ...journals.map((row) => row.journalGroupId === "principal"
        ? { ...row, amount: "14500000.00" }
        : row.journalGroupId === "interest" ? { ...row, amount: "2050000.00" } : row),
      { loanId: "root", referenceType: "payment", referenceId: receipt.id,
        categoryName: "Cash", type: "debit" as const, amount: "1000000.00",
        journalGroupId: "same-day", depositLocation: "cash", transactionDate: receipt.paymentDate },
      { loanId: "root", referenceType: "payment", referenceId: receipt.id,
        categoryName: "Interest Earned", type: "credit" as const, amount: "500000.00",
        journalGroupId: "same-day", transactionDate: receipt.paymentDate },
      { loanId: "root", referenceType: "payment", referenceId: receipt.id,
        categoryName: "Loans Receivable", type: "credit" as const, amount: "500000.00",
        journalGroupId: "same-day", transactionDate: receipt.paymentDate },
    ];
    const assembleReceipt = (sourceRows: typeof rows) => assembleRolloverChains({
      loans: [root, successor], payments: [receipt], waivers: [], rates: [],
      journals: sourceRows,
      paymentPortions: new Map([[receipt.id,
        { interestPortion: "500000.00", principalPortion: "500000.00" }]]),
      waiverPortions: new Map(),
    });
    expect(assembleReceipt(rows)[0].loans[0].sourceExceptions).toEqual([]);
    const misattributed = rows.map((row) => row.referenceId === receipt.id &&
      row.categoryName === "Interest Earned" ? { ...row, loanId: "next" } : row);
    expect(assembleReceipt(misattributed)[0].loans[0].sourceExceptions)
      .toContainEqual(expect.stringMatching(/same-day.*journal.*predecessor/i));
  });

  it("matches each original rollover leg using the correct predecessor/successor reference", () => {
    const chains = assemble();
    expect(chains).toHaveLength(1);
    expect(chains[0].loans.map((loan) => loan.sourceExceptions)).toEqual([[], []]);
    const plan = planRolloverCorrection(chains[0], "v1");
    expect(plan.classification).toBe("ready");
    expect(plan.edges[0].proposedPrincipal).toBe("26500000");
  });

  it("blocks a missing original rollover journal", () => {
    const chains = assemble(journals.filter((row) => row.journalGroupId !== "interest"));
    const plan = planRolloverCorrection(chains[0], "v1");
    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions).toContainEqual(expect.stringMatching(/does not reconcile/));
  });

  it("blocks a balanced-looking loan with an unbalanced journal group", () => {
    const rows = journals.filter((row) => !(row.journalGroupId === "issue" && row.loanId === null));
    const plan = planRolloverCorrection(assemble(rows)[0], "v1");
    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions).toContainEqual(expect.stringMatching(/journal group.*unbalanced/i));
  });

  it("blocks a receivable that exceeds the recorded principal", () => {
    const rows = [...journals,
      { loanId: "next", referenceType: "adjustment", referenceId: "extra", categoryName: "Loans Receivable", type: "debit" as const, amount: "100.00", journalGroupId: "extra" },
      { loanId: null, referenceType: "adjustment", referenceId: "extra", categoryName: "Cash", type: "credit" as const, amount: "100.00", journalGroupId: "extra" },
    ];
    const plan = planRolloverCorrection(assemble(rows)[0], "v1");
    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions).toContainEqual(expect.stringMatching(/receivable.*reconcile/i));
  });

  it("requires the fresh disbursement journal to equal principal less carry", () => {
    const rows = journals.filter((row) => row.journalGroupId !== "fresh");
    const plan = planRolloverCorrection(assemble(rows)[0], "v1");
    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions).toContainEqual(expect.stringMatching(/fresh disbursement/i));
  });

  it("rejects a balanced fresh-disbursement group without its cash counterparty", () => {
    const rows = journals.map((row) => row.journalGroupId === "fresh" && row.categoryName === "Cash"
      ? { ...row, categoryName: "Loan Losses" } : row);
    const plan = planRolloverCorrection(assemble(rows)[0], "v1");
    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions).toContainEqual(expect.stringMatching(/cash disbursement/i));
  });

  it("blocks a changed current rate when its dated history is missing", () => {
    const chains = assembleRolloverChains({
      loans: [{ ...root, interestRateOverride: "0.1200" }, successor],
      payments: [], waivers: [], rates: [], journals,
      paymentPortions: new Map(), waiverPortions: new Map(),
    });
    const plan = planRolloverCorrection(chains[0], "v1");
    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions).toContainEqual(expect.stringMatching(/rate history/i));
  });

  it("reconstructs an immediate rate adjustment from its dated audit", () => {
    const input = {
      loans: [{ ...root, interestRateOverride: "0.1200" }, successor],
      payments: [] as Payment[], waivers: [] as Waiver[], rates: [], journals,
      rateAudits: [{
        id: "audit-rate-1", entityId: "root", action: "loan.rate_change.immediate",
        occurredAt: date("2026-09-10"),
        beforeValue: JSON.stringify({ interestRate: "0.1000" }),
        afterValue: JSON.stringify({ interestRateOverride: "0.1200" }),
      }],
      paymentPortions: new Map(), waiverPortions: new Map(),
    };
    const chains = assembleRolloverChains(input);
    expect(chains[0].loans[0].rateChanges).toEqual([{
      effectiveDate: date("2026-09-10"), fromRate: "0.1000", toRate: "0.1200",
    }]);
    expect(chains[0].loans[0].sourceExceptions).toEqual([]);
  });

  it("blocks a successor linked across customer identities", () => {
    const chains = assembleRolloverChains({
      loans: [{ ...root, customerId: "customer-a" },
        { ...successor, customerId: "customer-b" }],
      payments: [], waivers: [], rates: [], journals,
      paymentPortions: new Map(), waiverPortions: new Map(),
    });
    expect(planRolloverCorrection(chains[0], "v1").classification).toBe("blocked");
  });

  it("blocks a payment allocation that has no matching cash receipt", () => {
    const payment = { id: "payment-a", loanId: "next", amount: "100.00",
      paymentDate: date("2026-09-19") } as Payment;
    const rows = [...journals,
      { loanId: "next", referenceType: "payment", referenceId: payment.id,
        categoryName: "Loan Losses", type: "debit" as const,
        amount: "100.00", journalGroupId: "false-cash" },
      { loanId: "next", referenceType: "payment", referenceId: payment.id,
        categoryName: "Interest Earned", type: "credit" as const,
        amount: "100.00", journalGroupId: "false-cash" },
    ];
    const chains = assembleRolloverChains({
      loans: [root, successor], payments: [payment], waivers: [], rates: [],
      journals: rows,
      paymentPortions: new Map([[payment.id,
        { interestPortion: "100.00", principalPortion: "0.00" }]]),
      waiverPortions: new Map(),
    });
    const plan = planRolloverCorrection(chains[0], "v1");
    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions).toContainEqual(expect.stringMatching(/cash receipt/i));
  });

  it("blocks a waiver allocation without a matching non-cash loss", () => {
    const waiver = { id: "waiver-a", loanId: "next", amount: "100.00",
      waiverDate: date("2026-09-19") } as Waiver;
    const rows = [...journals,
      { loanId: "next", referenceType: "loan_waiver", referenceId: waiver.id,
        categoryName: "Cash", type: "debit" as const,
        amount: "100.00", journalGroupId: "false-loss" },
      { loanId: "next", referenceType: "loan_waiver", referenceId: waiver.id,
        categoryName: "Interest Earned", type: "credit" as const,
        amount: "100.00", journalGroupId: "false-loss" },
    ];
    const chains = assembleRolloverChains({
      loans: [root, successor], payments: [], waivers: [waiver], rates: [],
      journals: rows,
      paymentPortions: new Map(),
      waiverPortions: new Map([[waiver.id,
        { interestPortion: "100.00", principalPortion: "0.00" }]]),
    });
    const plan = planRolloverCorrection(chains[0], "v1");
    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions).toContainEqual(expect.stringMatching(/loan loss/i));
  });

  it("blocks an orphan interest journal from an unrecorded payment", () => {
    const rows = [...journals,
      { loanId: "next", referenceType: "payment", referenceId: "ghost-payment",
        categoryName: "Cash", type: "debit" as const,
        amount: "100.00", journalGroupId: "ghost" },
      { loanId: "next", referenceType: "payment", referenceId: "ghost-payment",
        categoryName: "Interest Earned", type: "credit" as const,
        amount: "100.00", journalGroupId: "ghost" },
    ];
    const plan = planRolloverCorrection(assemble(rows)[0], "v1");
    expect(plan.classification).toBe("blocked");
    expect(plan.exceptions).toContainEqual(expect.stringMatching(/orphan payment ghost-payment/i));
  });
});
