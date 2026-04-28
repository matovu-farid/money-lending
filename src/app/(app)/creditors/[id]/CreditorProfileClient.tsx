"use client"

import { useMemo } from "react"
import { useLiveQuery, eq, inArray } from "@tanstack/react-db"
import { notFound } from "next/navigation"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AddInvestmentDialog } from "./AddInvestmentDialog"
import { RecordRepaymentDialog } from "./RecordRepaymentDialog"
import { creditorCollection } from "@/collections/creditors"
import { creditorInvestmentCollection } from "@/collections/creditor-investments"
import { creditorRepaymentCollection } from "@/collections/creditor-repayments"
import {
  getCreditorDashboardCollection,
  getCreditorMonthlySummaryCollection,
  getCreditorRepaymentPortionsCollection,
} from "@/collections/creditor-extras"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { Landmark, TrendingUp, CreditCard, DollarSign } from "lucide-react"
import { PageHeader } from "@/components/ui/page-header"
import { InfoPopover } from "@/components/ui/info-popover"
import { formatDate, formatCurrency, formatRate } from "@/lib/utils"

interface Props {
  creditorId: string
}

function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-")
  const date = new Date(Number(year), Number(month) - 1)
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short" })
}

export function CreditorProfileClient({ creditorId }: Props) {
  const { data: creditorRows, isLoading: creditorLoading } = useLiveQuery(
    (q) => q.from({ c: creditorCollection }).where(({ c }) => eq(c.id, creditorId)),
    [creditorId],
  )
  const creditor = creditorRows?.[0]

  const { data: investmentRows } = useLiveQuery(
    (q) =>
      q
        .from({ i: creditorInvestmentCollection })
        .where(({ i }) => eq(i.creditorId, creditorId)),
    [creditorId],
  )
  const investments = useMemo(
    () =>
      [...(investmentRows ?? [])].sort(
        (a, b) => a.investmentDate.getTime() - b.investmentDate.getTime(),
      ),
    [investmentRows],
  )

  const investmentIdsKey = useMemo(
    () => investments.map((i) => i.id).sort().join(","),
    [investments],
  )
  const investmentIds = useMemo(
    () => (investmentIdsKey ? investmentIdsKey.split(",") : []),
    [investmentIdsKey],
  )

  // Repayments live-filter against the in-memory investmentIds; when the list
  // is empty (a brand-new creditor) the query returns nothing.
  const { data: repaymentRows } = useLiveQuery(
    (q) =>
      investmentIds.length === 0
        ? undefined
        : q
            .from({ r: creditorRepaymentCollection })
            .where(({ r }) => inArray(r.investmentId, investmentIds)),
    [investmentIdsKey],
  )
  const repayments = useMemo(
    () =>
      [...(repaymentRows ?? [])].sort(
        (a, b) => a.repaymentDate.getTime() - b.repaymentDate.getTime(),
      ),
    [repaymentRows],
  )

  const repaymentIds = useMemo(() => repayments.map((r) => r.id), [repayments])
  const portionsColl = useMemo(
    () => getCreditorRepaymentPortionsCollection(repaymentIds),
    [repaymentIds],
  )
  const { data: portionsRows } = useLiveQuery(
    (q) => q.from({ pp: portionsColl }).select(({ pp }) => pp),
    [portionsColl],
  )
  const repaymentPortions = portionsRows?.[0]?.data ?? {}

  const dashboardColl = useMemo(
    () => getCreditorDashboardCollection(creditorId),
    [creditorId],
  )
  const { data: dashboardRows, isLoading: dashboardLoading } = useLiveQuery(
    (q) => q.from({ d: dashboardColl }).select(({ d }) => d),
    [dashboardColl],
  )
  const dashboard = dashboardRows?.[0]?.data

  const monthlySummaryColl = useMemo(
    () => getCreditorMonthlySummaryCollection(creditorId),
    [creditorId],
  )
  const { data: monthlySummaryRows } = useLiveQuery(
    (q) => q.from({ m: monthlySummaryColl }).select(({ m }) => m),
    [monthlySummaryColl],
  )
  const monthlySummary = monthlySummaryRows?.[0]?.data ?? []

  // Show 404 only after the creditor query has settled — early-return on
  // `undefined` would flash 404 during the initial sync.
  if (!creditorLoading && !creditor) {
    notFound()
  }

  if (!creditor || (dashboardLoading && !dashboard)) {
    return <LoadingSkeleton />
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <PageHeader title={creditor.name} subtitle="Creditor profile" />
        <p className="text-sm text-muted-foreground mt-0.5">
          {creditor.contact} &bull; {creditor.address}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Invested"
          value={formatCurrency(dashboard?.totalInvested ?? "0")}
          icon={Landmark}
          labelExtra={
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Total Invested</p>
              <p className="text-xs text-muted-foreground">
                Sum of all capital this creditor has invested. Each investment is
                tracked separately with its own interest rate and repayment schedule.
              </p>
            </InfoPopover>
          }
        />
        <KpiCard
          label="Interest Accrued"
          value={formatCurrency(dashboard?.interestAccrued ?? "0")}
          icon={TrendingUp}
          labelExtra={
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Interest Accrued</p>
              <p className="text-xs text-muted-foreground mb-2">
                Total interest owed to this creditor based on their investment balances and agreed rates.
              </p>
              <p className="text-xs font-mono bg-muted rounded px-2 py-1">
                Per investment: Balance &times; (Rate &divide; 30) &times; Days Since Last Repayment
              </p>
            </InfoPopover>
          }
        />
        <KpiCard
          label="Repayments Made"
          value={formatCurrency(dashboard?.repaymentsMade ?? "0")}
          icon={CreditCard}
          labelExtra={
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Repayments Made</p>
              <p className="text-xs text-muted-foreground">
                Total amount paid back to this creditor, including both principal and interest portions.
                Each repayment covers interest first, then reduces the principal balance.
              </p>
            </InfoPopover>
          }
        />
        <KpiCard
          label="Outstanding Balance"
          value={formatCurrency(dashboard?.outstandingBalance ?? "0")}
          icon={DollarSign}
          labelExtra={
            <InfoPopover>
              <p className="font-semibold text-sm mb-1">Outstanding Balance</p>
              <p className="text-xs text-muted-foreground mb-2">
                Current total obligation to this creditor.
              </p>
              <p className="text-xs font-mono bg-muted rounded px-2 py-1">
                Remaining Principal + Accrued Interest
              </p>
            </InfoPopover>
          }
        />
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <AddInvestmentDialog creditorId={creditorId} />
          <RecordRepaymentDialog
            creditorId={creditorId}
            investments={investments}
            outstandingBalance={dashboard?.outstandingBalance ?? "0"}
          />
        </div>

        <Tabs defaultValue="investments">
          <TabsList>
            <TabsTrigger value="investments">Investments</TabsTrigger>
            <TabsTrigger value="repayments">Repayments</TabsTrigger>
            <TabsTrigger value="monthly-summary">Monthly Summary</TabsTrigger>
          </TabsList>

          <TabsContent value="investments">
            {investments.length === 0 || !dashboard ? (
              <div className="py-12 text-center text-muted-foreground">
                No investments recorded for this creditor.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Principal Balance</TableHead>
                      <TableHead className="text-right">Interest Accrued</TableHead>
                      <TableHead className="text-right">Total Repaid</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboard.investments.map((inv) => (
                      <TableRow key={inv.id} data-testid="data-row">
                        <TableCell className="font-mono tabular-nums">{formatDate(inv.investmentDate)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatCurrency(inv.amount)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatRate(inv.interestRateMonthly, 1)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatCurrency(inv.principalBalance)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatCurrency(inv.interestAccrued)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatCurrency(inv.totalRepaid)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="repayments">
            {repayments.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                No repayments recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Interest Portion</TableHead>
                      <TableHead className="text-right">Principal Portion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {repayments.map((repayment) => {
                      const portions = repaymentPortions[repayment.id]
                      return (
                        <TableRow key={repayment.id} data-testid="data-row">
                          <TableCell className="font-mono tabular-nums">{formatDate(repayment.repaymentDate)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{formatCurrency(repayment.amount)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{formatCurrency(portions?.interestPortion ?? "0")}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{formatCurrency(portions?.principalPortion ?? "0")}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="monthly-summary">
            {monthlySummary.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                No monthly data available yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">Interest Due</TableHead>
                      <TableHead className="text-right">Interest Paid</TableHead>
                      <TableHead className="text-right">Principal Paid</TableHead>
                      <TableHead className="text-right">Total Paid</TableHead>
                      <TableHead className="text-right">Remaining Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthlySummary.map((row) => (
                      <TableRow key={row.month} data-testid="data-row">
                        <TableCell className="font-mono tabular-nums">{formatMonth(row.month)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatCurrency(row.interestDue)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatCurrency(row.interestPaid)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatCurrency(row.principalPaid)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatCurrency(row.totalPaid)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatCurrency(row.remainingBalance)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="h-8 w-48 rounded bg-muted-foreground/10 animate-pulse" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-muted-foreground/10 animate-pulse" />
        ))}
      </div>
      <div className="h-64 w-full rounded-lg bg-muted-foreground/10 animate-pulse" />
    </div>
  )
}
