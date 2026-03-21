import { Effect } from "effect"
import { getBalanceSheetData } from "@/services/report.service"
import { generateBalanceSheetPdf } from "@/services/export/pdf.service"
import { generateBalanceSheetExcel } from "@/services/export/excel.service"

function getLastCompletedMonth(): string {
  const now = new Date()
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const format = searchParams.get("format") ?? "pdf"
  const period = searchParams.get("period") ?? getLastCompletedMonth()

  const data = await Effect.runPromise(getBalanceSheetData(period))

  if (format === "excel") {
    const buffer = await generateBalanceSheetExcel(data)
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="balance-sheet-${period}.xlsx"`,
      },
    })
  }

  const buffer = generateBalanceSheetPdf(data)
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="balance-sheet-${period}.pdf"`,
    },
  })
}
