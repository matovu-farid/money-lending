import { Effect } from "effect"
import { notFound } from "next/navigation"
import { getCreditor, getCreditorDashboard } from "@/services/creditor.service"
import { db } from "@/lib/db"
import { creditorRepayments } from "@/lib/db/schema/creditor-repayments"
import { creditorInvestments } from "@/lib/db/schema/creditor-investments"
import { eq, asc, inArray } from "drizzle-orm"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { CreditorProfileClient } from "./CreditorProfileClient"
import type { CreditorRepayment, CreditorInvestment } from "@/types"
import { Landmark, TrendingUp, CreditCard, DollarSign } from "lucide-react"

function formatUGX(amount: string): string {
  const num = parseFloat(amount)
  if (isNaN(num)) return "UGX 0"
  return `UGX ${new Intl.NumberFormat("en-UG", { style: "decimal", maximumFractionDigits: 0 }).format(num)}`
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function CreditorProfilePage({ params }: Props) {
  const { id } = await params

  let creditor
  let dashboard
  let investments: CreditorInvestment[] = []
  let repayments: CreditorRepayment[] = []

  try {
    ;[creditor, dashboard] = await Promise.all([
      Effect.runPromise(getCreditor(id)),
      Effect.runPromise(getCreditorDashboard(id)),
    ])

    // Fetch raw investments and repayments for the tabs
    investments = await db
      .select()
      .from(creditorInvestments)
      .where(eq(creditorInvestments.creditorId, id))
      .orderBy(asc(creditorInvestments.investmentDate))

    if (investments.length > 0) {
      repayments = await db
        .select()
        .from(creditorRepayments)
        .where(
          inArray(
            creditorRepayments.investmentId,
            investments.map((inv) => inv.id)
          )
        )
        .orderBy(asc(creditorRepayments.repaymentDate))
    }
  } catch {
    notFound()
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{creditor.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {creditor.contact} &bull; {creditor.address}
        </p>
      </div>

      {/* KPI Cards — CRED-05 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Invested"
          value={formatUGX(dashboard.totalInvested)}
          icon={Landmark}
        />
        <KpiCard
          label="Interest Accrued"
          value={formatUGX(dashboard.interestAccrued)}
          icon={TrendingUp}
        />
        <KpiCard
          label="Repayments Made"
          value={formatUGX(dashboard.repaymentsMade)}
          icon={CreditCard}
        />
        <KpiCard
          label="Outstanding Balance"
          value={formatUGX(dashboard.outstandingBalance)}
          icon={DollarSign}
        />
      </div>

      <CreditorProfileClient
        creditorId={id}
        creditor={creditor}
        dashboard={dashboard}
        investments={investments}
        repayments={repayments}
      />
    </div>
  )
}
