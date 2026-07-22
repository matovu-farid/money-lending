import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { payments } from "@/lib/db/schema/payments";
import { loanWaivers } from "@/lib/db/schema/loan-waivers";
import BigNumber from "bignumber.js";
import {
  getPaymentPortionsFromLedger,
  getWaiverPortionsFromLedger,
} from "./ledger-queries.service";

export type SettlementEventKind = "payment" | "waiver";

export interface SettlementEvent {
  kind: SettlementEventKind;
  date: Date;
}

function pickBestSettlementEvent(
  current: SettlementEvent | undefined,
  candidate: SettlementEvent,
): SettlementEvent {
  if (!current) return candidate;
  if (candidate.date.getTime() > current.date.getTime()) return candidate;
  if (candidate.date.getTime() < current.date.getTime()) return current;
  // Same timestamp: payment wins (needed for penalty-reset guard).
  if (candidate.kind === "payment") return candidate;
  return current;
}

/**
 * Batch-fetch the latest settlement event per loan (payment or waiver).
 * When `asOf` is set, only events on or before that date are considered.
 */
export async function getLastSettlementEventsForLoans(
  loanIds: string[],
  asOf?: Date,
  queryDb: Pick<typeof db, "select"> = db,
): Promise<Map<string, SettlementEvent>> {
  const result = new Map<string, SettlementEvent>();
  if (loanIds.length === 0) return result;

  const paymentConditions = [
    inArray(payments.loanId, loanIds),
    isNull(payments.deletedAt),
    eq(payments.markedWrong, false),
  ];
  if (asOf) paymentConditions.push(lte(payments.paymentDate, asOf));

  const waiverConditions = [
    inArray(loanWaivers.loanId, loanIds),
    isNull(loanWaivers.deletedAt),
  ];
  if (asOf) waiverConditions.push(lte(loanWaivers.waiverDate, asOf));

  const [paymentRows, waiverRows] = await Promise.all([
    queryDb
      .select({ loanId: payments.loanId, date: payments.paymentDate })
      .from(payments)
      .where(and(...paymentConditions)),
    queryDb
      .select({ loanId: loanWaivers.loanId, date: loanWaivers.waiverDate })
      .from(loanWaivers)
      .where(and(...waiverConditions)),
  ]);

  for (const row of paymentRows) {
    const event: SettlementEvent = {
      kind: "payment",
      date: new Date(row.date),
    };
    result.set(
      row.loanId,
      pickBestSettlementEvent(result.get(row.loanId), event),
    );
  }

  for (const row of waiverRows) {
    const event: SettlementEvent = {
      kind: "waiver",
      date: new Date(row.date),
    };
    result.set(
      row.loanId,
      pickBestSettlementEvent(result.get(row.loanId), event),
    );
  }

  return result;
}

export async function getLastSettlementEvent(
  loan: { id: string; startDate: Date },
  opts?: { asOf?: Date },
  queryDb: Pick<typeof db, "select"> = db,
): Promise<SettlementEvent> {
  const map = await getLastSettlementEventsForLoans(
    [loan.id],
    opts?.asOf,
    queryDb,
  );
  return (
    map.get(loan.id) ?? {
      kind: "payment",
      date: new Date(loan.startDate),
    }
  );
}

export async function getLastSettlementDate(
  loan: { id: string; startDate: Date },
  opts?: { asOf?: Date },
  queryDb: Pick<typeof db, "select"> = db,
): Promise<Date> {
  return (await getLastSettlementEvent(loan, opts, queryDb)).date;
}

/**
 * Latest settlement on or before `asOf`, excluding specific payment IDs.
 * Used when re-allocating an existing payment (edit/unmark).
 */
export async function getPriorSettlementDate(
  loan: { id: string; startDate: Date },
  asOf: Date,
  excludePaymentIds: string[] = [],
  queryDb: Pick<typeof db, "select"> = db,
): Promise<Date> {
  const exclude = new Set(excludePaymentIds);

  type TimedEvent = SettlementEvent & { paymentId?: string };

  const paymentRows = await queryDb
    .select({ id: payments.id, date: payments.paymentDate })
    .from(payments)
    .where(
      and(
        eq(payments.loanId, loan.id),
        isNull(payments.deletedAt),
        eq(payments.markedWrong, false),
        lte(payments.paymentDate, asOf),
      ),
    );

  const waiverRows = await queryDb
    .select({ date: loanWaivers.waiverDate })
    .from(loanWaivers)
    .where(
      and(
        eq(loanWaivers.loanId, loan.id),
        isNull(loanWaivers.deletedAt),
        lte(loanWaivers.waiverDate, asOf),
      ),
    );

  const events: TimedEvent[] = [
    ...paymentRows
      .filter((row) => !exclude.has(row.id))
      .map((row) => ({
        kind: "payment" as const,
        date: new Date(row.date),
        paymentId: row.id,
      })),
    ...waiverRows.map((row) => ({
      kind: "waiver" as const,
      date: new Date(row.date),
    })),
  ];

  if (events.length === 0) return new Date(loan.startDate);

  let best: TimedEvent | undefined;
  for (const event of events) {
    best = pickBestSettlementEvent(best, event) as TimedEvent | undefined;
  }
  return best!.date;
}

/** @deprecated Use getLastSettlementDate — kept for existing callers. */
export async function getLastPaymentDate(loan: {
  id: string;
  startDate: Date;
}) {
  return getLastSettlementDate(loan);
}

/**
 * Walk prior payment + waiver principal portions chronologically to derive
 * ledger principal immediately before a settlement at `targetDate`.
 */
export async function reconstructPrincipalBalanceBefore(
  params: {
    loanId: string;
    originalPrincipal: string;
    targetDate: Date;
    priorPaymentIds: string[];
    queryDb?: Pick<typeof db, "select">;
  },
): Promise<string> {
  const {
    loanId,
    originalPrincipal,
    targetDate,
    priorPaymentIds,
    queryDb = db,
  } = params;

  const waiverRows = await queryDb
    .select({ id: loanWaivers.id, waiverDate: loanWaivers.waiverDate })
    .from(loanWaivers)
    .where(
      and(
        eq(loanWaivers.loanId, loanId),
        isNull(loanWaivers.deletedAt),
        lte(loanWaivers.waiverDate, targetDate),
      ),
    );

  type TimelineEntry =
    | { kind: "payment"; id: string; date: Date }
    | { kind: "waiver"; id: string; date: Date };

  const timeline: TimelineEntry[] = [
    ...priorPaymentIds.map((id) => ({
      kind: "payment" as const,
      id,
      date: targetDate,
    })),
    ...waiverRows.map((w) => ({
      kind: "waiver" as const,
      id: w.id,
      date: new Date(w.waiverDate),
    })),
  ];

  // Resolve payment dates for ordering.
  if (priorPaymentIds.length > 0) {
    const paymentDates = await queryDb
      .select({ id: payments.id, paymentDate: payments.paymentDate })
      .from(payments)
      .where(inArray(payments.id, priorPaymentIds));
    const dateById = new Map(
      paymentDates.map((p) => [p.id, new Date(p.paymentDate)]),
    );
    for (const entry of timeline) {
      if (entry.kind === "payment") {
        entry.date = dateById.get(entry.id) ?? targetDate;
      }
    }
  }

  timeline.sort((a, b) => {
    const diff = a.date.getTime() - b.date.getTime();
    if (diff !== 0) return diff;
    if (a.kind === "payment" && b.kind === "waiver") return -1;
    if (a.kind === "waiver" && b.kind === "payment") return 1;
    return 0;
  });

  const paymentPortions = await getPaymentPortionsFromLedger(
    priorPaymentIds,
    queryDb,
  );
  const waiverPortions = await getWaiverPortionsFromLedger(
    waiverRows.map((w) => w.id),
    queryDb,
  );

  let runningBalance = new BigNumber(originalPrincipal);
  for (const entry of timeline) {
    const portions =
      entry.kind === "payment"
        ? paymentPortions.get(entry.id)
        : waiverPortions.get(entry.id);
    if (portions) {
      runningBalance = runningBalance.minus(
        new BigNumber(portions.principalPortion),
      );
    }
  }

  if (runningBalance.isLessThan(0)) runningBalance = new BigNumber(0);
  return runningBalance.toFixed(0);
}

/**
 * Sum interest settled in (prevDate, targetDate] from prior payments and waivers.
 */
export async function sumInterestAlreadyPaidInPeriod(
  params: {
    loanId: string;
    prevDate: Date;
    targetDate: Date;
    excludePaymentId?: string;
    queryDb?: Pick<typeof db, "select">;
  },
): Promise<string> {
  const {
    loanId,
    prevDate,
    targetDate,
    excludePaymentId,
    queryDb = db,
  } = params;

  const paymentRows = await queryDb
    .select({ id: payments.id, paymentDate: payments.paymentDate })
    .from(payments)
    .where(
      and(
        eq(payments.loanId, loanId),
        isNull(payments.deletedAt),
        eq(payments.markedWrong, false),
        lte(payments.paymentDate, targetDate),
      ),
    );

  const waiverRows = await queryDb
    .select({ id: loanWaivers.id, waiverDate: loanWaivers.waiverDate })
    .from(loanWaivers)
    .where(
      and(
        eq(loanWaivers.loanId, loanId),
        isNull(loanWaivers.deletedAt),
        lte(loanWaivers.waiverDate, targetDate),
      ),
    );

  const inPeriodPaymentIds = paymentRows
    .filter((p) => {
      if (excludePaymentId && p.id === excludePaymentId) return false;
      const d = new Date(p.paymentDate);
      return d > prevDate && d <= targetDate;
    })
    .map((p) => p.id);

  const inPeriodWaiverIds = waiverRows
    .filter((w) => {
      const d = new Date(w.waiverDate);
      return d > prevDate && d <= targetDate;
    })
    .map((w) => w.id);

  let sum = new BigNumber(0);

  if (inPeriodPaymentIds.length > 0) {
    const portions = await getPaymentPortionsFromLedger(
      inPeriodPaymentIds,
      queryDb,
    );
    for (const [, p] of portions) {
      sum = sum.plus(p.interestPortion);
    }
  }

  if (inPeriodWaiverIds.length > 0) {
    const portions = await getWaiverPortionsFromLedger(
      inPeriodWaiverIds,
      queryDb,
    );
    for (const [, p] of portions) {
      sum = sum.plus(p.interestPortion);
    }
  }

  return sum.toFixed(2);
}
