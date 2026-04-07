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
import type { Creditor, CreditorDashboard, CreditorInvestment, CreditorRepayment, PaymentPortionsMap } from "@/types"
import { formatDate, formatCurrency, formatRate } from "@/lib/utils"

interface Props {
  creditorId: string
  creditor: Creditor
  dashboard: CreditorDashboard
  investments: CreditorInvestment[]
  repayments: CreditorRepayment[]
  repaymentPortions: PaymentPortionsMap
}

export function CreditorProfileClient({
  creditorId,
  creditor,
  dashboard,
  investments,
  repayments,
  repaymentPortions,
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
      </Tabs>
    </div>
  )
}
