import { describe, expect, it } from "vitest";
import { hashReviewEvidence } from "../../financial-corrections/agent-review";
import { buildLoanStatement } from "../../loan-statement";
import {
  planFullyPaidAllocationRepair,
  FULLY_PAID_ALLOCATION_POLICY_VERSION,
  type AppliedCorrectionProof,
  type FullyPaidAllocationSnapshot,
  type HistoricalPayment,
  type OriginalJournalAllocation,
  type OriginalJournalLeg,
} from "../fully-paid-allocation-repair";

const first = "93e3b8a0-2085-4ff3-b452-c20e43f68086";
const second = "3a229c30-ae41-40c3-a461-8702131dfbc4";

function journalsFor(payments: HistoricalPayment[]): { allocations: OriginalJournalAllocation[]; legs: OriginalJournalLeg[] } {
  const legs: OriginalJournalLeg[] = [];
  const allocations = payments.map((p) => {
    const groupIds: string[] = [];
    for (const [category, value] of [["Interest Earned", p.interest], ["Loans Receivable", p.principal], ["Overpayment Revenue", p.overpayment]] as const) {
      if (value === "0.00") continue;
      const groupId = `${p.id}-${category}`;
      groupIds.push(groupId);
      for (const [side, account] of [["debit", "Cash"], ["credit", category]] as const) {
        legs.push({ id: `${groupId}-${side}`, groupId, paymentId: p.id, loanId: p.loanId,
          referenceType: "payment", effectiveAt: p.effectiveAt, side, account,
          amount: value, accountType: account === "Cash" || account === "Loans Receivable" ? "asset" : "revenue",
          depositLocation: account === "Cash" ? p.depositLocation : null,
          subLocationId: account === "Cash" ? p.subLocationId : null });
      }
    }
    return { paymentId: p.id, loanId: p.loanId, effectiveAt: p.effectiveAt,
      cash: p.amount, interest: p.interest, principal: p.principal,
      overpayment: p.overpayment, groupIds };
  });
  return { allocations, legs };
}

function replacePaymentEvidence(input: FullyPaidAllocationSnapshot): void {
  const journals = journalsFor(input.payments);
  input.journalAllocations = journals.allocations;
  input.originalJournalLegs = journals.legs;
  input.currentLedgerAllocations = input.payments.map((p) => ({ paymentId: p.id, loanId: p.loanId,
    effectiveAt: p.effectiveAt, cash: p.amount, interest: p.interest,
    principal: p.principal, overpayment: p.overpayment }));
  input.auditProof.paymentCreates = input.payments.map((p) => ({ action: "payment.create", beforeNull: true, paymentId: p.id, loanId: p.loanId,
    effectiveAt: p.effectiveAt, amount: p.amount, depositLocation: p.depositLocation,
    subLocationId: p.subLocationId }));
}

function fixture(): FullyPaidAllocationSnapshot {
  const loanId = "64bebb1e-275b-4031-b4f8-2eae6b6bbf63";
  const payments = [
    { id: first, loanId, effectiveAt: "2026-06-30T12:00:00.000Z", amount: "7700000.00", interest: "1306666.67", principal: "6393333.33", overpayment: "0.00", depositLocation: "strong_room" as const, subLocationId: null },
    { id: second, loanId, effectiveAt: "2026-07-01T12:00:00.000Z", amount: "680000.00", interest: "0.00", principal: "606666.67", overpayment: "73333.33", depositLocation: "cash" as const, subLocationId: null },
  ];
  const input: FullyPaidAllocationSnapshot = {
    asOf: "2026-10-13T00:00:00.000Z",
    sourceDigest: "a".repeat(64),
    loan: { id: loanId, status: "fully_paid", type: "perpetual", principal: "7000000.00", monthlyRate: "0.1000", penaltyMultiplier: "0.1000", minInterestDays: 30, startAt: "2026-05-05T00:00:00.000Z", interestRateOverride: null, minPeriodOverride: null, rolledOverFrom: null, rolledOverTo: null, penaltyWaived: false },
    payments,
    currentLedgerAllocations: payments.map((p) => ({ paymentId: p.id, loanId, effectiveAt: p.effectiveAt,
      cash: p.amount, interest: p.interest, principal: p.principal, overpayment: p.overpayment })),
    currentLedgerComplete: true,
    correctionProof: null,
    journalAllocations: [], originalJournalLegs: [], journalsComplete: true,
    auditProof: { loanCreate: { action: "loan.create", beforeNull: true, loanId, principal: "7000000.00", monthlyRate: "0.1000", penaltyMultiplier: "0.1000", minInterestDays: 30, startAt: "2026-05-05T00:00:00.000Z", type: "perpetual" }, paymentCreates: [], complete: true },
    rateChanges: [], waivers: [], reversals: [], extraPaymentJournals: [], otherRelevantAudits: [], sourceExceptions: [],
  };
  replacePaymentEvidence(input);
  return input;
}

function postapplyFixture(
  reviewedAsOf = "2026-10-13T00:00:00.000Z",
  postapplyAsOf = "2026-10-13T02:00:00.000Z",
): FullyPaidAllocationSnapshot {
  const input = fixture();
  input.asOf = reviewedAsOf;
  const ready = planFullyPaidAllocationRepair(input);
  expect(ready.status).toBe("ready");
  const expectedGroups = [
    { paymentId: first, effectiveAt: input.payments[0].effectiveAt, entries: [
      { account: "Loans Receivable", side: "debit", amount: "0.33" },
      { account: "Interest Earned", side: "credit", amount: "0.33" },
    ] },
    { paymentId: second, effectiveAt: input.payments[1].effectiveAt, entries: [
      { account: "Overpayment Revenue", side: "debit", amount: "2022.00" },
      { account: "Interest Earned", side: "credit", amount: "2022.00" },
    ] },
    { paymentId: second, effectiveAt: input.payments[1].effectiveAt, entries: [
      { account: "Overpayment Revenue", side: "debit", amount: "0.33" },
      { account: "Loans Receivable", side: "credit", amount: "0.33" },
    ] },
  ] as const;
  const runId = "11111111-1111-4111-8111-111111111111";
  const reviewId = "22222222-2222-4222-8222-222222222222";
  const evidence = { kind: "fully-paid-allocation-repair", loanId: input.loan.id,
    reviewedAsOf: input.asOf, preapplySourceDigest: input.sourceDigest, expectedGroups };
  const proof: AppliedCorrectionProof = {
    run: { id: runId, loanId: input.loan.id, planHash: ready.planHash,
      inputFingerprint: ready.sourceFingerprint, policyVersion: FULLY_PAID_ALLOCATION_POLICY_VERSION,
      agentReviewId: reviewId, appliedByAgent: "agent:executor", backupSha256: "c".repeat(64),
      afterSummary: JSON.stringify({ kind: "fully-paid-allocation-repair", loanId: input.loan.id,
        planHash: ready.planHash, groups: expectedGroups.map((group, index) => ({
          paymentId: group.paymentId, groupId: `correction-group-${index}` })) }),
      appliedAt: "2026-10-13T01:00:00.000Z" },
    review: { id: reviewId, kind: "fully-paid-allocation-repair", subjectId: input.loan.id,
      planHash: ready.planHash, inputFingerprint: ready.sourceFingerprint,
      policyVersion: FULLY_PAID_ALLOCATION_POLICY_VERSION, verdict: "pass",
      reviewerAgentId: "agent:reviewer", consumedByRunId: runId,
      consumedAt: "2026-10-13T01:00:00.000Z", evidenceJson: JSON.stringify(evidence),
      evidenceSha256: hashReviewEvidence(evidence) },
    journalLegs: expectedGroups.flatMap((group, index) => group.entries.map((entry, legIndex) => ({
      id: `correction-${index}-${legIndex}`, groupId: `correction-group-${index}`,
      loanId: input.loan.id, paymentId: group.paymentId,
      referenceType: "payment", referenceId: group.paymentId,
      description: `Payment allocation repair run ${runId} payment ${group.paymentId}`,
      effectiveAt: group.effectiveAt, account: entry.account,
      accountType: entry.account === "Loans Receivable" ? "asset" as const : "revenue" as const,
      side: entry.side, amount: entry.amount, depositLocation: null, subLocationId: null,
      recordedBy: "agent:executor", createdAt: "2026-10-13T01:00:00.000Z",
    }))),
    journalsComplete: true,
  };
  input.currentLedgerAllocations = ready.allocations.map((row) => ({ paymentId: row.paymentId,
    loanId: input.loan.id, effectiveAt: row.effectiveAt, cash: row.amount, ...row.after }));
  input.correctionProof = proof;
  input.sourceDigest = "b".repeat(64);
  input.asOf = postapplyAsOf;
  return input;
}

describe("fully-paid allocation repair planner", () => {
  it("replays the production-derived two-payment case with the exact server clamp", () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const plan = planFullyPaidAllocationRepair(input);
    expect(plan.status, plan.blockers.join("; ")).toBe("ready");
    expect(plan.finalPrincipal).toBe("0.00");
    expect(plan.allocations).toMatchObject([
      { paymentId: first, before: { interest: "1306666.67", principal: "6393333.33", overpayment: "0.00" }, after: { interest: "1306667.00", principal: "6393333.00", overpayment: "0.00" } },
      { paymentId: second, before: { interest: "0.00", principal: "606666.67", overpayment: "73333.33" }, after: { interest: "2022.00", principal: "606667.00", overpayment: "71311.00" } },
    ]);
    expect(plan.effects).toEqual([
      { paymentId: first, effectiveAt: "2026-06-30T12:00:00.000Z", account: "Loans Receivable", side: "debit", amount: "0.33" },
      { paymentId: first, effectiveAt: "2026-06-30T12:00:00.000Z", account: "Interest Earned", side: "credit", amount: "0.33" },
      { paymentId: second, effectiveAt: "2026-07-01T12:00:00.000Z", account: "Overpayment Revenue", side: "debit", amount: "2022.33" },
      { paymentId: second, effectiveAt: "2026-07-01T12:00:00.000Z", account: "Interest Earned", side: "credit", amount: "2022.00" },
      { paymentId: second, effectiveAt: "2026-07-01T12:00:00.000Z", account: "Loans Receivable", side: "credit", amount: "0.33" },
    ]);
    expect(plan.policyVersion).toBeTruthy();
    expect(plan.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(planFullyPaidAllocationRepair(input)).toEqual(plan);
    expect(Object.isFrozen(plan.allocations[0].after)).toBe(true);
    expect(Object.isFrozen(plan.effects)).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("returns noop after an exactly reviewed correction while original Cash pairs remain immutable", () => {
    const input = postapplyFixture();
    const original = JSON.stringify({ payments: input.payments, journalAllocations: input.journalAllocations,
      originalJournalLegs: input.originalJournalLegs });
    const plan = planFullyPaidAllocationRepair(input);
    expect(plan.status, plan.blockers.join("; ")).toBe("noop");
    expect(plan.effects).toEqual([]);
    expect(plan.allocations[0]).toMatchObject({ before: { interest: "1306666.67" },
      current: { interest: "1306667.00" }, after: { interest: "1306667.00" } });
    expect(JSON.stringify({ payments: input.payments, journalAllocations: input.journalAllocations,
      originalJournalLegs: input.originalJournalLegs })).toBe(original);
  });

  it("proves a backdated correction at historical asOf even when application occurred later", () => {
    const historicalAsOf = "2026-10-10T00:00:00.000Z";
    const input = postapplyFixture(historicalAsOf, historicalAsOf);
    expect(input.correctionProof!.run.appliedAt).toBe("2026-10-13T01:00:00.000Z");
    expect(JSON.parse(input.correctionProof!.review.evidenceJson).reviewedAsOf).toBe(historicalAsOf);
    expect(input.correctionProof!.journalLegs.every((leg) => leg.effectiveAt <= historicalAsOf)).toBe(true);

    const plan = planFullyPaidAllocationRepair(input);
    expect(plan.status, plan.blockers.join("; ")).toBe("noop");
    expect(plan.effects).toEqual([]);
    expect(plan.allocations.every((row) => row.current.interest === row.after.interest &&
      row.current.principal === row.after.principal && row.current.overpayment === row.after.overpayment)).toBe(true);
  });

  it("proves a later-reviewed plan at a historical asOf when all receipts precede that cutoff", () => {
    const input = postapplyFixture("2026-10-13T00:00:00.000Z", "2026-10-10T00:00:00.000Z");
    const plan = planFullyPaidAllocationRepair(input);
    expect(plan.status, plan.blockers.join("; ")).toBe("noop");
    expect(plan.effects).toEqual([]);
  });

  it("blocks a historical snapshot containing a receipt beyond its effective-date cutoff", () => {
    const input = postapplyFixture("2026-10-10T00:00:00.000Z", "2026-06-30T12:00:00.000Z");
    const plan = planFullyPaidAllocationRepair(input);
    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toContain("Payment identity, effective date or order is ambiguous");
    expect(plan.effects).toEqual([]);
  });

  it("blocks a correction journal backdated to a different effective date", () => {
    const input = postapplyFixture("2026-10-10T00:00:00.000Z", "2026-10-10T00:00:00.000Z");
    input.correctionProof!.journalLegs[0].effectiveAt = "2026-10-11T00:00:00.000Z";
    const plan = planFullyPaidAllocationRepair(input);
    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toContain("Correction journal leg lacks exact run/payment attribution");
  });

  it("does not reconstruct a reviewed plan using receipts later than reviewedAsOf", () => {
    const input = postapplyFixture("2026-10-10T00:00:00.000Z", "2026-10-10T00:00:00.000Z");
    const evidence = JSON.parse(input.correctionProof!.review.evidenceJson);
    evidence.reviewedAsOf = "2026-06-30T12:00:00.000Z";
    input.correctionProof!.review.evidenceJson = JSON.stringify(evidence);
    input.correctionProof!.review.evidenceSha256 = hashReviewEvidence(evidence);
    const plan = planFullyPaidAllocationRepair(input);
    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toContain("Applied run does not match the original ready plan");
  });

  it("still requires the independent review and run linkage for historical asOf", () => {
    const input = postapplyFixture("2026-10-10T00:00:00.000Z", "2026-10-10T00:00:00.000Z");
    input.correctionProof!.review.consumedByRunId = "another-run";
    const plan = planFullyPaidAllocationRepair(input);
    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toContain("Correction run and independent review are not linked");
  });

  it.each([
    ["executor actor", (s: FullyPaidAllocationSnapshot) => {
      s.correctionProof!.journalLegs[0].recordedBy = "agent:other";
    }],
    ["posting time", (s: FullyPaidAllocationSnapshot) => {
      s.correctionProof!.journalLegs[0].createdAt = "2026-10-13T01:00:01.000Z";
    }],
  ])("rejects a correction journal with tampered %s despite matching reviewed effects", (_name, mutate) => {
    const input = postapplyFixture("2026-10-10T00:00:00.000Z", "2026-10-10T00:00:00.000Z");
    mutate(input);
    const plan = planFullyPaidAllocationRepair(input);
    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toContain("Correction journal leg lacks exact run/payment attribution");
  });

  it("blocks a near-midnight receipt when UTC and Kampala settlement days differ", () => {
    const input = fixture();
    input.payments[0].effectiveAt = "2026-06-30T22:30:00.000Z";
    input.payments[1].effectiveAt = "2026-07-02T12:00:00.000Z";
    replacePaymentEvidence(input);
    const plan = planFullyPaidAllocationRepair(input);
    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toContain("UTC and Africa/Kampala settlement allocations disagree");
    expect(plan.effects).toEqual([]);
  });

  it("blocks a receipt spanning the overdue penalty threshold across the two day boundaries", () => {
    const input = fixture();
    input.payments = [{ id: first, loanId: input.loan.id,
      effectiveAt: "2026-07-04T22:30:00.000Z", amount: "9000000.00",
      interest: "2000000.00", principal: "7000000.00", overpayment: "0.00",
      depositLocation: "cash", subLocationId: null }];
    replacePaymentEvidence(input);
    const start = new Date(input.loan.startAt);
    const statementLoan = { id: input.loan.id, principalAmount: input.loan.principal,
      interestRate: input.loan.monthlyRate, interestRateOverride: null,
      penaltyMultiplier: input.loan.penaltyMultiplier, penaltyWaived: false,
      penaltyWaivedAt: null, penaltyWaivedBy: null, minInterestDays: input.loan.minInterestDays,
      issuanceFee: "0.00", loanType: "perpetual", startDate: start, createdAt: start };
    const utc = buildLoanStatement({ loan: statementLoan, payments: [],
      today: new Date("2026-07-04T23:59:59.999Z") });
    const kampala = buildLoanStatement({ loan: statementLoan, payments: [],
      today: new Date("2026-07-05T20:59:59.999Z") });
    expect([utc.finalState.penaltyActive, kampala.finalState.penaltyActive]).toEqual([false, true]);
    const plan = planFullyPaidAllocationRepair(input);
    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toContain("UTC and Africa/Kampala settlement allocations disagree");
  });

  it.each([
    ["run-ID-referenced correction legs", (s: FullyPaidAllocationSnapshot) => {
      for (const leg of s.correctionProof!.journalLegs) {
        leg.referenceType = "payment_allocation_repair";
        leg.referenceId = s.correctionProof!.run.id;
      }
    }],
    ["missing correction leg", (s: FullyPaidAllocationSnapshot) => s.correctionProof!.journalLegs.pop()],
    ["extra correction leg", (s: FullyPaidAllocationSnapshot) => s.correctionProof!.journalLegs.push({
      ...s.correctionProof!.journalLegs[0], id: "extra-leg", groupId: "extra-group" })],
    ["tampered correction amount", (s: FullyPaidAllocationSnapshot) => s.correctionProof!.journalLegs[0].amount = "0.34"],
    ["tampered correction category", (s: FullyPaidAllocationSnapshot) => s.correctionProof!.journalLegs[0].account = "Fee Earned"],
    ["wrong correction payment reference", (s: FullyPaidAllocationSnapshot) => s.correctionProof!.journalLegs[0].referenceId = second],
    ["missing run group map", (s: FullyPaidAllocationSnapshot) => s.correctionProof!.run.afterSummary = ""],
    ["wrong run group map", (s: FullyPaidAllocationSnapshot) => {
      const summary = JSON.parse(s.correctionProof!.run.afterSummary);
      summary.groups[0].paymentId = second;
      s.correctionProof!.run.afterSummary = JSON.stringify(summary);
    }],
    ["wrong review linkage", (s: FullyPaidAllocationSnapshot) => s.correctionProof!.review.planHash = "f".repeat(64)],
    ["wrong review evidence digest", (s: FullyPaidAllocationSnapshot) => s.correctionProof!.review.evidenceSha256 = "f".repeat(64)],
    ["incomplete correction journals", (s: FullyPaidAllocationSnapshot) => s.correctionProof!.journalsComplete = false],
    ["wrong current ledger split", (s: FullyPaidAllocationSnapshot) => s.currentLedgerAllocations[1].interest = "2021.00"],
    ["missing correction proof", (s: FullyPaidAllocationSnapshot) => { s.correctionProof = null; }],
  ])("blocks postapply %s", (_name, mutate) => {
    const input = postapplyFixture(); mutate(input);
    expect(planFullyPaidAllocationRepair(input)).toMatchObject({ status: "blocked", effects: [] });
  });

  it("binds the fingerprint to relied-upon payment audit content", () => {
    const input = fixture();
    const original = planFullyPaidAllocationRepair(input);
    input.auditProof.paymentCreates[0].amount = "7700000";
    const revised = planFullyPaidAllocationRepair(input);
    expect(revised.status).toBe("ready");
    expect(revised.sourceFingerprint).not.toBe(original.sourceFingerprint);
    expect(revised.planHash).not.toBe(original.planHash);
  });

  it("binds the source fingerprint to the parent portfolio digest", () => {
    const input = fixture();
    const original = planFullyPaidAllocationRepair(input);
    input.sourceDigest = "b".repeat(64);
    const revised = planFullyPaidAllocationRepair(input);
    expect(revised.status).toBe("ready");
    expect(revised.sourceFingerprint).not.toBe(original.sourceFingerprint);
  });

  it("canonicalizes irrelevant object and journal-leg order for the source hash", () => {
    const input = fixture();
    const original = planFullyPaidAllocationRepair(input);
    input.originalJournalLegs.reverse();
    input.journalAllocations.forEach((row) => row.groupIds.reverse());
    const reordered = Object.fromEntries(Object.entries(input).reverse()) as FullyPaidAllocationSnapshot;
    const secondPlan = planFullyPaidAllocationRepair(reordered);
    expect(secondPlan.sourceFingerprint).toBe(original.sourceFingerprint);
    expect(secondPlan.planHash).toBe(original.planHash);
  });

  it.each([
    ["8e4cc5ec-f021-46ee-8025-9ddc789e47dc", "6000000.00", "2025-12-08T00:00:00.000Z", [
      ["2026-01-20T12:00:00.000Z", "600000.00", "600000.00", "0.00", "0.00"],
      ["2026-05-25T12:00:00.000Z", "8500000.00", "2500000.00", "6000000.00", "0.00"],
    ], "416000.00"],
    ["efdc1530-b4ca-46a4-8b4d-b2e73a119347", "5000000.00", "2026-05-30T00:00:00.000Z", [
      ["2026-06-30T12:00:00.000Z", "1500000.00", "516666.67", "983333.33", "0.00"],
      ["2026-08-13T12:00:00.000Z", "400000.00", "400000.00", "0.00", "0.00"],
      ["2026-08-21T12:00:00.000Z", "4310000.00", "292944.00", "4016666.67", "389.33"],
    ], "2889.00"],
  ] as const)("blocks false fully-paid closure %s with residual principal", (id, principal, startAt, rows, residual) => {
    const input = fixture();
    input.loan.id = id; input.loan.principal = principal; input.loan.startAt = startAt;
    input.payments = rows.map(([effectiveAt, amount, interest, paidPrincipal, overpayment], i) => ({ id: `payment-${i}`, loanId: id, effectiveAt, amount, interest, principal: paidPrincipal, overpayment, depositLocation: "cash", subLocationId: null }));
    input.auditProof.loanCreate.loanId = id; input.auditProof.loanCreate.principal = principal; input.auditProof.loanCreate.startAt = startAt;
    replacePaymentEvidence(input);
    const plan = planFullyPaidAllocationRepair(input);
    expect(plan.status).toBe("blocked");
    expect(plan.finalPrincipal, plan.blockers.join("; ")).toBe(residual);
    expect(plan.effects).toEqual([]);
  });

  it.each([
    ["rate change", (s: FullyPaidAllocationSnapshot) => s.rateChanges.push("changed")],
    ["waiver", (s: FullyPaidAllocationSnapshot) => s.waivers.push("waived")],
    ["reversal", (s: FullyPaidAllocationSnapshot) => s.reversals.push("reversed")],
    ["ambiguous journal", (s: FullyPaidAllocationSnapshot) => s.extraPaymentJournals.push("extra")],
    ["contradictory audit", (s: FullyPaidAllocationSnapshot) => s.auditProof.paymentCreates[0].amount = "7700001.00"],
    ["wrong journal amount", (s: FullyPaidAllocationSnapshot) => s.journalAllocations[0].interest = "1306666.66"],
    ["same-time payments", (s: FullyPaidAllocationSnapshot) => s.payments[1].effectiveAt = s.payments[0].effectiveAt],
    ["nonperpetual", (s: FullyPaidAllocationSnapshot) => s.loan.type = "fixed_rate"],
    ["missing complete audit", (s: FullyPaidAllocationSnapshot) => s.auditProof.complete = false],
    ["incomplete current ledger", (s: FullyPaidAllocationSnapshot) => s.currentLedgerComplete = false],
    ["missing source digest", (s: FullyPaidAllocationSnapshot) => { (s as { sourceDigest?: string }).sourceDigest = undefined; }],
    ["malformed source digest", (s: FullyPaidAllocationSnapshot) => s.sourceDigest = "not-a-sha256"],
    ["unaudited penalty term", (s: FullyPaidAllocationSnapshot) => s.loan.penaltyMultiplier = "0.2000"],
    ["unknown payment reference", (s: FullyPaidAllocationSnapshot) => s.originalJournalLegs[0].paymentId = "unknown"],
    ["wrong journal cash", (s: FullyPaidAllocationSnapshot) => s.originalJournalLegs[0].amount = "100.00"],
    ["wrong journal date", (s: FullyPaidAllocationSnapshot) => s.originalJournalLegs[0].effectiveAt = "2026-07-02T12:00:00.000Z"],
    ["missing journal completeness", (s: FullyPaidAllocationSnapshot) => s.journalsComplete = false],
    ["missing audit envelope", (s: FullyPaidAllocationSnapshot) => { (s as { auditProof?: unknown }).auditProof = undefined; }],
    ["missing journal row", (s: FullyPaidAllocationSnapshot) => { (s.journalAllocations as unknown[])[0] = null; }],
    ["wrong audit action", (s: FullyPaidAllocationSnapshot) => s.auditProof.paymentCreates[0].action = "payment.update"],
    ["audit with nonempty before value", (s: FullyPaidAllocationSnapshot) => s.auditProof.loanCreate.beforeNull = false],
    ["wrong account type", (s: FullyPaidAllocationSnapshot) => s.originalJournalLegs[1].accountType = "asset"],
    ["wrong journal category", (s: FullyPaidAllocationSnapshot) => s.originalJournalLegs[1].account = "Fee Earned"],
    ["wrong journal loan", (s: FullyPaidAllocationSnapshot) => s.originalJournalLegs[1].loanId = "other-loan"],
    ["wrong Cash location", (s: FullyPaidAllocationSnapshot) => s.originalJournalLegs[0].depositLocation = "bank"],
    ["wrong group attribution", (s: FullyPaidAllocationSnapshot) => s.originalJournalLegs[1].groupId = "wrong-group"],
    ["duplicate original leg", (s: FullyPaidAllocationSnapshot) => s.originalJournalLegs.push({ ...s.originalJournalLegs[0], id: "duplicate" })],
    ["missing original leg", (s: FullyPaidAllocationSnapshot) => s.originalJournalLegs.pop()],
  ])("fails closed on %s", (_name, mutate) => {
    const input = fixture(); mutate(input);
    expect(planFullyPaidAllocationRepair(input)).toMatchObject({ status: "blocked", effects: [] });
  });
});
