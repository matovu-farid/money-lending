"use client"

import { Suspense, useMemo } from "react"
import { useLiveSuspenseQuery } from "@tanstack/react-db"
import { expenseCollection, expenseCategoryCollection } from "@/collections"
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

  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <ExpensesContent />
    </Suspense>
  )
}

function ExpensesContent() {
  const { data: allExpenses } = useLiveSuspenseQuery((q) =>
    q.from({ e: expenseCollection }).select(({ e }) => e)
  )

  const { data: rawCategories } = useLiveSuspenseQuery((q) =>
    q.from({ c: expenseCategoryCollection }).select(({ c }) => c)
  )
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
      categoryName: catMap.get(e.categoryId) ?? "Unknown",
      description: e.description,
      transactionDate: new Date(e.transactionDate),
      recordedBy: e.recordedBy,
      referenceType: e.referenceType,
      referenceId: e.referenceId,
      createdAt: new Date(e.createdAt),
    }))
  }, [allExpenses, categories])

  return (
    <div className="p-4 md:p-6 space-y-4">
      <ExpenseListClient
        transactions={transactions}
        categories={categories}
      />
    </div>
  )
}
