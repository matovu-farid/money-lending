import { Effect } from "effect"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { getPnlData } from "@/services/report.service"
import { generatePnlPdf } from "@/services/export/pdf.service"
import { generatePnlExcel } from "@/services/export/excel.service"
import { getCurrentMonth } from "@/lib/utils"
import { getUserRole, getEffectivePermissions } from "@/lib/action-utils"
import { captureServerError } from "@/lib/sentry"

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const perms = await getEffectivePermissions(session.user.id, getUserRole(session))
  if (!perms.has("reports:financial")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const format = searchParams.get("format") ?? "pdf"
  const period = searchParams.get("period") ?? getCurrentMonth()

  // Validate period to prevent CRLF injection in Content-Disposition header
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return NextResponse.json({ error: "Invalid period format. Expected YYYY-MM." }, { status: 400 })
  }

  try {
    const data = await Effect.runPromise(getPnlData(period))

    if (format === "excel") {
      const buffer = await generatePnlExcel(data)
      return new Response(Buffer.from(buffer) as unknown as BodyInit, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="pnl-${period}.xlsx"`,
          "Cache-Control": "private, no-cache, must-revalidate",
        },
      })
    }

    const buffer = generatePnlPdf(data)
    return new Response(Buffer.from(buffer) as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="pnl-${period}.pdf"`,
        "Cache-Control": "private, no-cache, must-revalidate",
      },
    })
  } catch (error) {
    console.error("P&L report generation failed:", error)
    captureServerError(error, { source: "reports:pnl", format, period })
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 })
  }
}
