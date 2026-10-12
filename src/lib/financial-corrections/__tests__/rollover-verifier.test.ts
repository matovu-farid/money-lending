import { describe, expect, it } from "vitest";
import { planRolloverCorrection, type ChainSnapshot } from "@/lib/interest/rollover-correction";
import { verifyRolloverCorrectionEvidence, type RolloverSourceJournal } from
  "../rollover-verifier";

const date = (value: string) => new Date(`${value}T00:00:00Z`);
const base = {
  interestRate: "0.10", interestRateOverride: null, penaltyMultiplier: "0.1000",
  penaltyWaived: false, penaltyWaivedAt: null, penaltyWaivedBy: null,
  minInterestDays: 30, minPeriodOverride: null, issuanceFee: "0",
  disbursementSource: "cash", subLocationId: null,
  loanType: "perpetual", sourceExceptions: [], sourceDigest: "reconciled-ledger",
  payments: [], waivers: [], rateChanges: [], deletedAt: null,
};
const snapshot: ChainSnapshot = { loans: [
  { ...base, id: "root", rolledOverFrom: null, principalAmount: "15000000",
    rolloverAmount: null, startDate: date("2026-08-28"),
    createdAt: date("2026-08-28"), status: "rolled_over" },
  { ...base, id: "next", rolledOverFrom: "root", principalAmount: "26550000",
    rolloverAmount: "16550000", startDate: date("2026-09-18"),
    createdAt: date("2026-09-18"), status: "active" },
] };
type DatedJournal = RolloverSourceJournal & { transactionDate: Date;
  depositLocation: string | null; subLocationId: string | null };
const journal = (group: string, loanId: string | null, categoryName: string,
  type: "debit" | "credit", amount: string, referenceType: string,
  referenceId: string, at = group === "root-issue" ? date("2026-08-28")
    : date("2026-09-18")): DatedJournal => ({ journalGroupId: group,
  loanId, categoryName, type, amount, referenceType, referenceId,
  transactionDate: at, depositLocation: categoryName === "Cash" ? "cash" : null,
  subLocationId: null });
const source: DatedJournal[] = [
  journal("root-issue", "root", "Loans Receivable", "debit", "15000000", "loan", "root"),
  journal("root-issue", null, "Cash", "credit", "15000000", "loan", "root"),
  journal("next-issue", "next", "Loans Receivable", "debit", "10000000", "loan", "next"),
  journal("next-issue", null, "Cash", "credit", "10000000", "loan", "next"),
  journal("transfer", "next", "Loans Receivable", "debit", "15000000", "rollover", "root"),
  journal("transfer", "root", "Loans Receivable", "credit", "15000000", "rollover", "next"),
  journal("interest", "next", "Loans Receivable", "debit", "1550000", "rollover", "root"),
  journal("interest", "next", "Interest Earned", "credit", "1550000", "rollover", "root"),
];

describe("independent rollover evidence", () => {
  it("recomputes the effective-date carry from source terms", () => {
    const plan = planRolloverCorrection(snapshot, "v3");
    const evidence = verifyRolloverCorrectionEvidence(snapshot, plan, source);
    expect(evidence.edges[0])
      .toEqual(expect.objectContaining({ carriedPrincipal: "15000000.00",
        carriedInterest: "1500000.00", freshCash: "10000000.00" }));
    expect(evidence.projectedJournalGroups.every((group) =>
      group.legs.every((leg) => leg.category !== "Cash"))).toBe(true);
    expect(() => verifyRolloverCorrectionEvidence(snapshot, {
      ...plan, edges: [{ ...plan.edges[0], carriedInterest: "1550000" }],
    }, source)).toThrow(/carry|interest/i);
  });

  it("replays a dated payment allocation and rejects a changed proposal", () => {
    const withPayment = structuredClone(snapshot);
    withPayment.loans[1].payments = [Object.assign({ id: "receipt-1",
      paymentDate: date("2026-09-20"), amount: "1000000",
      interestPortion: "500000", principalPortion: "500000", recorderName: "" },
    { depositLocation: "cash", subLocationId: null })];
    const paymentSource = [...source,
      journal("receipt", "next", "Cash", "debit", "1000000", "payment", "receipt-1", date("2026-09-20")),
      journal("receipt", "next", "Interest Earned", "credit", "500000", "payment", "receipt-1", date("2026-09-20")),
      journal("receipt", "next", "Loans Receivable", "credit", "500000", "payment", "receipt-1", date("2026-09-20")),
    ];
    const plan = planRolloverCorrection(withPayment, "v3");
    expect(plan.classification).toBe("review");
    expect(verifyRolloverCorrectionEvidence(withPayment, plan, paymentSource).settlements)
      .toEqual([expect.objectContaining({ id: "receipt-1" })]);
    expect(() => verifyRolloverCorrectionEvidence(withPayment, {
      ...plan, settlementChanges: plan.settlementChanges.map((change) => ({
        ...change, newPrincipal: "123.00",
      })),
    }, paymentSource)).toThrow(/allocation/i);
  });

  it("accepts legitimate issuance fees in separate cash and income groups", () => {
    const withFees = structuredClone(snapshot);
    withFees.loans[0].issuanceFee = "1000";
    withFees.loans[1].issuanceFee = "500";
    const withFeeJournals = [...source,
      journal("root-fee", "root", "Cash", "debit", "1000", "loan", "root", date("2026-08-28")),
      journal("root-fee", "root", "Issuance Fees", "credit", "1000", "loan", "root", date("2026-08-28")),
      journal("next-fee", "next", "Cash", "debit", "500", "loan", "next"),
      journal("next-fee", "next", "Issuance Fees", "credit", "500", "loan", "next"),
    ];
    const plan = planRolloverCorrection(withFees, "v4");
    expect(verifyRolloverCorrectionEvidence(withFees, plan, withFeeJournals).edges)
      .toHaveLength(1);
  });

  it("rejects a fee receipt at a different cash location", () => {
    const withFee = structuredClone(snapshot);
    withFee.loans[0].issuanceFee = "1000";
    const feeRows = [
      { ...journal("fee", "root", "Cash", "debit", "1000", "loan", "root", date("2026-08-28")),
        depositLocation: "bank" },
      journal("fee", "root", "Issuance Fees", "credit", "1000", "loan", "root", date("2026-08-28")),
    ];
    expect(() => verifyRolloverCorrectionEvidence(withFee,
      planRolloverCorrection(withFee, "v4"), [...source, ...feeRows]))
      .toThrow(/fee.*location|cash.*location/i);
  });

  it("rejects a balanced fee group that differs from the loan's recorded fee", () => {
    const withFee = structuredClone(snapshot);
    withFee.loans[0].issuanceFee = "1000";
    const feeRows = [
      journal("fee", "root", "Cash", "debit", "900", "loan", "root", date("2026-08-28")),
      journal("fee", "root", "Issuance Fees", "credit", "900", "loan", "root", date("2026-08-28")),
    ];
    expect(() => verifyRolloverCorrectionEvidence(withFee,
      planRolloverCorrection(withFee, "v4"), [...source, ...feeRows]))
      .toThrow(/issuance fee does not reconcile/i);
  });

  it("rejects a balanced rollover transfer dated after the successor starts", () => {
    const shifted = source.map((row) => row.journalGroupId === "transfer"
      ? { ...row, transactionDate: date("2026-09-19") } : row);
    expect(() => verifyRolloverCorrectionEvidence(snapshot,
      planRolloverCorrection(snapshot, "v4"), shifted))
      .toThrow(/transfer journal date/i);
  });

  it("rejects a payment whose balanced journals are shifted to another date", () => {
    const withPayment = structuredClone(snapshot);
    withPayment.loans[1].payments = [Object.assign({ id: "receipt-1",
      paymentDate: date("2026-09-20"), amount: "1000000",
      interestPortion: "500000", principalPortion: "500000", recorderName: "" },
    { depositLocation: "cash", subLocationId: null })];
    const shifted = [...source,
      journal("receipt", "next", "Cash", "debit", "1000000", "payment", "receipt-1", date("2026-10-01")),
      journal("receipt", "next", "Interest Earned", "credit", "500000", "payment", "receipt-1", date("2026-10-01")),
      journal("receipt", "next", "Loans Receivable", "credit", "500000", "payment", "receipt-1", date("2026-10-01")),
    ];
    expect(() => verifyRolloverCorrectionEvidence(withPayment,
      planRolloverCorrection(withPayment, "v4"), shifted))
      .toThrow(/date/i);
  });

  it("rejects a payment cash leg at a different deposit location", () => {
    const withPayment = structuredClone(snapshot);
    withPayment.loans[1].payments = [Object.assign({ id: "receipt-1",
      paymentDate: date("2026-09-20"), amount: "1000000",
      interestPortion: "500000", principalPortion: "500000", recorderName: "" },
    { depositLocation: "cash", subLocationId: null })];
    const paymentRows = [...source,
      { ...journal("receipt", "next", "Cash", "debit", "1000000", "payment", "receipt-1", date("2026-09-20")),
        depositLocation: "bank", subLocationId: "wrong-account" },
      journal("receipt", "next", "Interest Earned", "credit", "500000", "payment", "receipt-1", date("2026-09-20")),
      journal("receipt", "next", "Loans Receivable", "credit", "500000", "payment", "receipt-1", date("2026-09-20")),
    ];
    expect(() => verifyRolloverCorrectionEvidence(withPayment,
      planRolloverCorrection(withPayment, "v4"), paymentRows))
      .toThrow(/payment.*location|cash.*location/i);
  });

  it("accepts an edited receipt when old-location cash is fully reversed", () => {
    const withPayment = structuredClone(snapshot);
    withPayment.loans[1].payments = [Object.assign({ id: "receipt-1",
      paymentDate: date("2026-09-20"), amount: "1000000",
      interestPortion: "500000", principalPortion: "500000", recorderName: "" },
    { depositLocation: "cash", subLocationId: null })];
    const at = date("2026-09-20");
    const oldAt = date("2026-09-19");
    const edited = [...source,
      { ...journal("old-receipt", "next", "Cash", "debit", "1000000", "payment", "receipt-1", oldAt),
        depositLocation: "bank", subLocationId: "old-account" },
      journal("old-receipt", "next", "Interest Earned", "credit", "1000000", "payment", "receipt-1", oldAt),
      journal("reversal", "next", "Interest Earned", "debit", "1000000", "payment_reversal", "receipt-1", oldAt),
      { ...journal("reversal", "next", "Cash", "credit", "1000000", "payment_reversal", "receipt-1", oldAt),
        depositLocation: "bank", subLocationId: "old-account" },
      journal("current-receipt", "next", "Cash", "debit", "1000000", "payment", "receipt-1", at),
      journal("current-receipt", "next", "Interest Earned", "credit", "500000", "payment", "receipt-1", at),
      journal("current-receipt", "next", "Loans Receivable", "credit", "500000", "payment", "receipt-1", at),
    ];
    expect(verifyRolloverCorrectionEvidence(withPayment,
      planRolloverCorrection(withPayment, "v4"), edited).settlements)
      .toEqual([expect.objectContaining({ id: "receipt-1" })]);
  });

  it("refuses an unreconciled source even if the plan is labeled ready", () => {
    const plan = planRolloverCorrection(snapshot, "v3");
    const unsafe = structuredClone(snapshot);
    unsafe.loans[0].sourceExceptions!.push("missing receipt");
    expect(() => verifyRolloverCorrectionEvidence(unsafe, plan, source))
      .toThrow(/unreconciled/i);
  });

  it("fails closed on rate or penalty history outside the checked source subset", () => {
    const changed = structuredClone(snapshot);
    changed.loans[0].rateChanges = [{ effectiveDate: date("2026-09-10"),
      fromRate: "0.10", toRate: "0.12" }];
    const plan = planRolloverCorrection(changed, "v4");
    expect(() => verifyRolloverCorrectionEvidence(changed, plan, source))
      .toThrow(/separate source verification/i);
  });

  it("refuses unbalanced or non-reconciling source journals", () => {
    const plan = planRolloverCorrection(snapshot, "v3");
    expect(() => verifyRolloverCorrectionEvidence(snapshot, plan,
      source.filter((row) => !(row.journalGroupId === "interest" &&
        row.categoryName === "Interest Earned"))))
      .toThrow(/unbalanced/i);
    const altered = source.map((row) => row.journalGroupId === "transfer"
      ? { ...row, amount: "14900000" } : row);
    expect(() => verifyRolloverCorrectionEvidence(snapshot, plan, altered))
      .toThrow(/transfer|receivable/i);
    const unexplained = [...source,
      journal("extra", "next", "Interest Earned", "credit", "100", "manual", "extra"),
      journal("extra", "next", "Cash", "debit", "100", "manual", "extra")];
    expect(() => verifyRolloverCorrectionEvidence(snapshot, plan, unexplained))
      .toThrow(/unexplained/i);
  });
});
