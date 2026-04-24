"use client"

import { Suspense, useMemo } from "react"
import { useLiveSuspenseQuery } from "@tanstack/react-db"
import { incomeCollection, incomeCategoryCollection } from "@/collections"
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

  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <IncomeContent />
    </Suspense>
  )
}

function IncomeContent() {
  const { data: allIncome } = useLiveSuspenseQuery((q) =>
    q.from({ i: incomeCollection }).select(({ i }) => i)
  )

  const { data: rawCategories } = useLiveSuspenseQuery((q) =>
    q.from({ c: incomeCategoryCollection }).select(({ c }) => c)
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const categories = (rawCategories ?? []) as any[]

  // Resolve categoryName from the category collection (Electric shapes don\'t JOIN)
  const transactions: TransactionRow[] = useMemo(() => {
    const catMap = new Map<string, string>()
    for (const c of categories) {
      catMap.set(c.id, c.name)
    }
    return ((allIncome ?? []) as unknown as TransactionShapeRow[]).map((i) => ({
      id: i.id,
      type: i.type,
      amount: i.amount,
      categoryId: i.categoryId,
      categoryName: catMap.get(i.categoryId) ?? "Unknown",
      description: i.description,
      transactionDate: new Date(i.transactionDate),
      recordedBy: i.recordedBy,
      referenceType: i.referenceType,
      referenceId: i.referenceId,
      createdAt: new Date(i.createdAt),
    }))
  }, [allIncome, categories])

  return (
    <div className="p-4 md:p-6 space-y-4">
      <IncomeListClient
        transactions={transactions}
        categories={categories}
      />
    </div>
  )
}
