import type { QueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"

/**
 * Centralized cache-invalidation helpers shared by collection mutation
 * handlers (`onInsert` / `onUpdate` / `onDelete`).
 *
 * Every money-moving mutation touches a similar set of derived projections:
 * dashboard KPIs, location balances, and the core financial reports.
 * Keeping the lists in one place prevents drift when a new report or
 * projection is added.
 *
 * Each helper batches `qc.invalidateQueries` calls; callers can still
 * append handler-specific invalidations afterwards.
 */

/**
 * The minimal "everything-financial" set — shared by lending events
 * (loans, payments) and ledger events (expenses, income).
 *
 * Invalidates: location balances, dashboard KPIs, P&L, balance sheet.
 */
export function invalidateFinancialProjections(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
  qc.invalidateQueries({ queryKey: queryKeys.dashboard.kpis })
  qc.invalidateQueries({ queryKey: queryKeys.reports.pnl() })
  qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
}

/**
 * Used when a loan or payment changes — extends the financial set with
 * loan-balance projections and the portfolio report.
 */
export function invalidateLendingProjections(qc: QueryClient): void {
  invalidateFinancialProjections(qc)
  qc.invalidateQueries({ queryKey: queryKeys.loanBalances.all })
  qc.invalidateQueries({ queryKey: queryKeys.reports.portfolio })
  // Loan list collections + lifecycle-derived checks (rollover / settle / fully_paid)
  qc.invalidateQueries({ queryKey: queryKeys.loans.all })
  qc.invalidateQueries({ queryKey: queryKeys.loans.operational })
  qc.invalidateQueries({ queryKey: queryKeys.loans.activeLoanCheckAll })
  qc.invalidateQueries({ queryKey: ["loans", "customer"] })
  qc.invalidateQueries({ queryKey: queryKeys.loanStatusCounts.all })
  qc.invalidateQueries({ queryKey: queryKeys.payments.byLoanAll })
  qc.invalidateQueries({ queryKey: queryKeys.payments.byCustomerAll })
}

/**
 * Used when a non-lending ledger transaction (expense / income) is
 * recorded or deleted — extends the financial set with cashflow and
 * the transactions report feed.
 */
export function invalidateLedgerProjections(qc: QueryClient): void {
  invalidateFinancialProjections(qc)
  qc.invalidateQueries({ queryKey: queryKeys.reports.cashflow() })
  qc.invalidateQueries({ queryKey: queryKeys.reports.transactions })
}

/**
 * Used when a creditor / creditor investment changes. Creditors are
 * private capital relationships — they affect the balance sheet and
 * location balances (cash received) but not P&L (interest accrues
 * separately) and not dashboard KPIs (which focus on lending activity).
 *
 * Invalidates: creditor lists, capital + monthly-due aggregates,
 * creditor investments, location balances, and the balance sheet.
 */
export function invalidateCreditorProjections(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: queryKeys.creditors.all })
  qc.invalidateQueries({ queryKey: queryKeys.creditors.capital })
  qc.invalidateQueries({ queryKey: queryKeys.creditors.monthlyDue })
  qc.invalidateQueries({ queryKey: queryKeys.creditorInvestments.all })
  qc.invalidateQueries({ queryKey: queryKeys.locationBalances.all })
  qc.invalidateQueries({ queryKey: queryKeys.reports.balanceSheet() })
}
