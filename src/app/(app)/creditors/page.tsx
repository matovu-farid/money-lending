"use client"

import { useLiveSuspenseQuery } from "@tanstack/react-db"
import { creditorCollection, systemCapitalCollection, creditorMonthlyDueCollection } from "@/collections"
import { useSession } from "@/lib/auth-client"
import { ButtonLink } from "@/components/ui/button-link"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { CreditorsTable } from "./creditors-table"
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

export default function CreditorsPage() {
  const { data: session, isPending: sessionPending } = useSession()
  const { permissions, has } = usePermissions()
  const permissionsLoaded = permissions.size > 0
  const isSupervisorOrAbove = has("creditor:read")

  const { data: allCreditors } = useLiveSuspenseQuery((q) =>
    q.from({ c: creditorCollection }).select(({ c }) => c)
  )
  const creditors = allCreditors ?? []

  const { data: capitalRows } = useLiveSuspenseQuery((q) =>
    q.from({ c: systemCapitalCollection }).select(({ c }) => c)
  )
  const capital = capitalRows?.[0] ?? defaultCapital

  const { data: monthlyDueRows } = useLiveSuspenseQuery((q) =>
    q.from({ m: creditorMonthlyDueCollection }).select(({ m }) => m)
  )
  const monthlyDue = monthlyDueRows?.[0]?.data ?? {}

  const isLoading = false

  // Wait for permissions to load before checking access
  if (sessionPending || !permissionsLoaded) return null

  if (!isSupervisorOrAbove) {
    return (
      <div className="p-4 md:p-6 space-y-2">
        <div className="flex items-center gap-2">
          <PermissionInfo requiredRole="supervisor" action="View creditors" locked />
          <p className="text-destructive font-medium">Access denied.</p>
        </div>
        <p className="text-muted-foreground text-sm">
          You need Supervisor or higher permissions to view creditors.
        </p>
      </div>
    )
  }

  if (isLoading) {
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

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader title="Creditors" subtitle="Capital sources and obligations">
        <ButtonLink href="/creditors/new">
          Add Creditor
        </ButtonLink>
      </PageHeader>

      {/* System Capital KPIs — CRED-06 */}
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
          <ButtonLink href="/creditors/new">
            Add Creditor
          </ButtonLink>
        </div>
      ) : (
        <CreditorsTable creditors={creditors} monthlyDue={monthlyDue} />
      )}
    </div>
  )
}
