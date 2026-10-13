import { sql } from "drizzle-orm"
import { check, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { loans } from "./loans"
import { financialCorrectionAgentReviews } from "./financial-correction-agent-reviews"

/** Agent-reviewed, cash-preserving reclassification of recorded payment splits. */
export const paymentAllocationRepairRuns = pgTable("payment_allocation_repair_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  loanId: uuid("loan_id").notNull().references(() => loans.id),
  planHash: text("plan_hash").notNull(),
  inputFingerprint: text("input_fingerprint").notNull(),
  policyVersion: text("policy_version").notNull(),
  agentReviewId: uuid("agent_review_id").notNull()
    .references(() => financialCorrectionAgentReviews.id),
  appliedByAgent: text("applied_by_agent").notNull(),
  backupSha256: text("backup_sha256").notNull(),
  beforeSummary: text("before_summary").notNull(),
  afterSummary: text("after_summary").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull(),
}, (table) => [
  unique("uq_payment_allocation_repair_plan_hash").on(table.planHash),
  check("payment_allocation_repair_attribution", sql`
    length(${table.appliedByAgent}) > 6 AND
    left(${table.appliedByAgent}, 6) = 'agent:' AND
    length(${table.backupSha256}) = 64
  `),
])
