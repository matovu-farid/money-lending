import { Effect } from "effect"
import { listTransactions } from "@/services/transaction.service"
import { generateTransactionsPdf } from "@/services/export/pdf.service"
import { generateTransactionsExcel } from "@/services/export/excel.service"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const format = searchParams.get("format") ?? "pdf"

  const result = await Effect.runPromise(listTransactions({}, 1, 10000))
  const data = result.data

  // Build a category name map: categoryName -> categoryName (identity, since data already has categoryName)
  const categories = new Map<string, string>()
  for (const tx of data) {
    categories.set(tx.categoryName, tx.categoryName)
  }

  if (format === "excel") {
    const buffer = await generateTransactionsExcel(data, categories)
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="transaction-log.xlsx"`,
      },
    })
  }

  const buffer = generateTransactionsPdf(data, categories)
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="transaction-log.pdf"`,
    },
  })
}
