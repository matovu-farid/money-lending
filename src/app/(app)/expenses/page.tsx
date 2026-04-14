"use client"

import { useLiveQuery } from "@tanstack/react-db"
import { expenseCollection, expenseCategoryCollection } from "@/collections"
import { ExpenseListClient } from "./ExpenseListClient"
import { usePermissions } from "@/hooks/use-permissions"

export default function ExpensesPage() {
  const { has } = usePermissions()
  const canViewExpenses = has("expense:read")

  const { data: allExpenses, isLoading: transactionsLoading } = useLiveQuery((q) =>
    q.from({ e: expenseCollection }).select(({ e }) => e)
  )

  const { data: rawCategories, isLoading: categoriesLoading } = useLiveQuery((q) =>
    q.from({ c: expenseCategoryCollection }).select(({ c }) => c)
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const categories = (rawCategories ?? []) as any[]

  if (!canViewExpenses) {
    return (
      <div className="p-4 md:p-6 flex flex-col items-center justify-center min-h-[40vh] text-center">
        <p className="text-lg font-medium text-muted-foreground">Access Denied</p>
        <p className="text-sm text-muted-foreground mt-1">
          Only supervisors and above can view and record expenses.
        </p>
      </div>
    )
  }

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
        transactions={allExpenses ?? []}
        categories={categories}
      />
    </div>
  )
}
