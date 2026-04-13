import type { InferSelectModel, InferInsertModel } from "drizzle-orm"
import type { rateChangeRequests } from "@/lib/db/schema/rate-change-requests"

export type RateChangeRequest = InferSelectModel<typeof rateChangeRequests>
export type NewRateChangeRequest = InferInsertModel<typeof rateChangeRequests>

export type RateChangeStatus = "pending" | "approved" | "rejected"

export interface CreateRateChangeRequestInput {
  loanId: string
  requestedRate: string  // decimal string e.g. "0.08" for 8%/month
}

export interface ReviewRateChangeRequestInput {
  requestId: string
  action: "approved" | "rejected"
  reviewNote?: string
}
