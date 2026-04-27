"use client"

import { Suspense, useState } from "react"
import { useLiveSuspenseQuery } from "@tanstack/react-db"
import { creditorCollection } from "@/collections/creditors"
import { creditorsPageDataCollection } from "@/collections/creditors-page-data"
import { Button } from "@/components/ui/button"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { CreditorsTable } from "./creditors-table"
import { AddCreditorDialog } from "./AddCreditorDialog"
import { Landmark, TrendingUp, CreditCard, DollarSign } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { InfoPopover } from "@/components/ui/info-popover"
import { PageHeader } from "@/components/ui/page-header"
import { PermissionInfo } from "@/components/ui/permission-info"
import { usePermissions } from "@/hooks/use-permissions"

const defaultCapital = {
  totalInvested: "0.00",
  totalInterestAccrued: "0.00",
  totalRepaymentsMade: "0.00",
  totalOutstanding: "0.00",
}

function LoadingSkeleton() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="h-8 w-48 rounded bg-muted-foreground/10 animate-pulse" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-muted-foreground/10 animate-pulse" />
        ))}
      </div>
      <div className="h-64 w-full rounded-lg bg-muted-foreground/10 animate-pulse" />
    </div>
  )
}

function CreditorsContent() {
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data: allCreditors } = useLiveSuspenseQuery((q) =>
    q.from({ c: creditorCollection }).select(({ c }) => c)
  )
  const creditors = allCreditors ?? []

  const { data: pageDataRows } = useLiveSuspenseQuery((q) =>
    q.from({ p: creditorsPageDataCollection }).select(({ p }) => p)
  )
  const pageData = pageDataRows?.[0]
  const capital = pageData?.capital ?? defaultCapital
  const monthlyDue = pageData?.monthlyDue ?? {}

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader title="Creditors" subtitle="Capital sources and obligations">
        <Button onClick={() => setDialogOpen(true)}>
          Add Creditor
        </Button>
      </PageHeader>

      <AddCreditorDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      {/* System Capital KPIs */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Invested"
          value={formatCurrency(capital.totalInvested)}
          icon={Landmark}
          labelExtra={
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Total Invested</p>
              <p className="text-xs text-muted-foreground">
                Sum of all capital invested by all creditors. This is the total money borrowed from creditors to fund lending operations.
              </p>
            </InfoPopover>
          }
        />
        <KpiCard
          label="Total Interest Accrued"
          value={formatCurrency(capital.totalInterestAccrued)}
          icon={TrendingUp}
          labelExtra={
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Total Interest Accrued</p>
              <p className="text-xs text-muted-foreground mb-2">
                Total interest owed to creditors based on their investment amounts and agreed rates. This is a cost to the business.
              </p>
              <p className="text-xs font-semibold mb-1">Formula</p>
              <p className="text-xs font-mono bg-muted rounded px-2 py-1">
                For each investment: Principal Balance x (Monthly Rate / 30) x Days Since Last Repayment
              </p>
            </InfoPopover>
          }
        />
        <KpiCard
          label="Total Repayments"
          value={formatCurrency(capital.totalRepaymentsMade)}
          icon={CreditCard}
          labelExtra={
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Total Repayments</p>
              <p className="text-xs text-muted-foreground">
                Total amount paid back to creditors (both principal and interest portions). Reduces the outstanding obligation to creditors.
              </p>
            </InfoPopover>
          }
        />
        <KpiCard
          label="Total Outstanding"
          value={formatCurrency(capital.totalOutstanding)}
          icon={DollarSign}
          labelExtra={
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Total Outstanding</p>
              <p className="text-xs text-muted-foreground mb-2">
                The current total obligation to all creditors.
              </p>
              <p className="text-xs font-semibold mb-1">Formula</p>
              <p className="text-xs font-mono bg-muted rounded px-2 py-1 mb-2">
                Total Outstanding = Remaining Principal + Accrued Interest
              </p>
              <p className="text-xs text-muted-foreground">
                Compare this against your loan portfolio to assess business health.
              </p>
            </InfoPopover>
          }
        />
      </div>

      {creditors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <p className="text-xl font-medium">No creditors yet</p>
          <p className="text-muted-foreground">
            Register your first creditor to start tracking invested capital.
          </p>
          <Button onClick={() => setDialogOpen(true)}>
            Add Creditor
          </Button>
        </div>
      ) : (
        <CreditorsTable creditors={creditors} monthlyDue={monthlyDue} />
      )}
    </div>
  )
}

export default function CreditorsPage() {
  const { has } = usePermissions()
  const canViewCreditors = has("creditor:read")

  if (!canViewCreditors) {
    return (
      <div className="p-4 md:p-6 space-y-2">
        <div className="flex items-center gap-2">
          <PermissionInfo requiredRole="admin" action="View creditors" locked />
          <p className="text-destructive font-medium">Access denied.</p>
        </div>
        <p className="text-muted-foreground text-sm">
          You need Admin or higher permissions to view creditors.
        </p>
      </div>
    )
  }

  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <CreditorsContent />
    </Suspense>
  )
}
