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
import { formatCurrency } from "@/lib/utils"
import { PageHeader } from "@/components/ui/page-header"
import { getCreditorRepaymentPortionsFromLedger } from "@/services/transaction.service"

interface Props {
  params: Promise<{ id: string }>
}

export default async function CreditorProfilePage({ params }: Props) {
  const { id } = await params

  let creditor
  let dashboard
  let investments: CreditorInvestment[] = []
  let repayments: CreditorRepayment[] = []
  let repaymentPortions: Record<string, { interestPortion: string; principalPortion: string }> = {}

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

      // Derive portions from ledger instead of cached columns
      if (repayments.length > 0) {
        const portionsMap = await getCreditorRepaymentPortionsFromLedger(
          repayments.map((r) => r.id)
        )
        for (const [key, value] of portionsMap.entries()) {
          repaymentPortions[key] = value
        }
      }
    }
  } catch {
    notFound()
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <PageHeader title={creditor.name} subtitle="Creditor profile" />
        <p className="text-sm text-muted-foreground mt-0.5">
          {creditor.contact} &bull; {creditor.address}
        </p>
      </div>

      {/* KPI Cards — CRED-05 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Invested"
          value={formatCurrency(dashboard.totalInvested)}
          icon={Landmark}
        />
        <KpiCard
          label="Interest Accrued"
          value={formatCurrency(dashboard.interestAccrued)}
          icon={TrendingUp}
        />
        <KpiCard
          label="Repayments Made"
          value={formatCurrency(dashboard.repaymentsMade)}
          icon={CreditCard}
        />
        <KpiCard
          label="Outstanding Balance"
          value={formatCurrency(dashboard.outstandingBalance)}
          icon={DollarSign}
        />
      </div>

      <CreditorProfileClient
        creditorId={id}
        creditor={creditor}
        dashboard={dashboard}
        investments={investments}
        repayments={repayments}
        repaymentPortions={repaymentPortions}
      />
    </div>
  )
}
