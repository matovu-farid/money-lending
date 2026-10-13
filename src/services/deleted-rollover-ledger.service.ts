import { createHash } from "node:crypto"
import { and, eq, inArray, or } from "drizzle-orm"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { loanWaivers } from "@/lib/db/schema/loan-waivers"
import { rateChangeRequests } from "@/lib/db/schema/rate-change-requests"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { auditLog } from "@/lib/db/schema/audit"
import type { DeletedRolloverSource } from "@/lib/financial-corrections/deleted-rollover-ledger"

type QueryDb = Pick<typeof db, "select">

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

/** Load every source row and both sides of every journal group touching the chain. */
export async function loadDeletedRolloverSource(
  predecessorId: string,
  queryDb: QueryDb = db,
): Promise<DeletedRolloverSource> {
  const [predecessor] = await queryDb.select().from(loans).where(eq(loans.id, predecessorId))
  if (!predecessor) throw new Error(`Predecessor ${predecessorId} does not exist`)
  const successors = await queryDb.select().from(loans)
    .where(eq(loans.rolledOverFrom, predecessorId))
  if (successors.length !== 1) {
    throw new Error(`Expected one successor for ${predecessorId}; found ${successors.length}`)
  }
  const successor = successors[0]
  const grandchildren = await queryDb.select({ id: loans.id }).from(loans)
    .where(eq(loans.rolledOverFrom, successor.id)).limit(1)
  if (grandchildren.length) {
    throw new Error("Deleted successor has a further rollover successor")
  }
  const loanIds = [predecessor.id, successor.id]
  const [paymentRows, waiverRows, rateRows, auditRows] = await Promise.all([
    queryDb.select().from(payments).where(inArray(payments.loanId, loanIds)),
    queryDb.select().from(loanWaivers).where(inArray(loanWaivers.loanId, loanIds)),
    queryDb.select().from(rateChangeRequests)
      .where(inArray(rateChangeRequests.loanId, loanIds)),
    queryDb.select().from(auditLog).where(and(
      eq(auditLog.entityType, "loan"), inArray(auditLog.entityId, loanIds))),
  ])
  const references = [...loanIds, ...paymentRows.map((row) => row.id),
    ...waiverRows.map((row) => row.id)]
  const directJournalRows = await queryDb.select().from(transactions).where(or(
    inArray(transactions.loanId, loanIds),
    inArray(transactions.referenceId, references),
  ))
  const groupIds = [...new Set(directJournalRows
    .map((row) => row.journalGroupId).filter((id): id is string => id !== null))]
  const groupRows = groupIds.length
    ? await queryDb.select().from(transactions)
      .where(inArray(transactions.journalGroupId, groupIds))
    : []
  const journalRows = [...new Map([...directJournalRows, ...groupRows]
    .map((row) => [row.id, row])).values()].sort((a, b) => a.id.localeCompare(b.id))
  const categoryIds = [...new Set(journalRows.map((row) => row.categoryId))]
  const categoryRows = categoryIds.length
    ? await queryDb.select().from(transactionCategories)
      .where(inArray(transactionCategories.id, categoryIds))
    : []
  const categoryById = new Map(categoryRows.map((row) => [row.id, row]))
  const sortById = <T extends { id: string }>(rows: T[]) =>
    [...rows].sort((a, b) => a.id.localeCompare(b.id))
  const fullSourceDigest = digest({
    loans: sortById([predecessor, successor]),
    payments: sortById(paymentRows),
    waivers: sortById(waiverRows),
    rateChanges: sortById(rateRows),
    journals: journalRows,
    categories: sortById(categoryRows),
    audits: sortById(auditRows),
  })
  return {
    fullSourceDigest,
    predecessor: { id: predecessor.id, rolledOverFrom: predecessor.rolledOverFrom,
      startDate: predecessor.startDate, deletedAt: predecessor.deletedAt },
    successor: { id: successor.id, rolledOverFrom: successor.rolledOverFrom,
      startDate: successor.startDate, deletedAt: successor.deletedAt },
    payments: paymentRows.map((row) => ({ id: row.id, loanId: row.loanId,
      deletedAt: row.deletedAt, markedWrong: row.markedWrong })),
    waivers: waiverRows.map((row) => ({ id: row.id, loanId: row.loanId,
      deletedAt: row.deletedAt })),
    rateChanges: rateRows.map((row) => ({ id: row.id, loanId: row.loanId,
      status: row.status })),
    journals: journalRows.map((row) => ({
      id: row.id, journalGroupId: row.journalGroupId, loanId: row.loanId,
      referenceType: row.referenceType, referenceId: row.referenceId,
      categoryName: categoryById.get(row.categoryId)?.name ?? "UNKNOWN",
      categoryType: categoryById.get(row.categoryId)?.type ?? "UNKNOWN",
      type: row.type, amount: row.amount,
      transactionDate: row.transactionDate, createdAt: row.createdAt,
    })),
    audits: auditRows.map((row) => ({ action: row.action,
      entityId: row.entityId, occurredAt: row.occurredAt,
      afterValue: row.afterValue })),
  }
}
