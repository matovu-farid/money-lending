"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import {
  getPortfolioData,
  getPnlData,
  getBalanceSheetData,
  getRetainedEarningsData,
} from "@/services/report.service"
import { listTransactions } from "@/services/transaction.service"
import { getCurrentMonth } from "@/lib/utils"

export const getPortfolioReportAction = withAction({
  effect: () => getPortfolioData(),
  errors: { DatabaseError: "Database error" },
})

export const getPnlReportAction = withAction<{ period: string }, any>({
  effect: (_session, { period }) => getPnlData(period || getCurrentMonth()),
  errors: { DatabaseError: "Database error" },
})

export const getBalanceSheetReportAction = withAction<{ period: string }, any>({
  effect: (_session, { period }) => getBalanceSheetData(period || getCurrentMonth()),
  errors: { DatabaseError: "Database error" },
})

export const getRetainedEarningsReportAction = withAction<{ period: string }, any>({
  effect: (_session, { period }) => getRetainedEarningsData(period || getCurrentMonth()),
  errors: { DatabaseError: "Database error" },
})

export const getTransactionReportDataAction = withAction({
  effect: () =>
    Effect.map(listTransactions({}, 1, 10000), (result) => {
      const categories = new Map<string, string>()
      for (const tx of result.data) {
        categories.set(tx.categoryName, tx.categoryName)
      }
      return {
        transactions: result.data,
        categories: Array.from(categories.entries()),
      }
    }),
  errors: { DatabaseError: "Database error" },
})
