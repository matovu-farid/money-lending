import { Effect } from "effect"
import { listTransactions } from "@/services/transaction.service"
import { listCategories } from "@/services/category.service"
import { IncomeListClient } from "./IncomeListClient"

export default async function IncomePage() {
  const [transactionsResult, categoriesResult] = await Promise.all([
    Effect.runPromise(listTransactions({ type: "credit" }, 1, 50)),
    Effect.runPromise(listCategories("income")),
  ])

  return (
    <div className="p-4 md:p-6 space-y-4">
      <IncomeListClient
        transactions={transactionsResult.data}
        categories={categoriesResult}
      />
    </div>
  )
}
