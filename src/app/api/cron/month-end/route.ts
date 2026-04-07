import { Effect } from "effect"
import { generateMonthlySnapshot } from "@/services/report.service"
import { accrueInterestForLoans, accrueInterestForCreditors } from "@/services/transaction.service"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  // Fail-closed: reject if CRON_SECRET is not configured
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  }

  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const period = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`

  const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)

  try {
    // Accrue interest BEFORE generating snapshots so P&L and balance sheet
    // reflect accrued (not just cash-basis) interest
    const [loanAccrual, creditorAccrual] = await Promise.all([
      Effect.runPromise(accrueInterestForLoans(periodEnd)),
      Effect.runPromise(accrueInterestForCreditors(periodEnd)),
    ])

    await Effect.runPromise(generateMonthlySnapshot(period, "cron"))
    return NextResponse.json({
      success: true,
      period,
      message: `Snapshot generated for ${period}`,
      accruals: { loans: loanAccrual, creditors: creditorAccrual },
    })
  } catch (error) {
    console.error("Month-end snapshot failed:", error)
    return NextResponse.json({ error: "Snapshot generation failed" }, { status: 500 })
  }
}
