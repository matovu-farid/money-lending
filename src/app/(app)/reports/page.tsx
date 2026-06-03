"use client"

import Link from "next/link"
import { FileText, TrendingUp, Scale, ScrollText, ClipboardList, PiggyBank, ArrowLeftRight } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Permission } from "@/types"
import { usePermissions } from "@/hooks/use-permissions"

interface ReportCard {
  icon: React.ElementType
  title: string
  description: string
  href: string
  permission?: Permission
}

const reportCards: ReportCard[] = [
  {
    icon: FileText,
    title: "Loan Portfolio",
    description:
      "Active loans with days remaining, interest accrued, and risk flags.",
    href: "/reports/portfolio",
  },
  {
    icon: ArrowLeftRight,
    title: "Monthly Cashflow",
    description:
      "Cash in vs. cash out per month over the last 12 months with category breakdown.",
    href: "/reports/cashflow",
    permission: "reports:financial",
  },
  {
    icon: TrendingUp,
    title: "Profit & Loss",
    description:
      "Monthly income and expense summary with net profit calculation.",
    href: "/reports/pnl",
    permission: "reports:financial",
  },
  {
    icon: PiggyBank,
    title: "Retained Earnings",
    description:
      "Beginning balance, net income, and ending retained earnings.",
    href: "/reports/retained-earnings",
    permission: "reports:financial",
  },
  {
    icon: Scale,
    title: "Balance Sheet",
    description: "Assets, liabilities, and equity — must balance.",
    href: "/reports/balance-sheet",
    permission: "reports:financial",
  },
  {
    icon: ClipboardList,
    title: "Active Loans",
    description:
      "Active loans with principal, interest, contact info, and days overdue.",
    href: "/reports/active-loans",
  },
  {
    icon: ScrollText,
    title: "Transaction Log",
    description: "Full audit trail of all debit and credit entries.",
    href: "/transactions",
    permission: "reports:financial",
  },
]

export default function ReportsPage() {
  const { has } = usePermissions()
  const visibleCards = reportCards.filter((card) => !card.permission || has(card.permission))
  return (
    <div className="space-y-8 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
          Financial reporting and analytics
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleCards.map((card) => {
          const Icon = card.icon
          return (
            <Card key={card.href} className="flex flex-col">
              <CardHeader className="flex flex-row items-start gap-3 space-y-0">
                <div className="rounded-md bg-muted p-2">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-base">{card.title}</CardTitle>
                  <CardDescription className="mt-1 text-sm">
                    {card.description}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="pt-0 mt-auto">
                <Link
                  href={card.href}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  View Report
                </Link>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
