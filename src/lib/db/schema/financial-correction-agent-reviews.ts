import { sql } from "drizzle-orm"
import { check, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"

/** Operational agent attribution; never a synthetic user or human approval. */
export const financialCorrectionAgentReviews = pgTable("financial_correction_agent_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  subjectId: text("subject_id").notNull(),
  planHash: text("plan_hash").notNull(),
  inputFingerprint: text("input_fingerprint").notNull(),
  policyVersion: text("policy_version").notNull(),
  reviewerAgentId: text("reviewer_agent_id").notNull(),
  reviewRunId: text("review_run_id").notNull(),
  evidenceSha256: text("evidence_sha256").notNull(),
  evidenceJson: text("evidence_json").notNull(),
  verdict: text("verdict").notNull(),
  findingsJson: text("findings_json").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("uq_financial_correction_agent_review_plan").on(table.kind, table.planHash),
  check("financial_correction_agent_review_verdict", sql`${table.verdict} IN ('pass', 'fail')`),
  check("financial_correction_agent_review_identity", sql`
    length(${table.kind}) > 0 AND length(${table.subjectId}) > 0 AND
    length(${table.reviewerAgentId}) > 0 AND length(${table.reviewRunId}) > 0 AND
    length(${table.evidenceSha256}) = 64
  `),
])
