import { NextResponse } from "next/server"
import { getSession } from "@/lib/action-utils"
import { loadPortfolioAccrualPlan } from "@/services/portfolio-accrual-repair.service"

/** Admin-only read of one current source-fingerprinted plan. Never writes loan data. */
export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const role = (session.user as Record<string, unknown>).role
  if (role !== "admin" && role !== "superAdmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const url = new URL(request.url)
  const loanId = url.searchParams.get("loanId")
  const asOfText = url.searchParams.get("asOf")
  if (!loanId || !/^[a-f0-9-]{36}$/i.test(loanId) || !asOfText) {
    return NextResponse.json({ error: "Valid loan and as-of instant required" }, { status: 400 })
  }
  const asOf = new Date(asOfText)
  if (!Number.isFinite(asOf.getTime()) || asOf.toISOString() !== asOfText ||
      asOf > new Date()) {
    return NextResponse.json({ error: "Invalid as-of instant" }, { status: 400 })
  }
  try {
    const plan = await loadPortfolioAccrualPlan(loanId, asOf)
    return NextResponse.json(plan, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "Accrual preview unavailable" }, { status: 404 })
  }
}
