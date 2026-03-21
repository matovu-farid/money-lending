import { Effect } from "effect"
import { generateMonthlySnapshot } from "@/services/report.service"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Calculate the most recently completed month
  const now = new Date()
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const period = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`

  try {
    await Effect.runPromise(generateMonthlySnapshot(period, "cron"))
    return NextResponse.json({
      success: true,
      period,
      message: `Snapshot generated for ${period}`,
    })
  } catch (error) {
    console.error("Month-end snapshot failed:", error)
    return NextResponse.json({ error: "Snapshot generation failed" }, { status: 500 })
  }
}
