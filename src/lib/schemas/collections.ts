/**
 * Zod schemas for TanStack DB collections.
 *
 * **Why these exist:** Electric pushes wire-shape data to the client where the
 * compile-time Drizzle types lie about runtime — `timestamp` columns become
 * ISO strings, not `Date` objects, until something coerces them. Wiring these
 * schemas into the `schema:` option on Electric/Query collections gives us:
 *
 *   1. Centralized Date coercion (no more `x instanceof Date ? x : new Date(x)`)
 *   2. Standard-Schema-compatible runtime validation that catches server/client
 *      drift the moment it appears
 *   3. Type inference that matches what consumers actually receive
 *
 * **Coercion policy:**
 *   - `timestamp` → `z.coerce.date()` via `createSchemaFactory({ coerce: { date: true } })`
 *   - `numeric` → kept as `string` (preserves precision; values are BigNumber inputs)
 *   - `boolean` → kept as boolean (server returns native bool)
 *   - `uuid` → string (Electric proxy doesn't validate UUID shape, just preserves it)
 */

import { createSchemaFactory } from "drizzle-zod"
import {
  payments,
  customers,
  loans,
  loanBalances,
  bankAccounts,
  creditors,
  creditorInvestments,
  creditorRepayments,
  fundTransfers,
  transactions,
  rateChangeRequests,
  delegations,
  invitations,
} from "@/lib/db/schema"

const factory = createSchemaFactory({ coerce: { date: true } })
const { createSelectSchema } = factory

// --- Electric-synced row schemas (wire shapes) ---------------------------

export const paymentSchema = createSelectSchema(payments)
export type PaymentRow = typeof paymentSchema._zod.output

export const customerSchema = createSelectSchema(customers)
export type CustomerRow = typeof customerSchema._zod.output

export const bankAccountSchema = createSelectSchema(bankAccounts)
export type BankAccountRow = typeof bankAccountSchema._zod.output

export const creditorSchema = createSelectSchema(creditors)
export type CreditorRow = typeof creditorSchema._zod.output

export const creditorInvestmentSchema = createSelectSchema(creditorInvestments)
export type CreditorInvestmentRow = typeof creditorInvestmentSchema._zod.output

export const creditorRepaymentSchema = createSelectSchema(creditorRepayments)
export type CreditorRepaymentRow = typeof creditorRepaymentSchema._zod.output

export const fundTransferSchema = createSelectSchema(fundTransfers)
export type FundTransferRow = typeof fundTransferSchema._zod.output

export const loanBalanceSchema = createSelectSchema(loanBalances)
export type LoanBalanceRow = typeof loanBalanceSchema._zod.output

// `transactions.category` is the source of truth for the user-typed label on
// manual income/expense rows. The base schema picks it up automatically; no
// client-only field needed.
export const transactionSchema = createSelectSchema(transactions)
export type TransactionRow = typeof transactionSchema._zod.output

export const rateChangeRequestSchema = createSelectSchema(rateChangeRequests)
export type RateChangeRequestRow = typeof rateChangeRequestSchema._zod.output

export const delegationSchema = createSelectSchema(delegations)
export type DelegationRow = typeof delegationSchema._zod.output

// Invitations: the Electric proxy explicitly omits `token` from the synced
// columns (see SAFE_COLUMNS in src/app/api/electric/[...table]/route.ts). The
// wire schema drops it so validation matches the actual payload.
export const invitationSchema = createSelectSchema(invitations).omit({ token: true })
export type InvitationRow = typeof invitationSchema._zod.output

// --- Loans (Query collection — server returns LoanListEntry which extends Loan) ---
// loans.ts collection enriches the row with `customerName`, `daysOverdue`,
// `outstandingBalance` etc. server-side, so we extend the base loan schema
// with those derived string/null fields.

export const loanRowSchema = createSelectSchema(loans)
export type LoanBaseRow = typeof loanRowSchema._zod.output
