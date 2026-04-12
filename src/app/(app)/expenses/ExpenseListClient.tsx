"use client"

import { TransactionListClient } from "@/components/transactions/transaction-list-client"
import {
  recordExpenseAction,
  deleteExpenseAction,
  createExpenseCategoryAction,
} from "@/actions/expense.actions"
import { queryKeys } from "@/hooks/query-keys"
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
      recordAction={recordExpenseAction}
      deleteAction={deleteExpenseAction}
      createCategoryAction={createExpenseCategoryAction}
      invalidateKeys={[queryKeys.expenses.all, queryKeys.dashboard.all]}
    />
  )
}
