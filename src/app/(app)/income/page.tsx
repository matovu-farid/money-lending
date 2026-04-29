"use client"

import { useMemo } from "react"
import { useLiveQuery, eq, and, isNull } from "@tanstack/react-db"
import { incomeCollection } from "@/collections/income"
import { incomeCategoryCollection } from "@/collections/income-categories"
import { IncomeListClient } from "./IncomeListClient"
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

export default function IncomePage() {
  const { has } = usePermissions()
  const canViewIncome = has("income:read")

  if (!canViewIncome) {
    return (
      <div className="p-4 md:p-6 flex flex-col items-center justify-center min-h-[40vh] text-center">
        <p className="text-lg font-medium text-muted-foreground">Access Denied</p>
        <p className="text-sm text-muted-foreground mt-1">
          Only supervisors and above can view and record income.
        </p>
      </div>
    )
  }

  return <IncomeContent />
}

function IncomeContent() {
  const { data: allIncome, isLoading: incomeLoading } = useLiveQuery((q) =>
    q
      .from({ i: incomeCollection })
      .where(({ i }) => and(eq(i.type, "credit"), isNull(i.referenceType)))
      .select(({ i }) => i)
  )

  const { data: rawCategories, isLoading: categoriesLoading } = useLiveQuery((q) =>
    q.from({ c: incomeCategoryCollection }).select(({ c }) => c)
  )

  const isInitialLoading =
    (incomeLoading && !allIncome) || (categoriesLoading && !rawCategories)
  const categories = useMemo(
    () => (rawCategories ?? []).map((r) => r.name),
    [rawCategories]
  )

  const transactions: TransactionRow[] = useMemo(() => {
    return ((allIncome ?? []) as unknown as TransactionShapeRow[]).map((i) => ({
      id: i.id,
      type: i.type,
      amount: i.amount,
      categoryId: i.categoryId,
      category: i.category ?? "Unknown",
      description: i.description,
      transactionDate: new Date(i.transactionDate),
      recordedBy: i.recordedBy,
      referenceType: i.referenceType,
      referenceId: i.referenceId,
      createdAt: new Date(i.createdAt),
    }))
  }, [allIncome])

  if (isInitialLoading) {
    return <LoadingSkeleton />
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <IncomeListClient
        transactions={transactions}
        categories={categories}
      />
    </div>
  )
}
