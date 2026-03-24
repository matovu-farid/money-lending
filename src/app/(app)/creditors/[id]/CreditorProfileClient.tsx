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
import type { Creditor, CreditorDashboard, CreditorInvestment, CreditorRepayment } from "@/types"
import { formatDate } from "@/lib/utils"

function formatUGX(amount: string | null | undefined): string {
  if (!amount) return "UGX 0"
  const num = parseFloat(amount)
  if (isNaN(num)) return "UGX 0"
  return `UGX ${new Intl.NumberFormat("en-UG", { style: "decimal", maximumFractionDigits: 0 }).format(num)}`
}


function formatRate(rate: string): string {
  const num = parseFloat(rate) * 100
  return `${num.toFixed(1)}%`
}

interface Props {
  creditorId: string
  creditor: Creditor
  dashboard: CreditorDashboard
  investments: CreditorInvestment[]
  repayments: CreditorRepayment[]
}

export function CreditorProfileClient({
  creditorId,
  creditor,
  dashboard,
  investments,
  repayments,
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
        </TabsList>

        <TabsContent value="investments">
          {investments.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No investments recorded for this creditor.
            </div>
          ) : (
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
                    <TableCell className="text-right font-mono tabular-nums">{formatUGX(inv.amount)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatRate(inv.interestRateMonthly)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatUGX(inv.principalBalance)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatUGX(inv.interestAccrued)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatUGX(inv.totalRepaid)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="repayments">
          {repayments.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No repayments recorded yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Interest Portion</TableHead>
                  <TableHead className="text-right">Principal Portion</TableHead>
                  <TableHead className="text-right">Balance After</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {repayments.map((repayment) => (
                  <TableRow key={repayment.id} data-testid="data-row">
                    <TableCell className="font-mono tabular-nums">{formatDate(repayment.repaymentDate)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatUGX(repayment.amount)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatUGX(repayment.interestPortion)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatUGX(repayment.principalPortion)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatUGX(repayment.principalBalanceAfter)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
