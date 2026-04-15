import { randomUUID } from "crypto"
import { db } from "@/lib/db"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { eq, and } from "drizzle-orm"
import { postJournalEntry, reverseInterestAccrual } from "./transaction.service"
import { shortId } from "@/lib/utils"

type DrizzleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

type CategoryType = "asset" | "liability" | "equity" | "revenue" | "expense"

async function getOrCreateCategory(
  tx: DrizzleTransaction,
  name: string,
  type: CategoryType
): Promise<string> {
  const [existing] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, name),
        eq(transactionCategories.type, type)
      )
    )
  if (existing) return existing.id

  const [created] = await tx
    .insert(transactionCategories)
    .values({ name, type, isDefault: true })
    .onConflictDoNothing()
    .returning()

  if (created) return created.id

  // Re-fetch if conflict occurred (concurrent insert)
  const [refetched] = await tx
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.name, name),
        eq(transactionCategories.type, type)
      )
    )
  return refetched.id
}

export async function autoPostInterestEarned(
  tx: DrizzleTransaction,
  params: { amount: string; loanId: string; paymentId: string; paymentDate: string; actorId: string; depositLocation?: "cash" | "bank" | "strong_room"; subLocationId?: string }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Cash", type: "asset" },
    creditCategory: { name: "Interest Earned", type: "revenue" },
    amount: params.amount, referenceType: "payment", referenceId: params.paymentId,
    description: `Interest earned - loan ${params.loanId} payment ${params.paymentId}`,
    transactionDate: new Date(params.paymentDate), recordedBy: params.actorId,
    debitDepositLocation: params.depositLocation,
    debitSubLocationId: params.subLocationId,
    loanId: params.loanId,
  })
}

export async function autoPostInterestExpense(
  tx: DrizzleTransaction,
  params: { amount: string; investmentId: string; repaymentId?: string; repaymentDate: string; actorId: string; sourceLocation?: "cash" | "bank" | "strong_room"; subLocationId?: string }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Interest Payments", type: "expense" },
    creditCategory: { name: "Cash", type: "asset" },
    amount: params.amount, referenceType: "creditor_repayment", referenceId: params.repaymentId ?? params.investmentId,
    description: `Interest paid - investment ${params.investmentId}`,
    transactionDate: new Date(params.repaymentDate), recordedBy: params.actorId,
    creditDepositLocation: params.sourceLocation,
    creditSubLocationId: params.subLocationId,
  })
}

export async function autoPostPrincipalDisbursement(
  tx: DrizzleTransaction,
  params: { amount: string; loanId: string; transactionDate: string; actorId: string; depositLocation?: "cash" | "bank" | "strong_room"; subLocationId?: string }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Loans Receivable", type: "asset" },
    creditCategory: { name: "Cash", type: "asset" },
    amount: params.amount, referenceType: "loan", referenceId: params.loanId,
    description: `Principal disbursed - loan ${shortId(params.loanId).toUpperCase()}`,
    transactionDate: new Date(params.transactionDate), recordedBy: params.actorId,
    creditDepositLocation: params.depositLocation,
    creditSubLocationId: params.subLocationId,
    loanId: params.loanId,
  })
}

export async function autoPostRolloverPrincipalTransfer(
  tx: DrizzleTransaction,
  params: {
    amount: string
    newLoanId: string
    oldLoanId: string
    transactionDate: Date
    actorId: string
  }
): Promise<void> {
  const journalGroupId = randomUUID()
  const categoryId = await getOrCreateCategory(tx, "Loans Receivable", "asset")

  // DR Loans Receivable (new loan) — increases new loan's receivable
  await tx.insert(transactions).values({
    type: "debit",
    amount: params.amount,
    categoryId,
    referenceType: "rollover",
    referenceId: params.oldLoanId,
    loanId: params.newLoanId,
    description: `Principal carried from loan ${shortId(params.oldLoanId).toUpperCase()}`,
    transactionDate: params.transactionDate,
    recordedBy: params.actorId,
    journalGroupId,
  })

  // CR Loans Receivable (old loan) — decreases old loan's receivable
  await tx.insert(transactions).values({
    type: "credit",
    amount: params.amount,
    categoryId,
    referenceType: "rollover",
    referenceId: params.newLoanId,
    loanId: params.oldLoanId,
    description: `Principal transferred to loan ${shortId(params.newLoanId).toUpperCase()}`,
    transactionDate: params.transactionDate,
    recordedBy: params.actorId,
    journalGroupId,
  })
}

export async function autoPostPrincipalRepayment(
  tx: DrizzleTransaction,
  params: { amount: string; loanId: string; paymentId: string; paymentDate: string; actorId: string; depositLocation?: "cash" | "bank" | "strong_room"; subLocationId?: string }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Cash", type: "asset" },
    creditCategory: { name: "Loans Receivable", type: "asset" },
    amount: params.amount, referenceType: "payment", referenceId: params.paymentId,
    description: `Principal repaid - loan ${shortId(params.loanId).toUpperCase()} payment ${shortId(params.paymentId).toUpperCase()}`,
    transactionDate: new Date(params.paymentDate), recordedBy: params.actorId,
    debitDepositLocation: params.depositLocation,
    debitSubLocationId: params.subLocationId,
    loanId: params.loanId,
  })
}

export async function autoPostPrincipalRecovery(
  tx: DrizzleTransaction,
  params: { amount: string; loanId: string; transactionDate: string; actorId: string }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Seized Collateral", type: "asset" },
    creditCategory: { name: "Loans Receivable", type: "asset" },
    amount: params.amount, referenceType: "collateral_settlement", referenceId: params.loanId,
    description: `Principal recovered via collateral - loan ${shortId(params.loanId).toUpperCase()}`,
    transactionDate: new Date(params.transactionDate), recordedBy: params.actorId,
    loanId: params.loanId,
  })
}

export async function autoPostCreditorInvestment(
  tx: DrizzleTransaction,
  params: { amount: string; investmentId: string; investmentDate: string; actorId: string; depositLocation?: "cash" | "bank" | "strong_room"; subLocationId?: string }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Cash", type: "asset" },
    creditCategory: { name: "Creditor Investment", type: "liability" },
    amount: params.amount, referenceType: "creditor_investment", referenceId: params.investmentId,
    description: `Creditor investment received - ${shortId(params.investmentId).toUpperCase()}`,
    transactionDate: new Date(params.investmentDate), recordedBy: params.actorId,
    debitDepositLocation: params.depositLocation,
    debitSubLocationId: params.subLocationId,
  })
}

export async function autoPostCreditorPrincipalRepaid(
  tx: DrizzleTransaction,
  params: { amount: string; investmentId: string; repaymentId?: string; repaymentDate: string; actorId: string; sourceLocation?: "cash" | "bank" | "strong_room"; subLocationId?: string }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Creditor Investment", type: "liability" },
    creditCategory: { name: "Cash", type: "asset" },
    amount: params.amount, referenceType: "creditor_repayment", referenceId: params.repaymentId ?? params.investmentId,
    description: `Creditor principal repaid - investment ${shortId(params.investmentId).toUpperCase()}`,
    transactionDate: new Date(params.repaymentDate), recordedBy: params.actorId,
    creditDepositLocation: params.sourceLocation,
    creditSubLocationId: params.subLocationId,
  })
}

/**
 * Post a rate-change accrual adjustment that resets the accrual baseline.
 * Reverses any outstanding Interest Receivable for the loan, so the next
 * accrual run picks up from the new rate cleanly.
 */
export async function autoPostRateChangeAdjustment(
  tx: DrizzleTransaction,
  params: { loanId: string; oldRate: string; newRate: string; actorId: string }
): Promise<void> {
  // Reverse any outstanding interest accrual for this loan
  await reverseInterestAccrual(tx, {
    loanId: params.loanId,
    paymentDate: new Date().toISOString(),
    actorId: params.actorId,
  })
}

export async function autoPostFundTransfer(
  tx: DrizzleTransaction,
  params: { amount: string; transferId: string; fromLocation: "cash" | "bank" | "strong_room"; toLocation: "cash" | "bank" | "strong_room"; transactionDate: string; actorId: string; fromSubLocationId?: string; toSubLocationId?: string }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Cash", type: "asset" },
    creditCategory: { name: "Cash", type: "asset" },
    amount: params.amount, referenceType: "fund_transfer", referenceId: params.transferId,
    description: `Fund transfer from ${params.fromLocation} to ${params.toLocation}`,
    transactionDate: new Date(params.transactionDate), recordedBy: params.actorId,
    debitDepositLocation: params.toLocation, creditDepositLocation: params.fromLocation,
    debitSubLocationId: params.toSubLocationId,
    creditSubLocationId: params.fromSubLocationId,
  })
}

export async function autoPostCapitalInjection(
  tx: DrizzleTransaction,
  params: { amount: string; transferId: string; toLocation: "cash" | "bank" | "strong_room"; transactionDate: string; actorId: string; subLocationId?: string }
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Cash", type: "asset" },
    creditCategory: { name: "Share Capital", type: "equity" },
    amount: params.amount, referenceType: "capital_injection", referenceId: params.transferId,
    description: `Capital injection to ${params.toLocation}`,
    transactionDate: new Date(params.transactionDate), recordedBy: params.actorId,
    debitDepositLocation: params.toLocation,
    debitSubLocationId: params.subLocationId,
  })
}
