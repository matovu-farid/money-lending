import { Effect } from "effect"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { getBalanceSheetData } from "@/services/report.service"
import { generateBalanceSheetPdf } from "@/services/export/pdf.service"
import { generateBalanceSheetExcel } from "@/services/export/excel.service"
import { getCurrentMonth } from "@/lib/utils"
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
  const period = searchParams.get("period") ?? getCurrentMonth()

  // Validate period to prevent CRLF injection in Content-Disposition header
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return NextResponse.json({ error: "Invalid period format. Expected YYYY-MM." }, { status: 400 })
  }

  try {
    const data = await Effect.runPromise(getBalanceSheetData(period))

    if (format === "excel") {
      const buffer = await generateBalanceSheetExcel(data)
      return new Response(Buffer.from(buffer) as unknown as BodyInit, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="balance-sheet-${period}.xlsx"`,
          "Cache-Control": "private, no-cache, must-revalidate",
        },
      })
    }

    const buffer = generateBalanceSheetPdf(data)
    return new Response(Buffer.from(buffer) as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="balance-sheet-${period}.pdf"`,
        "Cache-Control": "private, no-cache, must-revalidate",
      },
    })
  } catch (error) {
    console.error("Balance sheet generation failed:", error)
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 })
  }
}
