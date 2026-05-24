"use client"

import { useMemo } from "react"
import { useLiveQuery, eq, and, isNull } from "@tanstack/react-db"
import { expenseCollection } from "@/collections/expenses"
import { expenseCategoryCollection } from "@/collections/expense-categories"
import { ExpenseListClient } from "./ExpenseListClient"
import { usePermissions } from "@/hooks/use-permissions"
import type { TransactionRow } from "@/types"

function LoadingSkeleton() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="h-8 w-48 rounded bg-muted-foreground/10 animate-pulse" />
      <div className="h-64 w-full rounded-lg bg-muted-foreground/10 animate-pulse" />
    </div>
  )
}

export default function ExpensesPage() {
  const { has } = usePermissions()
  const canViewExpenses = has("expense:read")

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

  return <ExpensesContent />
}

function ExpensesContent() {
  const { data: allExpenses, isLoading: expensesLoading } = useLiveQuery((q) =>
    q
      .from({ e: expenseCollection })
      .where(({ e }) => and(eq(e.type, "debit"), isNull(e.referenceType)))
      .select(({ e }) => e)
  )

  const { data: rawCategories, isLoading: categoriesLoading } = useLiveQuery((q) =>
    q.from({ c: expenseCategoryCollection }).select(({ c }) => c)
  )

  const isInitialLoading =
    (expensesLoading && !allExpenses) || (categoriesLoading && !rawCategories)
  const categories = useMemo(
    () => (rawCategories ?? []).map((r) => r.name),
    [rawCategories]
  )

  const transactions: TransactionRow[] = useMemo(() => {
    return (allExpenses ?? []).map((e) => ({
      id: e.id,
      type: e.type,
      amount: e.amount,
      categoryId: e.categoryId,
      category: e.category ?? "Unknown",
      description: e.description,
      transactionDate: new Date(e.transactionDate),
      recordedBy: e.recordedBy,
      referenceType: e.referenceType,
      referenceId: e.referenceId,
      createdAt: new Date(e.createdAt),
    }))
  }, [allExpenses])

  if (isInitialLoading) {
    return <LoadingSkeleton />
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <ExpenseListClient
        transactions={transactions}
        categories={categories}
      />
    </div>
  )
}
