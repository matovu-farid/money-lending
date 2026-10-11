import { sql } from "drizzle-orm";
import { check, pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { loans } from "./loans";
import { user } from "./auth";
import { financialCorrectionAgentReviews } from "./financial-correction-agent-reviews";

export const historicalRateRepairApprovals = pgTable("historical_rate_repair_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  loanId: uuid("loan_id").notNull().references(() => loans.id),
  planHash: text("plan_hash").notNull(),
  inputFingerprint: text("input_fingerprint").notNull(),
  policyVersion: text("policy_version").notNull(),
  approvedBy: text("approved_by").notNull().references(() => user.id),
  reviewNote: text("review_note").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("uq_historical_rate_repair_approval_plan_hash").on(table.planHash),
]);

export const historicalRateRepairRuns = pgTable("historical_rate_repair_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  loanId: uuid("loan_id").notNull().references(() => loans.id),
  planHash: text("plan_hash").notNull(),
  inputFingerprint: text("input_fingerprint").notNull(),
  policyVersion: text("policy_version").notNull(),
  reviewedBy: text("reviewed_by").references(() => user.id),
  agentReviewId: uuid("agent_review_id").references(() => financialCorrectionAgentReviews.id),
  appliedByAgent: text("applied_by_agent"),
  backupSha256: text("backup_sha256").notNull(),
  beforeSummary: text("before_summary").notNull(),
  afterSummary: text("after_summary").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("uq_historical_rate_repair_run_plan_hash").on(table.planHash),
  check("historical_rate_run_attribution", sql`
    (${table.reviewedBy} IS NOT NULL AND ${table.agentReviewId} IS NULL AND
      ${table.appliedByAgent} IS NULL) OR
    (${table.reviewedBy} IS NULL AND ${table.agentReviewId} IS NOT NULL AND
      length(${table.appliedByAgent}) > 0)
  `),
]);
