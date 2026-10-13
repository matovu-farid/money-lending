import { createHash } from "node:crypto"
import BigNumber from "bignumber.js"
import { and, eq, inArray, or } from "drizzle-orm"
import { db } from "@/lib/db"
import { auditLog } from "@/lib/db/schema/audit"
import { financialCorrectionAgentReviews } from "@/lib/db/schema/financial-correction-agent-reviews"
import { loans } from "@/lib/db/schema/loans"
import { loanWaivers } from "@/lib/db/schema/loan-waivers"
import { payments } from "@/lib/db/schema/payments"
import { paymentAllocationRepairRuns } from "@/lib/db/schema/payment-allocation-repair-runs"
import { portfolioAccrualRepairRuns } from "@/lib/db/schema/portfolio-accrual-repair-runs"
import { rateChangeRequests } from "@/lib/db/schema/rate-change-requests"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { hashReviewEvidence } from "@/lib/financial-corrections/agent-review"
import type { AppliedCorrectionProof, FullyPaidAllocationSnapshot, DepositLocation,
  OriginalJournalLeg } from
  "@/lib/interest/fully-paid-allocation-repair"
import { getLoanBalanceFromLedger, getPaymentPortionsFromLedger } from
  "./ledger-queries.service"

type QueryDb = Pick<typeof db, "select">

function jsonRecord(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null
  } catch { return null }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function iso(value: unknown): string {
  if (typeof value !== "string") return ""
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ""
}

function sum(rows: Array<{ amount: string }>): string {
  return rows.reduce((total, row) => total.plus(row.amount), new BigNumber(0)).toFixed(2)
}

/** Source assembly only; every fact is checked again by the pure planner and agent verifier. */
export async function loadFullyPaidAllocationSnapshot(
  loanId: string,
  asOf: Date,
  queryDb: QueryDb = db,
): Promise<FullyPaidAllocationSnapshot> {
  const [loan] = await queryDb.select().from(loans).where(eq(loans.id, loanId))
  if (!loan) throw new Error("Payment allocation loan not found")
  const [allPayments, waivers, successors, rates, loanAudits, correctionRuns,
    portfolioRuns] = await Promise.all([
    queryDb.select().from(payments).where(eq(payments.loanId, loanId)),
    queryDb.select().from(loanWaivers).where(eq(loanWaivers.loanId, loanId)),
    queryDb.select({ id: loans.id }).from(loans).where(eq(loans.rolledOverFrom, loanId)),
    queryDb.select().from(rateChangeRequests).where(eq(rateChangeRequests.loanId, loanId)),
    queryDb.select().from(auditLog).where(and(eq(auditLog.entityType, "loan"),
      eq(auditLog.entityId, loanId))),
    queryDb.select().from(paymentAllocationRepairRuns)
      .where(eq(paymentAllocationRepairRuns.loanId, loanId)),
    queryDb.select().from(portfolioAccrualRepairRuns)
      .where(eq(portfolioAccrualRepairRuns.loanId, loanId)),
  ])
  const correctionRun = correctionRuns.length === 1 ? correctionRuns[0] : null
  const [correctionReview] = correctionRun ? await queryDb.select()
    .from(financialCorrectionAgentReviews)
    .where(eq(financialCorrectionAgentReviews.id, correctionRun.agentReviewId)) : []
  const portfolioReviewIds = portfolioRuns.map((run) => run.agentReviewId)
    .filter((id): id is string => !!id)
  const portfolioReviews = portfolioReviewIds.length ? await queryDb.select()
    .from(financialCorrectionAgentReviews)
    .where(inArray(financialCorrectionAgentReviews.id, portfolioReviewIds)) : []
  const ids = allPayments.map((row) => row.id)
  const paymentAudits = ids.length ? await queryDb.select().from(auditLog).where(and(
    eq(auditLog.entityType, "payment"), inArray(auditLog.entityId, ids),
  )) : []
  const journalRows = await queryDb.select({
    id: transactions.id, loanId: transactions.loanId,
    referenceType: transactions.referenceType, referenceId: transactions.referenceId,
    journalGroupId: transactions.journalGroupId,
    date: transactions.transactionDate, side: transactions.type,
    amount: transactions.amount, account: transactionCategories.name,
    accountType: transactionCategories.type,
    description: transactions.description, recordedBy: transactions.recordedBy,
    createdAt: transactions.createdAt,
    depositLocation: transactions.depositLocation,
    subLocationId: transactions.subLocationId,
  }).from(transactions).innerJoin(transactionCategories,
    eq(transactions.categoryId, transactionCategories.id)).where(ids.length
      ? or(eq(transactions.loanId, loanId), inArray(transactions.referenceId, ids))
      : eq(transactions.loanId, loanId))
  const groupIds = [...new Set(journalRows.map((row) => row.journalGroupId)
    .filter((id): id is string => id !== null))]
  const groupRows = groupIds.length ? await queryDb.select({
    id: transactions.id, loanId: transactions.loanId,
    referenceType: transactions.referenceType, referenceId: transactions.referenceId,
    journalGroupId: transactions.journalGroupId,
    date: transactions.transactionDate, side: transactions.type,
    amount: transactions.amount, account: transactionCategories.name,
    accountType: transactionCategories.type,
    description: transactions.description, recordedBy: transactions.recordedBy,
    createdAt: transactions.createdAt,
    depositLocation: transactions.depositLocation,
    subLocationId: transactions.subLocationId,
  }).from(transactions).innerJoin(transactionCategories,
    eq(transactions.categoryId, transactionCategories.id))
    .where(inArray(transactions.journalGroupId, groupIds)) : []

  const activePayments = allPayments.filter((row) => !row.deletedAt && !row.markedWrong)
    .sort((a, b) => a.paymentDate.getTime() - b.paymentDate.getTime() ||
      a.id.localeCompare(b.id))
  const currentPortions = await getPaymentPortionsFromLedger(activePayments.map((row) => row.id),
    queryDb)
  const cashGroupIds = new Set(journalRows.filter((row) => row.account === "Cash" &&
    row.referenceType === "payment" && ids.includes(row.referenceId ?? ""))
    .map((row) => row.journalGroupId).filter((id): id is string => !!id))
  const originalJournalLegs: OriginalJournalLeg[] = groupRows
    .filter((row) => row.journalGroupId && cashGroupIds.has(row.journalGroupId))
    .map((row) => ({ id: row.id, groupId: row.journalGroupId!,
      paymentId: row.referenceId ?? "", loanId: row.loanId ?? "",
      referenceType: row.referenceType ?? "", effectiveAt: row.date.toISOString(),
      side: row.side, account: row.account,
      accountType: row.accountType as OriginalJournalLeg["accountType"],
      amount: row.amount, depositLocation: row.depositLocation as DepositLocation | null,
      subLocationId: row.subLocationId }))
  const originalByPayment = (paymentId: string) => originalJournalLegs.filter((row) =>
    row.paymentId === paymentId)
  const journalAllocations = activePayments.map((payment) => {
    const rows = originalByPayment(payment.id)
    const total = (name: string) => sum(rows.filter((row) => row.account === name &&
      row.side === "credit"))
    return { paymentId: payment.id, loanId, effectiveAt: payment.paymentDate.toISOString(),
      cash: sum(rows.filter((row) => row.account === "Cash" && row.side === "debit")),
      interest: total("Interest Earned"), principal: total("Loans Receivable"),
      overpayment: total("Overpayment Revenue"),
      groupIds: [...new Set(rows.map((row) => row.groupId))].sort() }
  })
  const loanCreates = loanAudits.filter((row) => row.action === "loan.create")
  const loanCreated = loanCreates.length === 1 ? jsonRecord(loanCreates[0].afterValue) : null
  const paymentCreates = activePayments.map((payment) => {
    const audits = paymentAudits.filter((row) => row.entityId === payment.id &&
      row.action === "payment.create")
    const created = audits.length === 1 ? jsonRecord(audits[0].afterValue) : null
    return { action: audits.length === 1 ? audits[0].action : "", beforeNull:
      audits.length === 1 && audits[0].beforeValue === null,
      paymentId: text(created?.id), loanId: text(created?.loanId),
      effectiveAt: iso(created?.paymentDate), amount: text(created?.amount),
      depositLocation: text(created?.depositLocation) as DepositLocation,
      subLocationId: typeof created?.subLocationId === "string"
        ? created.subLocationId : null }
  })
  const exceptionalAudits = [...loanAudits.filter((row) => row.action !== "loan.create"),
    ...paymentAudits.filter((row) => row.action !== "payment.create")]
  const extraPaymentJournals = journalRows.filter((row) =>
    row.referenceType === "payment" && ids.includes(row.referenceId ?? "") &&
    (!row.journalGroupId || !cashGroupIds.has(row.journalGroupId)))
    .map((row) => row.id).sort()
  const sourceExceptions: string[] = []
  if (journalRows.some((row) => row.loanId === loanId &&
      (row.referenceType === "payment" || row.referenceType === "payment_reversal") &&
      (!row.referenceId || !ids.includes(row.referenceId)))) {
    sourceExceptions.push("Loan has a payment journal without a loaded payment record")
  }
  if (correctionRuns.length > 1 || correctionRun && !correctionReview) {
    sourceExceptions.push("Payment allocation correction run or review is ambiguous")
  }
  const correctionSummary = correctionRun ? jsonRecord(correctionRun.afterSummary) : null
  const summaryGroups = Array.isArray(correctionSummary?.groups)
    ? correctionSummary.groups.filter((row): row is { groupId: string; paymentId: string } =>
      !!row && typeof row === "object" && typeof row.groupId === "string" &&
      typeof row.paymentId === "string") : []
  const correctionGroupIds = new Set(summaryGroups.map((row) => row.groupId))
  const correctionRows = groupRows.filter((row) => row.journalGroupId &&
    correctionGroupIds.has(row.journalGroupId))
  const correctionProof: AppliedCorrectionProof | null = correctionRun && correctionReview
    ? {
      run: { id: correctionRun.id, loanId: correctionRun.loanId,
        planHash: correctionRun.planHash,
        inputFingerprint: correctionRun.inputFingerprint,
        policyVersion: correctionRun.policyVersion,
        agentReviewId: correctionRun.agentReviewId,
        appliedByAgent: correctionRun.appliedByAgent,
        backupSha256: correctionRun.backupSha256,
        appliedAt: correctionRun.appliedAt.toISOString(),
        afterSummary: correctionRun.afterSummary },
      review: { id: correctionReview.id, kind: correctionReview.kind,
        subjectId: correctionReview.subjectId, planHash: correctionReview.planHash,
        inputFingerprint: correctionReview.inputFingerprint,
        policyVersion: correctionReview.policyVersion,
        verdict: correctionReview.verdict,
        reviewerAgentId: correctionReview.reviewerAgentId,
        consumedByRunId: correctionReview.consumedByRunId ?? "",
        consumedAt: correctionReview.consumedAt?.toISOString() ?? "",
        evidenceJson: correctionReview.evidenceJson,
        evidenceSha256: correctionReview.evidenceSha256 },
      journalLegs: correctionRows.map((row) => ({ id: row.id,
        groupId: row.journalGroupId ?? "", loanId: row.loanId ?? "",
        paymentId: row.referenceId ?? "", referenceType: row.referenceType ?? "",
        referenceId: row.referenceId ?? "", description: row.description ?? "",
        effectiveAt: row.date.toISOString(), account: row.account,
        accountType: row.accountType as "asset" | "revenue",
        side: row.side, amount: row.amount,
        recordedBy: row.recordedBy, createdAt: row.createdAt.toISOString(),
        depositLocation: row.depositLocation as DepositLocation | null,
        subLocationId: row.subLocationId })),
      journalsComplete: summaryGroups.length > 0 &&
        summaryGroups.length === correctionGroupIds.size &&
        correctionGroupIds.size === new Set(correctionRows.map((row) =>
          row.journalGroupId)).size &&
        extraPaymentJournals.length === correctionRows.length,
    } : null
  const unexplainedPaymentJournals = correctionProof?.journalsComplete
    ? extraPaymentJournals.filter((id) => !correctionRows.some((row) => row.id === id))
    : extraPaymentJournals
  if (loan.termMonths !== null || loan.deletedAt || successors.length > 0) {
    sourceExceptions.push("Unsupported loan term, deletion, or successor")
  }
  if (!loanCreated || text(loanCreated.id) !== loan.id ||
      text(loanCreated.issuanceFee) !== loan.issuanceFee ||
      text(loanCreated.disbursementSource) !== loan.disbursementSource ||
      (loanCreated.subLocationId ?? null) !== loan.subLocationId) {
    sourceExceptions.push("Loan creation audit does not match the disbursement")
  }
  const originalLoanGroups = new Map<string, typeof groupRows>()
  for (const row of groupRows.filter((item) => item.referenceType === "loan" &&
    item.referenceId === loanId)) {
    if (!row.journalGroupId) {
      sourceExceptions.push("Original loan journal has no group")
      continue
    }
    const group = originalLoanGroups.get(row.journalGroupId) ?? []
    group.push(row)
    originalLoanGroups.set(row.journalGroupId, group)
  }
  const expectedLoanGroups = new BigNumber(loan.issuanceFee).gt(0) ? 2 : 1
  if (originalLoanGroups.size !== expectedLoanGroups) {
    sourceExceptions.push("Original loan disbursement or fee group is missing")
  }
  const journalPair = (rows: typeof groupRows, cashSide: "debit" | "credit",
    otherAccount: string, otherSide: "debit" | "credit", expected: string) =>
    rows.length === 2 && rows.every((row) => row.loanId === loanId &&
      row.referenceType === "loan" && row.referenceId === loanId &&
      row.date.getTime() === loan.startDate.getTime()) &&
    rows.some((row) => row.account === "Cash" && row.side === cashSide &&
      new BigNumber(row.amount).eq(expected) &&
      row.depositLocation === loan.disbursementSource &&
      row.subLocationId === loan.subLocationId) &&
    rows.some((row) => row.account === otherAccount && row.side === otherSide &&
      new BigNumber(row.amount).eq(expected) && row.depositLocation === null &&
      row.subLocationId === null)
  const loanGroups = [...originalLoanGroups.values()]
  if (loanGroups.filter((rows) => journalPair(rows, "credit", "Loans Receivable",
    "debit", loan.principalAmount)).length !== 1 ||
      (new BigNumber(loan.issuanceFee).gt(0) &&
        loanGroups.filter((rows) => journalPair(rows, "debit", "Issuance Fees",
          "credit", loan.issuanceFee)).length !== 1)) {
    sourceExceptions.push("Original loan disbursement or fee journal does not reconcile")
  }
  if (journalRows.some((row) => !["loan", "payment", "portfolio_accrual_repair"]
    .includes(row.referenceType ?? ""))) {
    sourceExceptions.push("Unexpected loan journal history needs separate review")
  }
  const portfolioJournalRows = journalRows.filter((row) =>
    row.referenceType === "portfolio_accrual_repair")
  if (portfolioJournalRows.length || portfolioRuns.length) {
    const signatures = (rows: Array<{ date: string; amount: string; debit: string;
      credit: string }>) => rows.map((row) => JSON.stringify(row)).sort()
    const actualRunIds = new Set(portfolioJournalRows.map((row) => row.referenceId))
    if (portfolioRuns.length !== actualRunIds.size ||
        portfolioRuns.some((run) => !actualRunIds.has(run.id))) {
      sourceExceptions.push("Portfolio accrual run and journal history disagree")
    }
    for (const run of portfolioRuns) {
      const review = portfolioReviews.find((row) => row.id === run.agentReviewId)
      let before: Record<string, unknown> | null = null
      try { before = jsonRecord(run.beforeSummary) } catch { /* Block below. */ }
      const entries = Array.isArray(before?.entries) ? before.entries : []
      const reviewEvidence = review ? jsonRecord(review.evidenceJson) : null
      const checkpoints = Array.isArray(reviewEvidence?.checkpoints)
        ? reviewEvidence.checkpoints : []
      const checkpointKey = (value: unknown): string | null => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null
        const row = value as Record<string, unknown>
        const keys = ["date", "period", "accrued", "settled",
          "existingReceivable", "delta", "resultingReceivable"]
        return keys.every((key) => typeof row[key] === "string")
          ? JSON.stringify(keys.map((key) => row[key])) : null
      }
      const runRows = portfolioJournalRows.filter((row) => row.referenceId === run.id)
      const runGroupIds = [...new Set(runRows.map((row) => row.journalGroupId))]
      const actual: Array<{ date: string; amount: string; debit: string;
        credit: string }> = []
      for (const groupId of runGroupIds) {
        const rows = groupRows.filter((row) => row.journalGroupId === groupId)
        const debit = rows.find((row) => row.side === "debit")
        const credit = rows.find((row) => row.side === "credit")
        if (!groupId || rows.length !== 2 || !debit || !credit ||
            debit.amount !== credit.amount ||
            debit.accountType !== (debit.account === "Interest Receivable"
              ? "asset" : "revenue") ||
            credit.accountType !== (credit.account === "Interest Receivable"
              ? "asset" : "revenue") ||
            rows.some((row) => row.loanId !== loanId ||
              row.referenceType !== "portfolio_accrual_repair" ||
              row.referenceId !== run.id ||
              row.date.getTime() !== debit.date.getTime() ||
              row.createdAt.getTime() !== run.appliedAt.getTime() ||
              row.recordedBy !== run.appliedByAgent ||
              row.description !== `Portfolio interest repair ${run.id}` ||
              row.depositLocation !== null || row.subLocationId !== null)) {
          sourceExceptions.push(`Portfolio accrual group ${groupId ?? "missing"} is unproved`)
          continue
        }
        actual.push({ date: debit.date.toISOString(), amount: debit.amount,
          debit: debit.account, credit: credit.account })
      }
      const expected: typeof actual = []
      for (const item of entries) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          sourceExceptions.push(`Portfolio accrual run ${run.id} has malformed entries`)
          continue
        }
        const entry = item as Record<string, unknown>
        const date = iso(entry.date)
        const delta = typeof entry.delta === "string" ? new BigNumber(entry.delta) : null
        if (!date || !delta?.isFinite() || delta.isZero() ||
            (delta.decimalPlaces() ?? Infinity) > 2 ||
            new Date(date) > asOf) {
          sourceExceptions.push(`Portfolio accrual run ${run.id} has an invalid checkpoint`)
          continue
        }
        expected.push({ date, amount: delta.abs().toFixed(2),
          debit: delta.gt(0) ? "Interest Receivable" : "Interest Earned",
          credit: delta.gt(0) ? "Interest Earned" : "Interest Receivable" })
      }
      if (!review || !run.agentReviewId || !run.appliedByAgent?.startsWith("agent:") ||
          review.kind !== "portfolio_accrual" || review.subjectId !== loanId ||
          reviewEvidence?.loanId !== loanId ||
          reviewEvidence.asOf !== before?.asOf ||
          (reviewEvidence.sourceDigest !== undefined &&
            (typeof reviewEvidence.sourceDigest !== "string" ||
              !/^[a-f0-9]{64}$/.test(reviewEvidence.sourceDigest))) ||
          checkpoints.length !== entries.length ||
          entries.some((entry, index) => !checkpointKey(entry) ||
            checkpointKey(entry) !== checkpointKey(checkpoints[index])) ||
          review.planHash !== run.planHash ||
          review.inputFingerprint !== run.inputFingerprint ||
          review.policyVersion !== run.policyVersion || review.verdict !== "pass" ||
          review.reviewerAgentId === run.appliedByAgent ||
          review.consumedByRunId !== run.id ||
          review.consumedAt?.getTime() !== run.appliedAt.getTime() ||
          hashReviewEvidence(reviewEvidence) !== review.evidenceSha256 ||
          expected.length !== entries.length ||
          signatures(actual).join("|") !== signatures(expected).join("|")) {
        sourceExceptions.push(`Portfolio accrual run ${run.id} has no exact reviewed journal proof`)
      }
    }
  }
  const currentPrincipal = await getLoanBalanceFromLedger(loanId, asOf, queryDb)
  if (!currentPrincipal.isZero()) {
    sourceExceptions.push("Fully-paid loan has an outstanding principal ledger balance")
  }
  const sourceDigest = createHash("sha256").update(JSON.stringify({
    loan, allPayments: allPayments.toSorted((a, b) => a.id.localeCompare(b.id)),
    waivers: waivers.toSorted((a, b) => a.id.localeCompare(b.id)),
    successors: successors.toSorted((a, b) => a.id.localeCompare(b.id)),
    loanAudits: loanAudits.toSorted((a, b) => a.id.localeCompare(b.id)),
    paymentAudits: paymentAudits.toSorted((a, b) => a.id.localeCompare(b.id)),
    journalRows: journalRows.toSorted((a, b) => a.id.localeCompare(b.id)),
    groupRows: groupRows.toSorted((a, b) => a.id.localeCompare(b.id)),
    rates: rates.toSorted((a, b) => a.id.localeCompare(b.id)),
    correctionRuns: correctionRuns.toSorted((a, b) => a.id.localeCompare(b.id)),
    correctionReview,
    portfolioRuns: portfolioRuns.toSorted((a, b) => a.id.localeCompare(b.id)),
    portfolioReviews: portfolioReviews.toSorted((a, b) => a.id.localeCompare(b.id)),
    currentPortions: [...currentPortions].sort(([a], [b]) => a.localeCompare(b)),
    currentPrincipal: currentPrincipal.toFixed(2),
  })).digest("hex")
  return {
    asOf: asOf.toISOString(), sourceDigest,
    loan: { id: loan.id, status: loan.status, type: loan.loanType,
      principal: loan.principalAmount, monthlyRate: loan.interestRate,
      penaltyMultiplier: loan.penaltyMultiplier, minInterestDays: loan.minInterestDays,
      startAt: loan.startDate.toISOString(), interestRateOverride: loan.interestRateOverride,
      minPeriodOverride: loan.minPeriodOverride, rolledOverFrom: loan.rolledOverFrom,
      rolledOverTo: successors.length === 1 ? successors[0].id : null,
      penaltyWaived: loan.penaltyWaived },
    payments: activePayments.map((payment, index) => {
      const original = journalAllocations[index]
      return { id: payment.id, loanId, effectiveAt: payment.paymentDate.toISOString(),
        amount: payment.amount, depositLocation: payment.depositLocation,
        subLocationId: payment.subLocationId, interest: original.interest,
        principal: original.principal, overpayment: original.overpayment }
    }),
    journalAllocations, originalJournalLegs,
    journalsComplete: journalRows.every((row) => row.journalGroupId !== null &&
      groupRows.some((item) => item.id === row.id)),
    currentLedgerAllocations: activePayments.map((payment) => {
      const mapped = currentPortions.get(payment.id)
      const interest = mapped?.interestPortion ?? "0.00"
      const principal = mapped?.principalPortion ?? "0.00"
      return { paymentId: payment.id, loanId, effectiveAt: payment.paymentDate.toISOString(),
        cash: payment.amount, interest, principal,
        overpayment: new BigNumber(payment.amount).minus(interest).minus(principal).toFixed(2) }
    }),
    currentLedgerComplete: activePayments.every((payment) =>
      currentPortions.has(payment.id)),
    correctionProof,
    auditProof: { loanCreate: {
      action: loanCreates.length === 1 ? loanCreates[0].action : "",
      beforeNull: loanCreates.length === 1 && loanCreates[0].beforeValue === null,
      loanId: text(loanCreated?.id), principal: text(loanCreated?.principalAmount),
      monthlyRate: text(loanCreated?.interestRate),
      penaltyMultiplier: text(loanCreated?.penaltyMultiplier),
      minInterestDays: typeof loanCreated?.minInterestDays === "number"
        ? loanCreated.minInterestDays : -1,
      startAt: iso(loanCreated?.startDate), type: text(loanCreated?.loanType),
    }, paymentCreates, complete: loanCreates.length === 1 &&
      paymentAudits.length === activePayments.length && exceptionalAudits.length === 0 },
    rateChanges: rates.filter((row) => row.status === "approved").map((row) => row.id),
    waivers: waivers.map((row) => row.id),
    reversals: allPayments.filter((row) => row.deletedAt || row.markedWrong)
      .map((row) => row.id).concat(journalRows.filter((row) =>
        row.referenceType === "payment_reversal").map((row) => row.id)),
    extraPaymentJournals: unexplainedPaymentJournals,
    otherRelevantAudits: exceptionalAudits.map((row) => row.id),
    sourceExceptions,
  }
}
