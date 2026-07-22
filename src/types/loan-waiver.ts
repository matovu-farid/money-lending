import type { InferSelectModel } from "drizzle-orm"
import type { loanWaivers } from "@/lib/db/schema/loan-waivers"

export interface WaiveLoanAmountInput {
  loanId: string
  amount: string
  reason: string
  /** Client-generated UUID so optimistic collection rows reconcile after persist. */
  id?: string
  // waiverDate: server-set at submit time (decision #6)
}

export type LoanWaiver = InferSelectModel<typeof loanWaivers>
