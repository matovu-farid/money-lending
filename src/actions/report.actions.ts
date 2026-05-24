"use server"

import { Effect } from "effect"
import { withAction, type Session } from "@/lib/with-action"
import {
  getPortfolioData,
  getPnlData,
  getBalanceSheetData,
  getRetainedEarningsData,
} from "@/services/report.service"
import { listTransactions } from "@/services/transaction.service"
import { getCurrentMonth } from "@/lib/utils"

export const getPortfolioReportAction = withAction({
  permission: "reports:read",
  effect: () => getPortfolioData(),
  errors: { DatabaseError: "Database error" },
})

export const getPnlReportAction = withAction({
  permission: "reports:read",
  effect: (_session: Session, { period }: { period: string }) => getPnlData(period || getCurrentMonth()),
  errors: { DatabaseError: "Database error" },
})

export const getBalanceSheetReportAction = withAction({
  permission: "reports:read",
  effect: (_session: Session, { period }: { period: string }) => getBalanceSheetData(period || getCurrentMonth()),
  errors: { DatabaseError: "Database error" },
})

export const getRetainedEarningsReportAction = withAction({
  permission: "reports:read",
  effect: (_session: Session, { period }: { period: string }) => getRetainedEarningsData(period || getCurrentMonth()),
  errors: { DatabaseError: "Database error" },
})

export const getTransactionReportDataAction = withAction({
  permission: "reports:read",
  effect: () =>
    Effect.map(listTransactions({}, 1, 10000), (result) => {
      const categories = new Map<string, string>()
      for (const tx of result.data) {
        categories.set(tx.category, tx.category)
      }
      return {
        transactions: result.data,
        categories: Array.from(categories.entries()),
      }
    }),
  errors: { DatabaseError: "Database error" },
})
