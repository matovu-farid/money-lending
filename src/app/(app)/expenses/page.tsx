import { Effect, Exit } from "effect"
import { listTransactions } from "@/services/transaction.service"
import { listCategories } from "@/services/category.service"
import { ExpenseListClient } from "./ExpenseListClient"

export default async function ExpensesPage() {
  const [transactionsExit, categoriesExit] = await Promise.all([
    Effect.runPromiseExit(listTransactions({ type: "debit" }, 1, 50)),
    Effect.runPromiseExit(listCategories("expense")),
  ])

  const transactionsResult = Exit.isSuccess(transactionsExit)
    ? transactionsExit.value
    : { data: [], total: 0 }
  const categories = Exit.isSuccess(categoriesExit)
    ? categoriesExit.value
    : []

  return (
    <div className="p-4 md:p-6 space-y-4">
      <ExpenseListClient
        transactions={transactionsResult.data}
        categories={categories}
      />
    </div>
  )
}
