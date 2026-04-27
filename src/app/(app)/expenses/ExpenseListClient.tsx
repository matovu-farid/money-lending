"use client"

import { TransactionListClient } from "@/components/transactions/transaction-list-client"
import type { TransactionRow, CategoryRow } from "@/types"

interface ExpenseListClientProps {
  transactions: TransactionRow[]
  categories: CategoryRow[]
}

export function ExpenseListClient({ transactions, categories }: ExpenseListClientProps) {
  return (
    <TransactionListClient
      transactions={transactions}
      categories={categories}
      variant="expense"
    />
  )
}
