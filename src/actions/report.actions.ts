"use server"

import { Effect } from "effect"
import { withAction, type Session } from "@/lib/with-action"
import {
  getPortfolioData,
  getPnlData,
  getBalanceSheetData,
  getRetainedEarningsData,
  getCashflowData,
} from "@/services/report.service"
import { listTransactions } from "@/services/transaction.service"
import { getCurrentMonth } from "@/lib/utils"
import { checkPermission, getUserRole } from "@/lib/action-utils"
import { parseWeeklyReportPeriod } from "@/lib/weekly-report-period"
import { DatabaseError, ForbiddenError, ValidationError } from "@/lib/errors"
import {
  getWeeklyLoansData,
  getWeeklyPaymentsData,
} from "@/services/weekly-report.service"
import type {
  WeeklyLoansReportData,
  WeeklyPaymentsReportData,
} from "@/types/weekly-report"

export const getPortfolioReportAction = withAction({
  permission: "reports:read",
  effect: () => getPortfolioData(),
  errors: { DatabaseError: "Database error" },
})

export const getPnlReportAction = withAction<{ period: string }, Effect.Effect.Success<ReturnType<typeof getPnlData>>>({
  permission: "reports:read",
  effect: (_session, { period }) => getPnlData(period || getCurrentMonth()),
  errors: { DatabaseError: "Database error" },
})

export const getBalanceSheetReportAction = withAction<{ period: string }, Effect.Effect.Success<ReturnType<typeof getBalanceSheetData>>>({
  permission: "reports:read",
  effect: (_session, { period }) => getBalanceSheetData(period || getCurrentMonth()),
  errors: { DatabaseError: "Database error" },
})

export const getRetainedEarningsReportAction = withAction<{ period: string }, Effect.Effect.Success<ReturnType<typeof getRetainedEarningsData>>>({
  permission: "reports:read",
  effect: (_session, { period }) => getRetainedEarningsData(period || getCurrentMonth()),
  errors: { DatabaseError: "Database error" },
})

export const getCashflowReportAction = withAction<{ period: string }, Effect.Effect.Success<ReturnType<typeof getCashflowData>>>({
  permission: "reports:read",
  effect: (_session, { period }) => getCashflowData(period || getCurrentMonth()),
  errors: { DatabaseError: "Database error" },
})

export const getTransactionReportDataAction = withAction({
  permission: "reports:read",
  effect: (session) => {
    const canReadCreditorTransactions = ["admin", "superAdmin"].includes(getUserRole(session))

    return Effect.map(
      listTransactions(
        canReadCreditorTransactions
          ? {}
          : { excludeCreditorTransactions: true },
        1,
        10000,
      ),
      (result) => {
        const categories = new Map<string, string>()
        for (const tx of result.data) {
          categories.set(tx.category, tx.category)
        }
        return {
          transactions: result.data,
          categories: Array.from(categories.entries()),
        }
      },
    )
  },
  errors: { DatabaseError: "Database error" },
})

function runWeeklyReport<T>(
  session: Session,
  week: string,
  permission: "payment:read" | "loan:read",
  service: (week: string) => Effect.Effect<T, DatabaseError>,
): Effect.Effect<T, DatabaseError | ForbiddenError | ValidationError> {
  return Effect.gen(function* () {
    const forbidden = yield* Effect.tryPromise({
      try: () => checkPermission(session, permission),
      catch: (cause) => new DatabaseError({ cause }),
    })
    if (forbidden) {
      return yield* Effect.fail(new ForbiddenError({ action: permission, role: getUserRole(session) }))
    }
    try {
      parseWeeklyReportPeriod(week)
    } catch {
      return yield* Effect.fail(new ValidationError({ message: "Invalid week" }))
    }
    return yield* service(week)
  })
}

export const getWeeklyPaymentsReportAction = withAction<
  { week: string },
  WeeklyPaymentsReportData
>({
  permission: "reports:read",
  effect: (session, { week }) =>
    runWeeklyReport(session, week, "payment:read", getWeeklyPaymentsData),
  errors: {
    DatabaseError: "Database error",
    ForbiddenError: "Forbidden",
    ValidationError: "Invalid week",
  },
})

export const getWeeklyLoansReportAction = withAction<
  { week: string },
  WeeklyLoansReportData
>({
  permission: "reports:read",
  effect: (session, { week }) =>
    runWeeklyReport(session, week, "loan:read", getWeeklyLoansData),
  errors: {
    DatabaseError: "Database error",
    ForbiddenError: "Forbidden",
    ValidationError: "Invalid week",
  },
})
