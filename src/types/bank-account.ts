import type { InferSelectModel } from "drizzle-orm"
import type { bankAccounts } from "@/lib/db/schema/bank-accounts"

export type BankAccount = InferSelectModel<typeof bankAccounts>

export interface CreateBankAccountInput {
  id?: string
  name: string
}

export interface UpdateBankAccountInput {
  id: string
  name?: string
  isActive?: boolean
}
