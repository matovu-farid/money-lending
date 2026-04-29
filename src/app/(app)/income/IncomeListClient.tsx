"use client"

import { TransactionListClient } from "@/components/transactions/transaction-list-client"
import type { TransactionRow } from "@/types"

interface IncomeListClientProps {
  transactions: TransactionRow[]
  categories: string[]
}

export function IncomeListClient({ transactions, categories }: IncomeListClientProps) {
  return (
    <TransactionListClient
      transactions={transactions}
      categories={categories}
      variant="income"
    />
  )
}
