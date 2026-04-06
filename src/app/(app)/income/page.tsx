import { Effect, Exit } from "effect"
import { listTransactions } from "@/services/transaction.service"
import { listCategories } from "@/services/category.service"
import { IncomeListClient } from "./IncomeListClient"

export default async function IncomePage() {
  const [transactionsExit, categoriesExit] = await Promise.all([
    Effect.runPromiseExit(listTransactions({ type: "credit" }, 1, 50)),
    Effect.runPromiseExit(listCategories("income")),
  ])

  const transactionsResult = Exit.isSuccess(transactionsExit)
    ? transactionsExit.value
    : { data: [], total: 0 }
  const categories = Exit.isSuccess(categoriesExit)
    ? categoriesExit.value
    : []

  return (
    <div className="p-4 md:p-6 space-y-4">
      <IncomeListClient
        transactions={transactionsResult.data}
        categories={categories}
      />
    </div>
  )
}
