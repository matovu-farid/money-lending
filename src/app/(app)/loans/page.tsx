"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { listLoansAction } from "@/actions/loan.actions"
import type { Loan } from "@/types"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function formatUGX(amount: string): string {
  const num = parseFloat(amount)
  return new Intl.NumberFormat("en-UG", { style: "decimal", maximumFractionDigits: 0 }).format(num)
}

function loanStatusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "active") return "default"
  if (status === "pending") return "secondary"
  return "outline"
}

function loanStatusLabel(status: string): string {
  if (status === "fully_paid") return "Fully Paid"
  return status.charAt(0).toUpperCase() + status.slice(1)
}

export default function LoansPage() {
  const [loans, setLoans] = useState<Loan[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    listLoansAction().then((result) => {
      if ("error" in result) {
        setFetchError(result.error ?? "Unknown error")
      } else {
        setLoans(result.data)
      }
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Loading loans...</p>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="p-6">
        <p className="text-destructive">Error: {fetchError}</p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Loans</h1>
        <Link href="/loans/new" className={cn(buttonVariants())}>
          New Loan
        </Link>
      </div>

      {loans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <p className="text-muted-foreground">No loans issued yet.</p>
          <Link href="/loans/new" className={cn(buttonVariants())}>
            Issue First Loan
          </Link>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer ID</TableHead>
              <TableHead>Principal Amount</TableHead>
              <TableHead>Interest Rate</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Start Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loans.map((loan) => (
              <TableRow key={loan.id}>
                <TableCell className="font-mono text-xs">{loan.customerId}</TableCell>
                <TableCell>UGX {formatUGX(loan.principalAmount)}</TableCell>
                <TableCell>{(parseFloat(loan.interestRate) * 100).toFixed(0)}% / month</TableCell>
                <TableCell>
                  <Badge variant={loanStatusVariant(loan.status)}>
                    {loanStatusLabel(loan.status)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {new Date(loan.startDate).toLocaleDateString("en-UG")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
