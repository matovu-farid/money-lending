import { randomUUID } from "crypto"
import BigNumber from "bignumber.js"
import { db } from "@/lib/db"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { loans } from "@/lib/db/schema/loans"
import { eq, and, inArray } from "drizzle-orm"
import { postJournalEntry } from "./transaction.service"
import { shortId } from "@/lib/utils"
import { buildLoanStatement } from "@/lib/loan-statement"

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

/**
 * Post the portion of a payment that exceeds the loan's interest and
 * principal balance as business revenue, or reverse that entry.
 */
export async function autoPostPaymentOverpayment(
  tx: DrizzleTransaction,
  params: {
    amount: string
    loanId: string
    paymentId: string
    paymentDate: string
    actorId: string
    depositLocation?: "cash" | "bank" | "strong_room"
    subLocationId?: string
    reversal?: boolean
  },
): Promise<void> {
  const reversal = params.reversal === true
  await postJournalEntry(tx, {
    debitCategory: reversal
      ? { name: "Overpayment Revenue", type: "revenue" }
      : { name: "Cash", type: "asset" },
    creditCategory: reversal
      ? { name: "Cash", type: "asset" }
      : { name: "Overpayment Revenue", type: "revenue" },
    amount: params.amount,
    referenceType: reversal ? "payment_reversal" : "payment",
    referenceId: params.paymentId,
    description: reversal
      ? `Reversal - payment overpayment ${params.paymentId}`
      : `Payment overpayment revenue - ${params.paymentId}`,
    transactionDate: new Date(params.paymentDate),
    recordedBy: params.actorId,
    debitDepositLocation: reversal ? undefined : params.depositLocation,
    debitSubLocationId: reversal ? undefined : params.subLocationId,
    creditDepositLocation: reversal ? params.depositLocation : undefined,
    creditSubLocationId: reversal ? params.subLocationId : undefined,
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

/** Non-cash interest write-down: DR Loan Losses / CR Interest Earned */
export async function autoPostLoanWaiverInterest(
  tx: DrizzleTransaction,
  params: {
    amount: string;
    loanId: string;
    waiverId: string;
    waiverDate: string;
    actorId: string;
  },
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Loan Losses", type: "expense" },
    creditCategory: { name: "Interest Earned", type: "revenue" },
    amount: params.amount,
    referenceType: "loan_waiver",
    referenceId: params.waiverId,
    description: `Interest waived - loan ${shortId(params.loanId).toUpperCase()}`,
    transactionDate: new Date(params.waiverDate),
    recordedBy: params.actorId,
    loanId: params.loanId,
  });
}

/** Non-cash principal write-down: DR Loan Losses / CR Loans Receivable */
export async function autoPostLoanWaiverPrincipal(
  tx: DrizzleTransaction,
  params: {
    amount: string;
    loanId: string;
    waiverId: string;
    waiverDate: string;
    actorId: string;
  },
): Promise<void> {
  await postJournalEntry(tx, {
    debitCategory: { name: "Loan Losses", type: "expense" },
    creditCategory: { name: "Loans Receivable", type: "asset" },
    amount: params.amount,
    referenceType: "loan_waiver",
    referenceId: params.waiverId,
    description: `Principal waived - loan ${shortId(params.loanId).toUpperCase()}`,
    transactionDate: new Date(params.waiverDate),
    recordedBy: params.actorId,
    loanId: params.loanId,
  });
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

/** Reconcile non-cash accruals to the corrected statement inside the rate transaction. */
export async function autoPostRateChangeAdjustment(
  tx: DrizzleTransaction,
  params: { loanId: string; oldRate: string; newRate: string; actorId: string; correctionId: string }
): Promise<void> {
  const [loan] = await tx.select().from(loans).where(eq(loans.id, params.loanId))
  if (!loan || loan.interestRateOverride !== params.newRate) {
    throw new Error("Rate-correction loan does not match the applied rate")
  }
  const now = new Date()
  const target = new BigNumber(buildLoanStatement({ loan, payments: [], today: now })
    .finalState.cumulativeInterestAccrued)
  const rows = await tx.select({
    type: transactions.type,
    amount: transactions.amount,
    categoryName: transactionCategories.name,
    journalGroupId: transactions.journalGroupId,
  }).from(transactions)
    .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
    .where(and(
      inArray(transactions.referenceType, ["interest_accrual", "penalty_interest_accrual",
        "portfolio_accrual_repair"]),
      eq(transactions.loanId, params.loanId),
    ))

  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    if (!row.journalGroupId) throw new Error("Unpaired interest accrual journal needs review")
    const group = groups.get(row.journalGroupId) ?? []
    group.push(row)
    groups.set(row.journalGroupId, group)
  }
  for (const group of groups.values()) {
    const receivable = group.find((row) => row.categoryName === "Interest Receivable")
    const earned = group.find((row) => row.categoryName === "Interest Earned")
    if (group.length !== 2 || !receivable || !earned ||
        receivable.amount !== earned.amount || receivable.type === earned.type) {
      throw new Error("Unbalanced interest accrual journal needs review")
    }
  }

  const posted = rows.filter((row) => row.categoryName === "Interest Receivable")
    .reduce((sum, row) => sum.plus(row.type === "debit" ? row.amount : `-${row.amount}`), new BigNumber(0))
  const delta = target.minus(posted)
  if (delta.isZero()) return
  const increasing = delta.isGreaterThan(0)
  await postJournalEntry(tx, {
    debitCategory: increasing
      ? { name: "Interest Receivable", type: "asset" }
      : { name: "Interest Earned", type: "revenue" },
    creditCategory: increasing
      ? { name: "Interest Earned", type: "revenue" }
      : { name: "Interest Receivable", type: "asset" },
    amount: delta.abs().toFixed(2),
    referenceType: "interest_accrual",
    referenceId: params.loanId,
    loanId: params.loanId,
    description: `Rate correction ${params.correctionId} accrual - loan ${shortId(params.loanId).toUpperCase()}`,
    transactionDate: now,
    recordedBy: params.actorId,
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
