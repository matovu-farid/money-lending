import { Effect } from "effect"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { getPortfolioData } from "@/services/report.service"
import { generatePortfolioPdf } from "@/services/export/pdf.service"
import { generatePortfolioExcel } from "@/services/export/excel.service"
import { getUserRole, getEffectivePermissions } from "@/lib/action-utils"

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const perms = await getEffectivePermissions(session.user.id, getUserRole(session))
  if (!perms.has("reports:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const format = searchParams.get("format") ?? "pdf"

  try {
    const data = await Effect.runPromise(getPortfolioData())

    if (format === "excel") {
      const buffer = await generatePortfolioExcel(data)
      return new Response(Buffer.from(buffer) as unknown as BodyInit, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="portfolio-report.xlsx"`,
          "Cache-Control": "private, no-cache, must-revalidate",
        },
      })
    }

    const buffer = generatePortfolioPdf(data)
    return new Response(Buffer.from(buffer) as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="portfolio-report.pdf"`,
        "Cache-Control": "private, no-cache, must-revalidate",
      },
    })
  } catch (error) {
    console.error("Portfolio report generation failed:", error)
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 })
  }
}
