"use client"

import Link from "next/link"
import {
  MoreHorizontal,
  Banknote,
  UserCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { PaymentReceiptButton } from "@/components/receipts/payment-receipt-button"
import type { Payment, PaymentPortionsMap } from "@/types"
import { cn, formatDate, formatCurrency } from "@/lib/utils"

export interface PaymentTableProps {
  payments: Payment[]
  activePayments: Payment[]
  loanId: string
  loanRef: string
  loanStatus: string
  customerName: string | null
  userNameMap: Record<string, string>
  currentPortions: PaymentPortionsMap
  runningBalanceMap: Record<string, string>
  outstandingBalance: string
  onEditPayment: (payment: Payment) => void
  onDeletePayment: (payment: Payment) => void
}

export function PaymentTable({
  payments,
  activePayments,
  loanId,
  loanRef,
  loanStatus,
  customerName,
  userNameMap,
  currentPortions,
  runningBalanceMap,
  outstandingBalance,
  onEditPayment,
  onDeletePayment,
}: PaymentTableProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Payment History</h2>
        {activePayments.length > 0 && (
          <span className="text-xs text-muted-foreground font-mono tabular-nums">
            {activePayments.length} payment{activePayments.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {activePayments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <Banknote className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No payments recorded</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Record the first payment against this loan to start tracking repayments.
          </p>
          {loanStatus === "active" && (
            <Link
              href={`/loans/${loanId}/payments/new`}
              className={cn(buttonVariants({ size: "sm" }), "mt-2")}
            >
              Record Payment
            </Link>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Date</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Amount</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Interest</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Principal</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Balance</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Recorded By</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => {
                  const isDeleted = payment.deletedAt !== null
                  const cellClass = isDeleted ? "opacity-50 line-through" : ""
                  const recorderName = userNameMap[payment.recordedBy] ?? payment.recordedBy.slice(0, 8)
                  return (
                    <TableRow key={payment.id} data-testid="data-row" className={isDeleted ? "bg-muted/20" : ""}>
                      <TableCell className={cn("font-mono tabular-nums text-sm", cellClass)}>
                        {formatDate(payment.paymentDate)}
                      </TableCell>
                      <TableCell className={cn("text-right font-mono tabular-nums text-sm", cellClass)}>
                        {formatCurrency(payment.amount)}
                      </TableCell>
                      <TableCell className={cn("text-right font-mono tabular-nums text-sm", cellClass)}>
                        {formatCurrency(currentPortions[payment.id]?.interestPortion ?? "0.00")}
                      </TableCell>
                      <TableCell className={cn("text-right font-mono tabular-nums text-sm", cellClass)}>
                        {formatCurrency(currentPortions[payment.id]?.principalPortion ?? "0.00")}
                      </TableCell>
                      <TableCell className={cn("text-right font-mono tabular-nums text-sm", cellClass)}>
                        {payment.markedWrong ? "—" : formatCurrency(runningBalanceMap[payment.id] ?? outstandingBalance)}
                      </TableCell>
                      <TableCell className={cn("text-sm", cellClass)}>
                        <div className="flex items-center gap-1.5">
                          <UserCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate max-w-[120px]">{recorderName}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {isDeleted ? (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">Deleted</Badge>
                        ) : (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              aria-label="Payment actions"
                              className="flex h-8 w-8 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 items-center justify-center rounded-md hover:bg-muted transition-colors"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <PaymentReceiptButton
                                variant="dropdown-item"
                                data={{
                                  paymentDate: payment.paymentDate,
                                  customerName: customerName ?? "—",
                                  loanReference: loanRef,
                                  amountPaid: payment.amount,
                                  interestPortion: currentPortions[payment.id]?.interestPortion ?? "0.00",
                                  principalPortion: currentPortions[payment.id]?.principalPortion ?? "0.00",
                                  balanceAfter: runningBalanceMap[payment.id] ?? outstandingBalance,
                                  depositLocation: payment.depositLocation,
                                  officerName: userNameMap[payment.recordedBy] ?? "Officer",
                                }}
                              />
                              <DropdownMenuItem
                                onClick={() => onEditPayment(payment)}
                              >
                                Edit Payment
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => onDeletePayment(payment)}
                                variant="destructive"
                              >
                                Delete Payment
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}
