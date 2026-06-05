"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { CurrencyCell } from "@/components/ui/currency-cell"
import type { LoanListEntry } from "@/types"
import BigNumber from "bignumber.js"

interface ActiveLoansClientProps {
  data: LoanListEntry[]
}

export default function ActiveLoansClient({ data }: ActiveLoansClientProps) {
  const [search, setSearch] = useState("")

  const filtered = data.filter((entry) =>
    entry.customerName.toLowerCase().includes(search.toLowerCase())
  )

  const columns: Column<LoanListEntry>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      render: (row) => (
        <span className="font-medium">{row.customerName}</span>
      ),
    },
    {
      key: "principal",
      header: "Principal",
      align: "right",
      render: (row) => <CurrencyCell amount={row.principalAmount} />,
    },
    {
      key: "interest",
      header: "Interest",
      align: "right",
      render: (row) => {
        const rate = row.interestRateOverride ?? row.interestRate
        const pct = new BigNumber(rate).multipliedBy(100).toFixed(0)
        return <span>{pct}%</span>
      },
    },
    {
      key: "contact",
      header: "Contact",
      render: (row) => (
        <span className="text-sm">{row.customerContact ?? "—"}</span>
      ),
    },
    {
      key: "totalAmount",
      header: "Total Amount",
      align: "right",
      cardLabel: "Total Owed",
      render: (row) => {
        const total = new BigNumber(row.outstandingBalance).plus(
          new BigNumber(row.unpaidInterest)
        )
        return <CurrencyCell amount={total.toFixed(0)} />
      },
    },
    {
      key: "daysOverdue",
      header: "Days w/o Interest",
      align: "right",
      cardLabel: "Days Overdue",
      render: (row) => {
        if (row.daysOverdue >= 30) {
          return <Badge variant="destructive">{row.daysOverdue}</Badge>
        }
        if (row.daysOverdue >= 15) {
          return (
            <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
              {row.daysOverdue}
            </Badge>
          )
        }
        return <span className="text-sm tabular-nums">{row.daysOverdue}</span>
      },
    },
  ]

  return (
    <div className="space-y-4">
      <Link
        href="/reports"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Reports
      </Link>

      {/* Search filter */}
      <div className="flex items-center gap-2 max-w-sm">
        <Input
          placeholder="Search by customer name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9"
        />
      </div>

      {/* Summary */}
      <p className="text-sm text-muted-foreground">
        Showing {filtered.length} of {data.length} active loan{data.length !== 1 ? "s" : ""}
      </p>

      {/* Table */}
      <ResponsiveTable
        columns={columns}
        rows={filtered}
        getRowKey={(row) => row.id}
        emptyState={
          <p className="text-sm text-muted-foreground py-8 text-center">
            {search ? "No loans match your search." : "No active loans to display."}
          </p>
        }
      />
    </div>
  )
}
