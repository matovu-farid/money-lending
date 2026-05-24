// Shared types for cy.task() return shapes. Cypress's chainable `task()` API
// is loosely typed (returns `unknown` by default), so we declare the shapes
// each task hands back so spec files can type-narrow without `any`.

export type DbLoanRow = {
  id: string
  customer_id: string
  principal_amount: string
  interest_rate: string
  status: string
  penalty_waived: boolean
  penalty_multiplier: string | null
}

export type DbCustomerRow = {
  id: string
  full_name: string
  contact: string
  address: string
  status: string
}

export type DbPaymentRow = {
  id: string
  loan_id: string
  amount: string
  payment_date: string | Date
  recorded_by: string
  deleted_at: string | Date | null
}

export type DbInvitationRow = {
  id: string
  email: string
  name: string | null
  role: string
  status: string
  token: string
  expires_at: string | Date
  created_at: string | Date
}

export type DbUserRoleRow = {
  role: string | null
  emailVerified: boolean
}

export type DbSeedCustomerAndLoanResult = {
  customerId: string
  loanId: string
}

export type DbSeedPaymentResult = {
  paymentId: string
}

export type DbLoanBalanceRow = {
  outstanding_balance: string
  unpaid_interest: string
  last_payment_date: string | Date | null
}

export type SessionCookie = {
  name: string
  value: string
  domain?: string | null
  path?: string | null
  httpOnly?: boolean | null
  secure?: boolean | null
  sameSite?: string | null
}

export type CreateTestUserResult = {
  email: string
  userId: string
  role: string
  cookies: SessionCookie[]
}

// `createTestUser` Cypress command returns this shape (cookies stored on `_cookies`).
export type CreatedTestUser = {
  email: string
  userId: string
  role: string
  _cookies: SessionCookie[]
}
