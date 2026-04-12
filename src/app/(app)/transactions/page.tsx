import { Effect, Exit } from "effect"
import { listTransactions } from "@/services/transaction.service"
import { listCategories } from "@/services/category.service"
import { TransactionLogClient } from "./TransactionLogClient"
import { buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
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

  const [transactionsExit, categoriesExit] = await Promise.all([
    Effect.runPromiseExit(listTransactions(filters, page, pageSize)),
    Effect.runPromiseExit(listCategories()),
  ])

  const transactionsResult = Exit.isSuccess(transactionsExit)
    ? transactionsExit.value
    : { data: [], total: 0 }
  const categories = Exit.isSuccess(categoriesExit)
    ? categoriesExit.value
    : []

  return (
    <div className="p-4 md:p-6 space-y-4">
      <PageHeader title="Transactions" subtitle="Complete transaction history">
        <div className="flex gap-2">
          <a href="/api/reports/transactions?format=pdf" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Export PDF
          </a>
          <a href="/api/reports/transactions?format=excel" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Export Excel
          </a>
        </div>
      </PageHeader>
      <TransactionLogClient
        transactions={transactionsResult.data}
        total={transactionsResult.total}
        categories={categories}
        page={page}
        pageSize={pageSize}
      />
    </div>
  )
}
