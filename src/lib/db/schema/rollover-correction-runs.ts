import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { loans } from "./loans";
import { user } from "./auth";

export const rolloverCorrectionRuns = pgTable("rollover_correction_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  chainRootId: uuid("chain_root_id").notNull().references(() => loans.id),
  planHash: text("plan_hash").notNull(),
  inputFingerprint: text("input_fingerprint").notNull(),
  policyVersion: text("policy_version").notNull(),
  reviewedBy: text("reviewed_by").notNull().references(() => user.id),
  beforeSummary: text("before_summary").notNull(),
  afterSummary: text("after_summary").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("uq_rollover_correction_plan_hash").on(table.planHash),
]);

/** Approval binds one immutable dry-run fingerprint to an identified reviewer. */
export const rolloverCorrectionApprovals = pgTable("rollover_correction_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  chainRootId: uuid("chain_root_id").notNull().references(() => loans.id),
  planHash: text("plan_hash").notNull(),
  inputFingerprint: text("input_fingerprint").notNull(),
  policyVersion: text("policy_version").notNull(),
  approvedBy: text("approved_by").notNull().references(() => user.id),
  reviewNote: text("review_note").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("uq_rollover_correction_approval_plan_hash").on(table.planHash),
]);
