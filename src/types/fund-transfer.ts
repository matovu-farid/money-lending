import type { InferSelectModel, InferInsertModel } from "drizzle-orm"
import type { fundTransfers } from "@/lib/db/schema/fund-transfers"
import type { DepositLocation } from "./common"

export type FundTransfer = InferSelectModel<typeof fundTransfers>
export type NewFundTransfer = InferInsertModel<typeof fundTransfers>

export interface CreateFundTransferInput {
  id?: string
  fromLocation: DepositLocation
  toLocation: DepositLocation
  fromSubLocationId?: string
  toSubLocationId?: string
  amount: string       // NUMERIC string
  note?: string
  transferredAt?: string
  backdateNote?: string
}

export interface CreateCapitalInjectionInput {
  id?: string
  toLocation: DepositLocation
  toSubLocationId?: string
  amount: string       // NUMERIC string
  note?: string
  transferredAt?: string
  backdateNote?: string
}
