"use client"

import { TransactionListClient } from "@/components/transactions/transaction-list-client"
import {
  recordIncomeAction,
  deleteIncomeAction,
  createIncomeCategoryAction,
} from "@/actions/income.actions"
import { queryKeys } from "@/hooks/query-keys"
import type { TransactionRow, CategoryRow } from "@/types"

interface IncomeListClientProps {
  transactions: TransactionRow[]
  categories: CategoryRow[]
}

export function IncomeListClient({ transactions, categories }: IncomeListClientProps) {
  return (
    <TransactionListClient
      transactions={transactions}
      categories={categories}
      variant="income"
      recordAction={recordIncomeAction}
      deleteAction={deleteIncomeAction}
      createCategoryAction={createIncomeCategoryAction}
      invalidateKeys={[queryKeys.income.all, queryKeys.dashboard.all]}
    />
  )
}
