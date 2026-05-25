import { pgTable, uuid, numeric, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core"
import { loans } from "./loans"

export const rateRequestStatusEnum = pgEnum("rate_request_status", [
  "pending",
  "approved",
  "rejected",
])

export const rateChangeRequests = pgTable("rate_change_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  loanId: uuid("loan_id").notNull().references(() => loans.id, { onDelete: "cascade" }),
  requestedRate: numeric("requested_rate", { precision: 5, scale: 4 }).notNull(),
  currentRate: numeric("current_rate", { precision: 5, scale: 4 }).notNull(),
  requestedBy: text("requested_by").notNull(),
  requiredApproverRole: text("required_approver_role").notNull(),
  status: rateRequestStatusEnum("status").notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (table) => [
  index("idx_rate_change_requests_loan_id").on(table.loanId),
  index("idx_rate_change_requests_status").on(table.status),
])
