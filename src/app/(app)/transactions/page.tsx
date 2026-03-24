import { Effect } from "effect"
import { listTransactions } from "@/services/transaction.service"
import { listCategories } from "@/services/category.service"
import { TransactionLogClient } from "./TransactionLogClient"
import type { TransactionLogFilters } from "@/types"

// Transaction Log page — shows all debit/credit entries with filtering
// No transactions yet — empty state shown by TransactionLogClient
interface TransactionLogPageProps {
  searchParams: Promise<{
    type?: string
    categoryId?: string
    dateFrom?: string
    dateTo?: string
    page?: string
  }>
}

export default async function TransactionLogPage({ searchParams }: TransactionLogPageProps) {
  const params = await searchParams
  const page = Number(params.page ?? 1)
  const pageSize = 50

  const filters: TransactionLogFilters = {}
  if (params.type === "credit" || params.type === "debit") {
    filters.type = params.type
  }
  if (params.categoryId) {
    filters.categoryId = params.categoryId
  }
  if (params.dateFrom) {
    filters.dateFrom = params.dateFrom
  }
  if (params.dateTo) {
    filters.dateTo = params.dateTo
  }

  const [transactionsResult, categoriesResult] = await Promise.all([
    Effect.runPromise(listTransactions(filters, page, pageSize)),
    Effect.runPromise(listCategories()),
  ])

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">Complete transaction history</p>
        </div>
        <div className="flex gap-2">
          <a
            href="/api/reports/transactions?format=pdf"
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-input bg-transparent px-3 text-sm hover:bg-accent"
          >
            Export PDF
          </a>
          <a
            href="/api/reports/transactions?format=excel"
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-input bg-transparent px-3 text-sm hover:bg-accent"
          >
            Export Excel
          </a>
        </div>
      </div>
      <TransactionLogClient
        transactions={transactionsResult.data}
        total={transactionsResult.total}
        categories={categoriesResult}
        page={page}
        pageSize={pageSize}
        filters={filters}
      />
    </div>
  )
}
