"use client"

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
import type { Creditor, CreditorDashboard, CreditorInvestment, CreditorRepayment, PaymentPortionsMap, MonthlySummaryRow } from "@/types"
import { formatDate, formatCurrency, formatRate } from "@/lib/utils"

interface Props {
  creditorId: string
  creditor: Creditor
  dashboard: CreditorDashboard
  investments: CreditorInvestment[]
  repayments: CreditorRepayment[]
  repaymentPortions: PaymentPortionsMap
  monthlySummary: MonthlySummaryRow[]
}

function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-")
  const date = new Date(Number(year), Number(month) - 1)
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short" })
}

export function CreditorProfileClient({
  creditorId,
  creditor,
  dashboard,
  investments,
  repayments,
  repaymentPortions,
  monthlySummary,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <AddInvestmentDialog creditorId={creditorId} />
        <RecordRepaymentDialog
          creditorId={creditorId}
          investments={investments}
          outstandingBalance={dashboard.outstandingBalance}
        />
      </div>

      <Tabs defaultValue="investments">
        <TabsList>
          <TabsTrigger value="investments">Investments</TabsTrigger>
          <TabsTrigger value="repayments">Repayments</TabsTrigger>
          <TabsTrigger value="monthly-summary">Monthly Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="investments">
          {investments.length === 0 ? (
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
  )
}
