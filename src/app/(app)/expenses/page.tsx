import { Effect } from "effect"
import { listTransactions } from "@/services/transaction.service"
import { listCategories } from "@/services/category.service"
import { ExpenseListClient } from "./ExpenseListClient"

export default async function ExpensesPage() {
  const [transactionsResult, categoriesResult] = await Promise.all([
    Effect.runPromise(listTransactions({ type: "debit" }, 1, 50)),
    Effect.runPromise(listCategories("expense")),
  ])

  return (
    <div className="p-4 md:p-6 space-y-4">
      <ExpenseListClient
        transactions={transactionsResult.data}
        categories={categoriesResult}
      />
    </div>
  )
}
