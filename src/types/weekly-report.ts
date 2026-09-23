/** A payment row is the same ledger-backed allocation shown on Payments. */
export type WeeklyPaymentsReportRow = {
  id: string;
  loanId: string;
  customerName: string;
  contactNumber: string;
  paymentDate: string;
  amount: string;
  interestPortion: string;
  principalPortion: string;
  principalBalanceAfter: string;
  depositLocation: string;
};

/** A weekly issuance row enriched with the current Loans-page balance projection. */
export type WeeklyLoansReportRow = {
  id: string;
  customerId: string;
  customerName: string;
  contactNumber: string;
  startDate: string;
  status: string;
  principalAmount: string;
  principalBalance: string;
  totalDue: string;
  accruedInterest: string;
  daysOverdue: number;
  lastPaymentDate: string;
};

export type WeeklyPaymentsReportData = {
  week: string;
  /** One timestamp shared by all calculated values in this response. */
  calculatedAt: string;
  count: number;
  total: string;
  rows: WeeklyPaymentsReportRow[];
};

export type WeeklyLoansReportData = {
  week: string;
  /** One timestamp shared by all calculated values in this response. */
  calculatedAt: string;
  count: number;
  total: string;
  rows: WeeklyLoansReportRow[];
};
