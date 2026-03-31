import { Effect } from "effect"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { getPnlData } from "@/services/report.service"
import { generatePnlPdf } from "@/services/export/pdf.service"
import { generatePnlExcel } from "@/services/export/excel.service"

function getLastCompletedMonth(): string {
  const now = new Date()
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const format = searchParams.get("format") ?? "pdf"
  const period = searchParams.get("period") ?? getLastCompletedMonth()

  // Validate period to prevent CRLF injection in Content-Disposition header
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return NextResponse.json({ error: "Invalid period format. Expected YYYY-MM." }, { status: 400 })
  }

  try {
    const data = await Effect.runPromise(getPnlData(period))

    if (format === "excel") {
      const buffer = await generatePnlExcel(data)
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="pnl-${period}.xlsx"`,
        },
      })
    }

    const buffer = generatePnlPdf(data)
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="pnl-${period}.pdf"`,
      },
    })
  } catch (error) {
    console.error("P&L report generation failed:", error)
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 })
  }
}
