export { customerCollection } from "./customers"
export { loanCollection, insertLoanWithInput, settleLoanWithCollateral } from "./loans"
export {
  paymentCollection,
  insertPaymentWithInput,
  updatePaymentWithInput,
  deletePaymentWithReason,
} from "./payments"
export { expenseCollection, insertExpenseWithInput } from "./expenses"
export { incomeCollection, insertIncomeWithInput } from "./income"
export { creditorCollection, insertCreditorWithInput } from "./creditors"
export { fundTransferCollection, insertFundTransferWithInput, insertCapitalInjectionWithInput } from "./fund-transfers"
export {
  rateChangeRequestCollection,
  insertRateChangeRequestWithInput,
  reviewRateChangeRequest,
} from "./rate-change-requests"
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
} from "./creditor-extras"

export {
  creditorsPageDataCollection,
  type CreditorsPageDataRow,
} from "./creditors-page-data"

export {
  bankAccountCollection,
  insertBankAccountWithInput,
  updateBankAccountWithInput,
} from "./bank-accounts"
