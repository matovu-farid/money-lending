import type { InferSelectModel, InferInsertModel } from "drizzle-orm"
import type { fundTransfers } from "@/lib/db/schema/fund-transfers"
import type { DepositLocation } from "./common"

export type FundTransfer = InferSelectModel<typeof fundTransfers>
export type NewFundTransfer = InferInsertModel<typeof fundTransfers>

export interface CreateFundTransferInput {
  fromLocation: DepositLocation
  toLocation: DepositLocation
  amount: string       // NUMERIC string
  note?: string
}

export interface CreateCapitalInjectionInput {
  toLocation: DepositLocation
  amount: string       // NUMERIC string
  note?: string
}
