export { customerCollection } from "./customers"
export { loanCollection, insertLoanWithInput } from "./loans"
export { paymentCollection } from "./payments"
export { expenseCollection } from "./expenses"
export { incomeCollection } from "./income"
export { creditorCollection } from "./creditors"
export { creditorInvestmentCollection } from "./creditor-investments"
export { creditorRepaymentCollection } from "./creditor-repayments"
export { fundTransferCollection } from "./fund-transfers"
export { rateChangeRequestCollection } from "./rate-change-requests"
export { delegationCollection, type DelegationRow } from "./delegations"
export { invitationCollection, type InvitationRow } from "./invitations"

// --- New read-only collections ---
export {
  portfolioCollection,
  transactionReportCollection,
  getPnlCollection,
  getBalanceSheetCollection,
  getRetainedEarningsCollection,
  type PortfolioRow,
  type TransactionReportRow,
  type TransactionReportData,
  type PnlRow,
  type BalanceSheetRow,
  type RetainedEarningsRow,
} from "./reports"

export {
  dashboardCollection,
  dashboardActivityCollection,
  type DashboardData,
  type DashboardRow,
  type DashboardActivityRow,
} from "./dashboard"

export {
  getActivitiesCollection,
  ACTIVITIES_PAGE_SIZE,
  type ActivityFilterParams,
  type ActivitiesRow,
} from "./activities"

export {
  getDailyCollectionsCollection,
  loansDueTodayCollection,
  type DailyCollectionsRow,
  type LoanDueTodayRow,
} from "./daily-collections"

export { adminUserCollection, type AdminUser } from "./admin-users"

export { permissionsCollection, type PermissionsRow } from "./permissions"

export { getLoanBalanceCollection, type LoanBalanceRow } from "./loan-balance"

export {
  collateralNaturesCollection,
  locationBalancesCollection,
  currentUserRoleCollection,
  getUserNameMapCollection,
  getLoanCollateralCollection,
  getActiveLoanCheckCollection,
  getPaymentPortionsCollection,
} from "./loan-extras"

export { expenseCategoryCollection } from "./expense-categories"
export { incomeCategoryCollection } from "./income-categories"

export {
  systemCapitalCollection,
  creditorMonthlyDueCollection,
  getCreditorDashboardCollection,
  getCreditorMonthlySummaryCollection,
  getCreditorRepaymentPortionsCollection,
} from "./creditor-extras"

export { bankAccountCollection } from "./bank-accounts"
