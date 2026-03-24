"use client"

import Link from "next/link"
import { FileText, TrendingUp, Scale, ScrollText } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const reportCards = [
  {
    icon: FileText,
    title: "Loan Portfolio",
    description:
      "Active loans with days remaining, interest accrued, and risk flags.",
    href: "/reports/portfolio",
  },
  {
    icon: TrendingUp,
    title: "Profit & Loss",
    description:
      "Monthly income and expense summary with net profit calculation.",
    href: "/reports/pnl",
  },
  {
    icon: Scale,
    title: "Balance Sheet",
    description: "Assets, liabilities, and equity — must balance.",
    href: "/reports/balance-sheet",
  },
  {
    icon: ScrollText,
    title: "Transaction Log",
    description: "Full audit trail of all debit and credit entries.",
    href: "/transactions",
  },
]

export default function ReportsPage() {
  return (
    <div className="space-y-8 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
          Financial reporting and analytics
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reportCards.map((card) => {
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
