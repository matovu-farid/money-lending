import { Effect } from "effect"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { getPortfolioData } from "@/services/report.service"
import { generatePortfolioPdf } from "@/services/export/pdf.service"
import { generatePortfolioExcel } from "@/services/export/excel.service"

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const format = searchParams.get("format") ?? "pdf"

  try {
    const data = await Effect.runPromise(getPortfolioData())

    if (format === "excel") {
      const buffer = await generatePortfolioExcel(data)
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="portfolio-report.xlsx"`,
        },
      })
    }

    const buffer = generatePortfolioPdf(data)
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="portfolio-report.pdf"`,
      },
    })
  } catch (error) {
    console.error("Portfolio report generation failed:", error)
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 })
  }
}
