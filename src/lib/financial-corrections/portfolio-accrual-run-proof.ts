import BigNumber from "bignumber.js";
import type { InferSelectModel } from "drizzle-orm";
import { financialCorrectionAgentReviews } from "@/lib/db/schema/financial-correction-agent-reviews";
import { portfolioAccrualRepairRuns } from "@/lib/db/schema/portfolio-accrual-repair-runs";
import { hashReviewEvidence } from "./agent-review";

type Run = InferSelectModel<typeof portfolioAccrualRepairRuns>;
type Review = InferSelectModel<typeof financialCorrectionAgentReviews>;

export type PortfolioJournalRow = {
  id: string;
  loanId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  journalGroupId: string | null;
  transactionDate: Date;
  createdAt: Date;
  recordedBy: string;
  description: string | null;
  depositLocation: string | null;
  subLocationId: string | null;
  amount: string;
  type: "debit" | "credit";
  categoryName: string;
  categoryType: string;
};

const checkpointKeys = ["date", "period", "accrued", "settled",
  "existingReceivable", "delta", "resultingReceivable"] as const;
// Commit 8a7e29c unified posting clocks; earlier runs may have a bounded gap.
const clockFixUpperBound = new Date("2026-10-13T05:39:51.000Z");

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function parsedRecord(value: string): Record<string, unknown> | null {
  try { return record(JSON.parse(value)); } catch { return null; }
}

function iso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? value : null;
}

function checkpoint(value: unknown): string | null {
  const row = record(value);
  return row && checkpointKeys.every((key) => typeof row[key] === "string") &&
    iso(row.date) !== null
    ? JSON.stringify(checkpointKeys.map((key) => row[key])) : null;
}

function money(value: unknown): BigNumber | null {
  if (typeof value !== "string") return null;
  const amount = new BigNumber(value);
  return amount.isFinite() && (amount.decimalPlaces() ?? Infinity) <= 2
    ? amount : null;
}

type Signature = { date: string; amount: string; debit: string; credit: string };

function signatures(rows: Signature[]): string {
  return JSON.stringify(rows.map((row) => JSON.stringify(row)).sort());
}

/** Verify the complete dated journal and consumed independent review for one run. */
export function verifyPortfolioAccrualRunProof({ loanId, asOf, run, review, journalRows }: {
  loanId: string;
  asOf: Date;
  run: Run | null;
  review: Review | null;
  journalRows: PortfolioJournalRow[];
}): string[] {
  if (!run) return ["Portfolio accrual journal has no recorded run"];
  const exceptions: string[] = [];
  const before = parsedRecord(run.beforeSummary);
  const entries = Array.isArray(before?.entries) ? before.entries : null;
  const reviewEvidence = review ? parsedRecord(review.evidenceJson) : null;
  const checkpoints = Array.isArray(reviewEvidence?.checkpoints)
    ? reviewEvidence.checkpoints : null;
  const beforeAsOf = iso(before?.asOf);
  if (run.loanId !== loanId || !beforeAsOf || !entries?.length ||
      !checkpoints || checkpoints.length !== entries.length ||
      entries.some((entry, index) => !checkpoint(entry) ||
        checkpoint(entry) !== checkpoint(checkpoints[index]))) {
    exceptions.push(`Portfolio accrual run ${run.id} has invalid or unreviewed checkpoints`);
  }

  const expected: Signature[] = [];
  for (const value of entries ?? []) {
    const entry = record(value);
    const date = iso(entry?.date);
    const delta = money(entry?.delta);
    if (!checkpoint(entry) || !date || !delta || delta.isZero() ||
        new Date(date) > asOf) {
      exceptions.push(`Portfolio accrual run ${run.id} has an invalid dated entry`);
      continue;
    }
    expected.push({ date, amount: delta.abs().toFixed(2),
      debit: delta.gt(0) ? "Interest Receivable" : "Interest Earned",
      credit: delta.gt(0) ? "Interest Earned" : "Interest Receivable" });
  }

  let evidenceHash: string | null = null;
  if (reviewEvidence) {
    try { evidenceHash = hashReviewEvidence(reviewEvidence); } catch { /* Reject below. */ }
  }
  const appliedAt = run.appliedAt.getTime();
  const reviewedAt = review?.reviewedAt?.getTime();
  const consumedAt = review?.consumedAt?.getTime();
  const validReviewTiming = Number.isFinite(appliedAt) &&
    typeof reviewedAt === "number" && Number.isFinite(reviewedAt) &&
    reviewedAt <= appliedAt &&
    typeof consumedAt === "number" && Number.isFinite(consumedAt) &&
    (consumedAt === appliedAt ||
      (appliedAt < clockFixUpperBound.getTime() && consumedAt > appliedAt &&
        consumedAt - appliedAt <= 60_000));
  if (review && !validReviewTiming) {
    exceptions.push(`Portfolio accrual run ${run.id} has invalid review timing proof`);
  }
  if (!review || !run.agentReviewId || review.id !== run.agentReviewId ||
      !run.appliedByAgent?.startsWith("agent:") || run.appliedByAgent.trim() === "agent:" ||
      !review.reviewerAgentId.startsWith("agent:") ||
      review.reviewerAgentId.trim() === "agent:" ||
      !review.reviewRunId.trim() ||
      review.kind !== "portfolio_accrual" || review.subjectId !== loanId ||
      reviewEvidence?.loanId !== loanId || reviewEvidence.asOf !== beforeAsOf ||
      (reviewEvidence.sourceDigest !== undefined &&
        (typeof reviewEvidence.sourceDigest !== "string" ||
          !/^[a-f0-9]{64}$/.test(reviewEvidence.sourceDigest))) ||
      review.planHash !== run.planHash ||
      review.inputFingerprint !== run.inputFingerprint ||
      review.policyVersion !== run.policyVersion || review.verdict !== "pass" ||
      review.reviewerAgentId === run.appliedByAgent ||
      review.consumedByRunId !== run.id ||
      evidenceHash !== review.evidenceSha256) {
    exceptions.push(`Portfolio accrual run ${run.id} has no matching consumed review proof`);
  }

  const referencedRows = journalRows.filter((row) => row.referenceId === run.id);
  const groupIds = new Set(referencedRows.map((row) => row.journalGroupId));
  const actual: Signature[] = [];
  if (groupIds.has(null) || !referencedRows.length) {
    exceptions.push(`Portfolio accrual run ${run.id} has missing journal groups`);
  }
  for (const groupId of groupIds) {
    if (!groupId) continue;
    const rows = journalRows.filter((row) => row.journalGroupId === groupId);
    const debit = rows.find((row) => row.type === "debit");
    const credit = rows.find((row) => row.type === "credit");
    const amount = debit ? money(debit.amount) : null;
    if (rows.length !== 2 || !debit || !credit || !amount?.gt(0) ||
        !amount.eq(credit.amount) ||
        rows.some((row) => row.loanId !== loanId ||
          row.referenceType !== "portfolio_accrual_repair" ||
          row.referenceId !== run.id ||
          row.transactionDate.getTime() !== debit.transactionDate.getTime() ||
          row.transactionDate > asOf ||
          row.createdAt.getTime() !== run.appliedAt.getTime() ||
          row.recordedBy !== run.appliedByAgent ||
          row.description !== `Portfolio interest repair ${run.id}` ||
          row.depositLocation !== null || row.subLocationId !== null ||
          row.categoryType !== (row.categoryName === "Interest Receivable"
            ? "asset" : "revenue")) ||
        !["Interest Receivable", "Interest Earned"].includes(debit.categoryName) ||
        !["Interest Receivable", "Interest Earned"].includes(credit.categoryName) ||
        debit.categoryName === credit.categoryName) {
      exceptions.push(`Portfolio accrual group ${groupId} is unproved`);
      continue;
    }
    actual.push({ date: debit.transactionDate.toISOString(), amount: amount.toFixed(2),
      debit: debit.categoryName, credit: credit.categoryName });
  }
  if (expected.length !== entries?.length || signatures(actual) !== signatures(expected)) {
    exceptions.push(`Portfolio accrual run ${run.id} has no exact reviewed journal proof`);
  }
  return exceptions;
}
