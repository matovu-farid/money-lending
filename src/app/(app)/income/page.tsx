"use client"

import { Suspense } from "react"
import { useLiveSuspenseQuery } from "@tanstack/react-db"
import { incomeCollection, incomeCategoryCollection } from "@/collections"
import { IncomeListClient } from "./IncomeListClient"
import { usePermissions } from "@/hooks/use-permissions"

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

  return (
    <div className="p-4 md:p-6 space-y-4">
      <IncomeListClient
        transactions={allIncome ?? []}
        categories={categories}
      />
    </div>
  )
}
