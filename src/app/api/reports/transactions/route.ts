import { Effect } from "effect"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { listTransactions } from "@/services/transaction.service"
import { generateTransactionsPdf } from "@/services/export/pdf.service"
import { generateTransactionsExcel } from "@/services/export/excel.service"

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const format = searchParams.get("format") ?? "pdf"

  try {
    const result = await Effect.runPromise(listTransactions({}, 1, 10000))
    const data = result.data

    const categories = new Map<string, string>()
    for (const tx of data) {
      categories.set(tx.categoryName, tx.categoryName)
    }

    if (format === "excel") {
      const buffer = await generateTransactionsExcel(data, categories)
      return new Response(new Blob([buffer]), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="transaction-log.xlsx"`,
        },
      })
    }

    const buffer = generateTransactionsPdf(data, categories)
    return new Response(new Blob([buffer]), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="transaction-log.pdf"`,
      },
    })
  } catch (error) {
    console.error("Transaction report generation failed:", error)
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 })
  }
}
