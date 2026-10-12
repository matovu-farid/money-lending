import { createHash } from "node:crypto";
import BigNumber from "bignumber.js";
import { buildLoanStatement, type BuildStatementInput } from "@/lib/loan-statement";
import { quoteRolloverCarry } from "./rollover-carry";

/** Changed penalty-cure statement semantics invalidate prior correction plans. */
export const ROLLOVER_CORRECTION_POLICY_VERSION = "v4";

export type ChainLoan = BuildStatementInput["loan"] & {
  rolledOverFrom: string | null;
  rolloverAmount: string | null;
  status: string;
  deletedAt: Date | null;
  disbursementSource?: string;
  subLocationId?: string | null;
  payments: Array<BuildStatementInput["payments"][number] & {
    id: string; overpaymentPortion?: string;
  }>;
  waivers: Array<NonNullable<BuildStatementInput["waivers"]>[number] & { id?: string }>;
  rateChanges: NonNullable<BuildStatementInput["rateChanges"]>;
  /** Present only after the source ledger and settlement allocations were checked. */
  sourceExceptions?: string[];
  sourceDigest?: string;
};

export type ChainSnapshot = { loans: ChainLoan[] };

export type SettlementChange = {
  id: string;
  loanId: string;
  kind: "payment" | "waiver";
  date: Date;
  amount: string;
  oldInterest: string;
  oldPrincipal: string;
  oldOverpayment: string;
  newInterest: string;
  newPrincipal: string;
  newOverpayment: string;
};

export type CorrectionEdge = {
  predecessorId: string;
  successorId: string;
  originalPrincipal: string;
  originalRolloverAmount: string;
  freshCash: string;
  carriedPrincipal: string | null;
  carriedInterest: string | null;
  proposedPrincipal: string;
  proposedRolloverAmount: string;
  deltaPrincipal: string;
  settlementChanges: SettlementChange[];
  classification: "ready" | "review" | "blocked";
  exceptions: string[];
};

export type CorrectionPlan = {
  policyVersion: string;
  inputFingerprint: string;
  planHash: string;
  classification: "ready" | "review" | "blocked";
  exceptions: string[];
  edges: CorrectionEdge[];
  settlementChanges: SettlementChange[];
};

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function replaySettlements(loan: ChainLoan, principal: string, before?: Date): {
  payments: ChainLoan["payments"];
  waivers: ChainLoan["waivers"];
  changes: SettlementChange[];
  exceptions: string[];
} {
  const payments: ChainLoan["payments"] = [];
  const waivers: ChainLoan["waivers"] = [];
  const changes: SettlementChange[] = [];
  const exceptions: string[] = [];
  const settlements = [
    ...loan.payments.map((event) => ({ kind: "payment" as const, date: event.paymentDate, event })),
    ...loan.waivers.map((event) => ({ kind: "waiver" as const, date: event.waiverDate, event })),
  ].filter((event) => !before || event.date < before)
    .sort((a, b) => a.date.getTime() - b.date.getTime() ||
      a.kind.localeCompare(b.kind) || (a.event.id ?? "").localeCompare(b.event.id ?? ""));

  for (let i = 0; i < settlements.length; i++) {
    const { kind, date, event } = settlements[i];
    if (!event.id || date <= loan.startDate ||
        (i > 0 && settlements[i - 1].date.getTime() === date.getTime())) {
      exceptions.push(`Settlement ${event.id ?? "unknown"} dated ${date.toISOString().slice(0, 10)} ` +
        `has an ambiguous date or identity (loan start ${loan.startDate.toISOString().slice(0, 10)})`);
      continue;
    }
    const loanAtDate = {
      ...loan,
      principalAmount: principal,
      interestRate: loan.rateChanges[0]?.fromRate ?? loan.interestRate,
      interestRateOverride: loan.rateChanges.length ? null : loan.interestRateOverride,
      penaltyWaived: loan.penaltyWaived && !!loan.penaltyWaivedAt && loan.penaltyWaivedAt <= date,
      penaltyWaivedAt: loan.penaltyWaivedAt && loan.penaltyWaivedAt <= date ? loan.penaltyWaivedAt : null,
    };
    const state = buildLoanStatement({
      loan: loanAtDate,
      payments,
      waivers,
      rateChanges: loan.rateChanges.filter((rate) => rate.effectiveDate <= date),
      today: date,
    }).finalState;
    const amount = new BigNumber(event.amount);
    const interest = BigNumber.min(amount, new BigNumber(state.netUnpaidInterest));
    const principalPart = BigNumber.min(amount.minus(interest),
      new BigNumber(state.principalBalance));
    const overpayment = kind === "payment"
      ? amount.minus(interest).minus(principalPart) : new BigNumber(0);
    if (!amount.isFinite() || amount.lt(0) ||
        amount.minus(interest).minus(principalPart).minus(overpayment).abs().gte(0.01)) {
      exceptions.push(`Settlement ${event.id} exceeds corrected amount due`);
      continue;
    }
    const change: SettlementChange = {
      id: event.id,
      loanId: loan.id,
      kind,
      date,
      amount: amount.toFixed(2),
      oldInterest: event.interestPortion,
      oldPrincipal: event.principalPortion,
      oldOverpayment: kind === "payment" ? event.overpaymentPortion ?? "0" : "0",
      newInterest: interest.toFixed(2),
      newPrincipal: principalPart.toFixed(2),
      newOverpayment: overpayment.toFixed(2),
    };
    changes.push(change);
    if (kind === "payment") {
      payments.push({ ...event, interestPortion: change.newInterest,
        principalPortion: change.newPrincipal,
        overpaymentPortion: change.newOverpayment });
    } else {
      waivers.push({ ...event, interestPortion: change.newInterest,
        principalPortion: change.newPrincipal });
    }
  }
  return { payments, waivers, changes, exceptions };
}

/** Pure, chronological dry-run. No database reads or writes. */
export function planRolloverCorrection(
  snapshot: ChainSnapshot,
  policyVersion: string,
): CorrectionPlan {
  const ordered = snapshot.loans.map((loan) => ({
    ...loan,
    payments: [...loan.payments].sort((a, b) =>
      a.paymentDate.getTime() - b.paymentDate.getTime() || a.id.localeCompare(b.id)),
    waivers: [...loan.waivers].sort((a, b) =>
      a.waiverDate.getTime() - b.waiverDate.getTime() ||
      (a.id ?? "").localeCompare(b.id ?? "")),
    rateChanges: [...loan.rateChanges].sort((a, b) =>
      a.effectiveDate.getTime() - b.effectiveDate.getTime() ||
      a.fromRate.localeCompare(b.fromRate) || a.toRate.localeCompare(b.toRate)),
    sourceExceptions: loan.sourceExceptions?.toSorted(),
  })).sort((a, b) =>
    a.startDate.getTime() - b.startDate.getTime() || a.id.localeCompare(b.id),
  );
  const inputFingerprint = fingerprint({ policyVersion, loans: ordered });
  const byId = new Map(ordered.map((loan) => [loan.id, loan]));
  const proposedById = new Map<string, string>();
  const exceptions: string[] = [];
  const edges: CorrectionEdge[] = [];
  const allSettlementChanges: SettlementChange[] = [];

  if (byId.size !== ordered.length) exceptions.push("Duplicate loan ID in chain snapshot");
  if (ordered.length && ordered.filter((loan) => !loan.rolledOverFrom).length !== 1) {
    exceptions.push("Chain must have exactly one root loan");
  }
  const successorCounts = new Map<string, number>();
  for (const loan of ordered) {
    if (!loan.rolledOverFrom) continue;
    successorCounts.set(loan.rolledOverFrom,
      (successorCounts.get(loan.rolledOverFrom) ?? 0) + 1);
  }
  if ([...successorCounts.values()].some((count) => count > 1)) {
    exceptions.push("A predecessor has multiple successors; chain is not a single path");
  }
  for (const loan of ordered) {
    if (!loan.rolledOverFrom) continue;
    const predecessor = byId.get(loan.rolledOverFrom);
    const edgeExceptions: string[] = [];
    if (!predecessor?.sourceExceptions || !loan.sourceExceptions ||
        !predecessor.sourceDigest || !loan.sourceDigest) {
      edgeExceptions.push("Source ledger has not been reconciled");
    } else {
      edgeExceptions.push(...predecessor.sourceExceptions, ...loan.sourceExceptions);
    }
    const originalRolloverAmount = loan.rolloverAmount ?? "0";
    const freshCash = new BigNumber(loan.principalAmount)
      .minus(originalRolloverAmount).toFixed(0);
    let carriedPrincipal: string | null = null;
    let carriedInterest: string | null = null;
    let proposedPrincipal = loan.principalAmount;
    let proposedRolloverAmount = originalRolloverAmount;
    let settlementChanges: SettlementChange[] = [];

    if (!predecessor) edgeExceptions.push("Missing predecessor loan");
    if (predecessor && predecessor.startDate >= loan.startDate) {
      edgeExceptions.push(`Successor effective date ${loan.startDate.toISOString().slice(0, 10)} ` +
        `must follow predecessor start ${predecessor.startDate.toISOString().slice(0, 10)}`);
    }
    if (predecessor && predecessor.loanType !== "perpetual") {
      edgeExceptions.push("Scheduled predecessor loan requires amortization review");
    }
    if (predecessor?.rateChanges.some((rate, index) => index > 0 &&
        predecessor.rateChanges[index - 1].effectiveDate.getTime() ===
          rate.effectiveDate.getTime())) {
      edgeExceptions.push("Predecessor has ambiguous same-date rate changes");
    }
    if (predecessor?.penaltyWaivedAt && predecessor.penaltyWaivedAt >= loan.startDate) {
      edgeExceptions.push("Predecessor penalty waiver on or after successor effective date");
    }
    if (loan.deletedAt || predecessor?.deletedAt) {
      edgeExceptions.push("Deleted loan in rollover chain; audit only");
    }
    if (new BigNumber(freshCash).lt(0)) {
      edgeExceptions.push("Stored rollover amount exceeds successor principal");
    }
    if (predecessor && !edgeExceptions.length) {
      const correctedPredecessor = {
        ...predecessor,
        principalAmount: proposedById.get(predecessor.id) ?? predecessor.principalAmount,
        interestRate: predecessor.rateChanges[0]?.fromRate ?? predecessor.interestRate,
        interestRateOverride: predecessor.rateChanges.length ? null : predecessor.interestRateOverride,
      };
      for (const payment of predecessor.payments.filter((p) => p.paymentDate >= loan.startDate)) {
        edgeExceptions.push(`Predecessor payment ${payment.id} amount ${payment.amount} dated ` +
          `${payment.paymentDate.toISOString().slice(0, 10)} on or after successor effective ` +
          `${loan.startDate.toISOString().slice(0, 10)} needs attribution review`);
      }
      for (const waiver of predecessor.waivers.filter((w) => w.waiverDate >= loan.startDate)) {
        edgeExceptions.push(`Predecessor waiver ${waiver.id ?? "unknown"} amount ${waiver.amount} dated ` +
          `${waiver.waiverDate.toISOString().slice(0, 10)} on or after successor effective ` +
          `${loan.startDate.toISOString().slice(0, 10)} needs attribution review`);
      }
      for (const change of predecessor.rateChanges.filter((r) => r.effectiveDate >= loan.startDate)) {
        edgeExceptions.push(`Predecessor rate change dated ` +
          `${change.effectiveDate.toISOString().slice(0, 10)} on or after successor effective ` +
          `${loan.startDate.toISOString().slice(0, 10)}`);
      }
      if (!edgeExceptions.length) {
        const replay = replaySettlements(correctedPredecessor,
          correctedPredecessor.principalAmount, loan.startDate);
        edgeExceptions.push(...replay.exceptions);
        settlementChanges = replay.changes;
        allSettlementChanges.push(...replay.changes);
        if (!edgeExceptions.length) {
        const carry = quoteRolloverCarry({
          loan: correctedPredecessor,
          asOf: loan.startDate,
          payments: replay.payments,
          waivers: replay.waivers,
          rateChanges: correctedPredecessor.rateChanges,
        });
        carriedPrincipal = carry.carriedPrincipal;
        carriedInterest = carry.carriedInterest;
        proposedRolloverAmount = new BigNumber(carriedPrincipal)
          .plus(carriedInterest).toFixed(0);
        proposedPrincipal = new BigNumber(freshCash)
          .plus(proposedRolloverAmount).toFixed(0);
        }
      }
    }

    const needsReview = !!(
      predecessor?.payments.length || predecessor?.waivers.length ||
      predecessor?.rateChanges.length ||
      loan.payments.length || loan.waivers.length || loan.rateChanges.length ||
      ["fully_paid", "settled_with_collateral"].includes(loan.status)
    );
    const classification = edgeExceptions.length ? "blocked" : needsReview ? "review" : "ready";
    if (needsReview && !edgeExceptions.length) {
      exceptions.push(`Loan ${loan.id}: settlement or closure requires allocation and ledger review`);
    }
    exceptions.push(...edgeExceptions.map((reason) => `Loan ${loan.id}: ${reason}`));
    proposedById.set(loan.id, proposedPrincipal);
    edges.push({
      predecessorId: loan.rolledOverFrom,
      successorId: loan.id,
      originalPrincipal: loan.principalAmount,
      originalRolloverAmount,
      freshCash,
      carriedPrincipal,
      carriedInterest,
      proposedPrincipal,
      proposedRolloverAmount,
      deltaPrincipal: new BigNumber(proposedPrincipal).minus(loan.principalAmount).toFixed(0),
      settlementChanges,
      classification,
      exceptions: edgeExceptions,
    });
  }
  const last = ordered.find((loan) => !edges.some((edge) => edge.predecessorId === loan.id));
  if (last?.rolledOverFrom && !last.sourceExceptions?.length) {
    const replay = replaySettlements(last, proposedById.get(last.id) ?? last.principalAmount);
    allSettlementChanges.push(...replay.changes);
    exceptions.push(...replay.exceptions.map((reason) => `Loan ${last.id}: ${reason}`));
  }
  if (last && ["fully_paid", "settled_with_collateral"].includes(last.status)) {
    const principalRemaining = new BigNumber(proposedById.get(last.id) ?? last.principalAmount)
      .minus(allSettlementChanges.filter((change) => change.loanId === last.id)
        .reduce((sum, change) => sum.plus(change.newPrincipal), new BigNumber(0)));
    if (principalRemaining.abs().gte(1)) {
      exceptions.push(`Loan ${last.id}: Closed successor has unresolved corrected principal ` +
        `${principalRemaining.toFixed(0)}`);
    }
  }
  const classification = exceptions.some((reason) =>
    !reason.includes("requires allocation and ledger review"),
  ) ? "blocked" : edges.some((edge) => edge.classification === "review") ? "review" : "ready";
  return {
    policyVersion,
    inputFingerprint,
    planHash: fingerprint({ policyVersion, inputFingerprint, edges, allSettlementChanges }),
    classification,
    exceptions,
    edges,
    settlementChanges: allSettlementChanges,
  };
}
