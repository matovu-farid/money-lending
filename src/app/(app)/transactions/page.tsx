import { Effect, Exit } from "effect"
import { redirect } from "next/navigation"
import { listTransactions } from "@/services/transaction.service"
import { listCategories } from "@/services/category.service"
import { TransactionLogClient } from "./TransactionLogClient"
import { PageHeader } from "@/components/ui/page-header"
import { getSession, getUserRole, getEffectivePermissions } from "@/lib/action-utils"
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
  const session = await getSession()
  if (!session) redirect("/login")
  const role = getUserRole(session)
  const perms = await getEffectivePermissions(session.user.id, role)
  if (!perms.has("reports:financial")) redirect("/reports")

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
      <PageHeader title="Transactions" subtitle="Complete transaction history" />
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
