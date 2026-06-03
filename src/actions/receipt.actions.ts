"use server"

import { eq } from "drizzle-orm"
import { withAction } from "@/lib/with-action"
import { checkPermission } from "@/lib/action-utils"
import { db } from "@/lib/db"
import { transactions } from "@/lib/db/schema/transactions"
import { creditors } from "@/lib/db/schema/creditors"
import { creditorInvestments } from "@/lib/db/schema/creditor-investments"
import { creditorRepayments } from "@/lib/db/schema/creditor-repayments"
import { fundTransfers } from "@/lib/db/schema/fund-transfers"
import { bankAccounts } from "@/lib/db/schema/bank-accounts"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { user } from "@/lib/db/schema/auth"
import { shortId } from "@/lib/utils"
import type { TransactionReceiptData } from "@/components/receipts/pos-receipt-transaction"
import { getCreditorRepaymentPortionsFromLedger } from "@/services/ledger-queries.service"
import type { Permission } from "@/types"

export type ReceiptInput =
  | { kind: "expense"; transactionId: string }
  | { kind: "income"; transactionId: string }
  | { kind: "creditor_investment"; investmentId: string }
  | { kind: "creditor_repayment"; repaymentId: string }
  | { kind: "fund_transfer"; transferId: string }
  | { kind: "collateral_settlement"; loanId: string }

/**
 * Per-kind permission gate. Mirrors the entity-level access policy:
 * creditor data is admin-only (`creditor:read`), fund transfers require
 * supervisor (`fund-transfer:read`), and the rest follow their record's
 * read permission.
 */
const KIND_PERMISSIONS = {
  expense: "expense:read",
  income: "income:read",
  creditor_investment: "creditor:read",
  creditor_repayment: "creditor:read",
  fund_transfer: "fund-transfer:read",
  collateral_settlement: "loan:read",
} as const satisfies Record<ReceiptInput["kind"], string>

function formatLocation(loc: string | null | undefined, bankName?: string | null) {
  if (!loc) return undefined
  if (loc === "bank") return `Bank — ${bankName ?? "Unspecified"}`
  if (loc === "strong_room") return "Strong Room"
  return "Cash on Hand"
}

async function resolveActorName(userId: string | null | undefined): Promise<string> {
  if (!userId) return "Officer"
  const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId))
  return row?.name ?? "Officer"
}

async function resolveBankName(subLocationId: string | null | undefined): Promise<string | null> {
  if (!subLocationId) return null
  const [row] = await db.select({ name: bankAccounts.name }).from(bankAccounts).where(eq(bankAccounts.id, subLocationId))
  return row?.name ?? null
}

async function buildExpenseReceipt(transactionId: string): Promise<TransactionReceiptData | { error: string }> {
  const [tx] = await db.select().from(transactions).where(eq(transactions.id, transactionId))
  if (!tx) return { error: "Transaction not found" }
  const [actor, bankName] = await Promise.all([
    resolveActorName(tx.recordedBy),
    resolveBankName(tx.subLocationId),
  ])
  return {
    receiptNumber: `EXP-${shortId(tx.id).toUpperCase()}`,
    date: tx.transactionDate.toISOString(),
    headerTitle: "Expense",
    subtitle: tx.category ?? undefined,
    amount: tx.amount,
    actorName: actor,
    location: formatLocation(tx.depositLocation, bankName),
    notes: tx.description ?? undefined,
  }
}

async function buildIncomeReceipt(transactionId: string): Promise<TransactionReceiptData | { error: string }> {
  const [tx] = await db.select().from(transactions).where(eq(transactions.id, transactionId))
  if (!tx) return { error: "Transaction not found" }
  const [actor, bankName] = await Promise.all([
    resolveActorName(tx.recordedBy),
    resolveBankName(tx.subLocationId),
  ])
  return {
    receiptNumber: `INC-${shortId(tx.id).toUpperCase()}`,
    date: tx.transactionDate.toISOString(),
    headerTitle: "Income",
    subtitle: tx.category ?? undefined,
    amount: tx.amount,
    actorName: actor,
    location: formatLocation(tx.depositLocation, bankName),
    notes: tx.description ?? undefined,
  }
}

async function buildCreditorInvestmentReceipt(investmentId: string): Promise<TransactionReceiptData | { error: string }> {
  const [inv] = await db.select().from(creditorInvestments).where(eq(creditorInvestments.id, investmentId))
  if (!inv) return { error: "Investment not found" }
  const [[cred], actor] = await Promise.all([
    db.select().from(creditors).where(eq(creditors.id, inv.creditorId)),
    resolveActorName(inv.recordedBy),
  ])
  return {
    receiptNumber: `INV-${shortId(inv.id).toUpperCase()}`,
    date: inv.investmentDate.toISOString(),
    headerTitle: "Creditor Investment Received",
    amount: inv.amount,
    counterpartyLabel: "Received from",
    counterpartyName: cred?.name,
    counterpartyContact: cred?.contact ?? undefined,
    breakdownLines: [
      { label: "Rate", value: `${(Number(inv.interestRateMonthly) * 100).toFixed(1)}%/mo` },
    ],
    actorName: actor,
    showSignature: true,
  }
}

async function buildCreditorRepaymentReceipt(repaymentId: string): Promise<TransactionReceiptData | { error: string }> {
  const [rep] = await db.select().from(creditorRepayments).where(eq(creditorRepayments.id, repaymentId))
  if (!rep) return { error: "Repayment not found" }
  const [[inv], actor, portions] = await Promise.all([
    db.select().from(creditorInvestments).where(eq(creditorInvestments.id, rep.investmentId)),
    resolveActorName(rep.recordedBy),
    getCreditorRepaymentPortionsFromLedger([rep.id]),
  ])
  if (!inv) return { error: "Investment not found" }
  const [cred] = await db.select().from(creditors).where(eq(creditors.id, inv.creditorId))
  const split = portions.get(rep.id)
  const breakdown: { label: string; value: string }[] = []
  if (split && Number(split.interestPortion) > 0) {
    breakdown.push({ label: "Interest", value: split.interestPortion })
  }
  if (split && Number(split.principalPortion) > 0) {
    breakdown.push({ label: "Principal", value: split.principalPortion })
  }
  return {
    receiptNumber: `REP-${shortId(rep.id).toUpperCase()}`,
    date: rep.repaymentDate.toISOString(),
    headerTitle: "Creditor Repayment",
    amount: rep.amount,
    counterpartyLabel: "Paid to",
    counterpartyName: cred?.name,
    counterpartyContact: cred?.contact ?? undefined,
    breakdownLines: breakdown,
    actorName: actor,
    showSignature: true,
  }
}

async function buildFundTransferReceipt(transferId: string): Promise<TransactionReceiptData | { error: string }> {
  const [t] = await db.select().from(fundTransfers).where(eq(fundTransfers.id, transferId))
  if (!t) return { error: "Transfer not found" }
  const [actor, fromBankName, toBankName] = await Promise.all([
    resolveActorName(t.transferredBy),
    resolveBankName(t.fromSubLocationId),
    resolveBankName(t.toSubLocationId),
  ])
  const isCapitalInjection = t.transferType === "capital_injection"
  const breakdown: { label: string; value: string }[] = []
  if (t.fromLocation) breakdown.push({ label: "From", value: formatLocation(t.fromLocation, fromBankName) ?? t.fromLocation })
  if (t.toLocation) breakdown.push({ label: "To", value: formatLocation(t.toLocation, toBankName) ?? t.toLocation })
  return {
    receiptNumber: `${isCapitalInjection ? "INJ" : "FT"}-${shortId(t.id).toUpperCase()}`,
    date: t.createdAt.toISOString(),
    headerTitle: isCapitalInjection ? "Capital Injection" : "Fund Transfer",
    amount: t.amount,
    breakdownLines: breakdown,
    actorName: actor,
    notes: t.note ?? undefined,
  }
}

async function buildSettlementReceipt(loanId: string): Promise<TransactionReceiptData | { error: string }> {
  const [loan] = await db.select().from(loans).where(eq(loans.id, loanId))
  if (!loan) return { error: "Loan not found" }
  const [[cust], actor, settlementRows] = await Promise.all([
    db.select().from(customers).where(eq(customers.id, loan.customerId)),
    resolveActorName(loan.issuedBy),
    db.select().from(transactions).where(eq(transactions.referenceId, loanId)),
  ])
  const settlementTx = settlementRows.find((r) => r.referenceType === "collateral_settlement")
  if (!settlementTx) return { error: "Settlement record not found" }
  return {
    receiptNumber: `STL-${shortId(loanId).toUpperCase()}`,
    date: settlementTx.transactionDate.toISOString(),
    headerTitle: "Collateral Settlement",
    subtitle: `Loan ${shortId(loanId).toUpperCase()}`,
    amount: settlementTx.amount,
    counterpartyLabel: "Customer",
    counterpartyName: cust?.fullName,
    counterpartyContact: cust?.contact ?? undefined,
    actorName: actor,
    notes: settlementTx.description ?? "Loan settled via collateral",
    showSignature: true,
  }
}

async function dispatchReceipt(input: ReceiptInput): Promise<TransactionReceiptData | { error: string }> {
  switch (input.kind) {
    case "expense":
      return buildExpenseReceipt(input.transactionId)
    case "income":
      return buildIncomeReceipt(input.transactionId)
    case "creditor_investment":
      return buildCreditorInvestmentReceipt(input.investmentId)
    case "creditor_repayment":
      return buildCreditorRepaymentReceipt(input.repaymentId)
    case "fund_transfer":
      return buildFundTransferReceipt(input.transferId)
    case "collateral_settlement":
      return buildSettlementReceipt(input.loanId)
  }
}

/**
 * Returns normalized receipt data for any money-movement event.
 *
 * Permission is checked per-kind: creditor receipts require `creditor:read`
 * (admin-only), expense/income/fund-transfer/settlement gate against their
 * own record-read perms. withAction binds a single permission up front, so
 * we use `loan:read` as the baseline "any-staff" gate and re-check the
 * kind-specific perm inside. Without this, a loan officer who only has
 * `loan:read` could pull creditor names/contacts via a direct action call,
 * bypassing the page-level and Electric-proxy gates.
 */
export const getTransactionReceiptDataAction = withAction<
  ReceiptInput,
  { data: TransactionReceiptData } | { error: string }
>({
  permission: "loan:read",
  action: async (session, input) => {
    const required = KIND_PERMISSIONS[input.kind] as Permission
    const forbidden = await checkPermission(session, required)
    if (forbidden) return { error: forbidden }

    const result = await dispatchReceipt(input)
    if ("error" in result) return { error: result.error }
    return { data: result }
  },
})
