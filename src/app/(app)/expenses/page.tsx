"use client"

import { useQuery } from "@tanstack/react-query"
import { ExpenseListClient } from "./ExpenseListClient"
import { queryKeys } from "@/hooks/query-keys"
import { listExpenseTransactionsAction, listExpenseCategoriesAction } from "./actions"

export default function ExpensesPage() {
  const { data: transactionsResult, isLoading: transactionsLoading } = useQuery({
    queryKey: queryKeys.expenses.list({}, 1),
    queryFn: async () => {
      const result = await listExpenseTransactionsAction()
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
  })

  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: queryKeys.expenses.categories(),
    queryFn: async () => {
      const result = await listExpenseCategoriesAction()
      if ("error" in result) throw new Error(result.error)
      return result.data
    },
  })

  const isLoading = transactionsLoading || categoriesLoading

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <div className="h-8 w-48 rounded bg-muted-foreground/10 animate-pulse" />
        <div className="h-64 w-full rounded-lg bg-muted-foreground/10 animate-pulse" />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <ExpenseListClient
        transactions={transactionsResult?.data ?? []}
        categories={categories}
      />
    </div>
  )
}
