"use client"

import { useMemo } from "react"
import { useLiveQuery, eq, and, isNull } from "@tanstack/react-db"
import { expenseCollection, getRecentExpenseCategoryName } from "@/collections/expenses"
import { expenseCategoryCollection } from "@/collections/expense-categories"
import { ExpenseListClient } from "./ExpenseListClient"
import { usePermissions } from "@/hooks/use-permissions"
import type { TransactionRow, TransactionShapeRow } from "@/types"

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
    q
      .from({ c: expenseCategoryCollection })
      .where(({ c }) => eq(c.type, "expense"))
      .select(({ c }) => c)
  )

  const isInitialLoading =
    (expensesLoading && !allExpenses) || (categoriesLoading && !rawCategories)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const categories = (rawCategories ?? []) as any[]

  // Resolve categoryName from the category collection (Electric shapes don\'t JOIN)
  const transactions: TransactionRow[] = useMemo(() => {
    const catMap = new Map<string, string>()
    for (const c of categories) {
      catMap.set(c.id, c.name)
    }
    return ((allExpenses ?? []) as unknown as TransactionShapeRow[]).map((e) => ({
      id: e.id,
      type: e.type,
      amount: e.amount,
      categoryId: e.categoryId,
      categoryName:
        catMap.get(e.categoryId)
        ?? getRecentExpenseCategoryName(e.categoryId)
        ?? e.categoryName
        ?? "Unknown",
      description: e.description,
      transactionDate: new Date(e.transactionDate),
      recordedBy: e.recordedBy,
      referenceType: e.referenceType,
      referenceId: e.referenceId,
      createdAt: new Date(e.createdAt),
    }))
  }, [allExpenses, categories])

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
