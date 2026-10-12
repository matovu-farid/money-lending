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
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  consumedByRunId: uuid("consumed_by_run_id"),
}, (table) => [
  unique("uq_financial_correction_agent_review_attempt")
    .on(table.kind, table.planHash, table.reviewRunId),
  check("financial_correction_agent_review_verdict", sql`${table.verdict} IN ('pass', 'fail')`),
  check("financial_correction_agent_review_identity", sql`
    length(${table.kind}) > 0 AND length(${table.subjectId}) > 0 AND
    length(${table.reviewerAgentId}) > 0 AND length(${table.reviewRunId}) > 0 AND
    length(${table.evidenceSha256}) = 64
  `),
  check("financial_correction_agent_review_consumption", sql`
    (${table.consumedAt} IS NULL AND ${table.consumedByRunId} IS NULL) OR
    (${table.consumedAt} IS NOT NULL AND ${table.consumedByRunId} IS NOT NULL AND
      ${table.verdict} = 'pass')
  `),
])
