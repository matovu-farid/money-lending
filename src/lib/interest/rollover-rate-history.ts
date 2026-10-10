import BigNumber from "bignumber.js";

export const ROLLOVER_RATE_AUDIT_ACTIONS = [
  "loan.rate_change.approved",
  "loan.rate_change.immediate",
  "loan.rate_change.admin_adjusted",
  "loan.update",
];

export type RolloverRateAudit = {
  id: string;
  action: string;
  occurredAt: Date;
  beforeValue: string | null;
  afterValue: string | null;
};

export type RolloverApprovedRateRequest = {
  id: string;
  currentRate: string;
  requestedRate: string;
  reviewedAt: Date | null;
};

type RateChange = { effectiveDate: Date; fromRate: string; toRate: string };

function parseObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function normalizedRate(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const rate = new BigNumber(value);
  return rate.isFinite() && rate.gt(0) && rate.lt(1) ? rate.toFixed(4) : null;
}

function rateFromValue(value: Record<string, unknown> | null): string | null {
  return normalizedRate(value?.interestRateOverride ?? value?.interestRate);
}

/** Reconstruct every applied, dated rate transition or reject an incomplete history. */
export function reconstructRolloverRateHistory(input: {
  loan: { startDate: Date; interestRate: string; interestRateOverride: string | null };
  approvedRequests: RolloverApprovedRateRequest[];
  audits: RolloverRateAudit[];
}): { initialRate: string; changes: RateChange[]; exceptions: string[] } {
  const exceptions: string[] = [];
  const initialRate = normalizedRate(input.loan.interestRate);
  if (!initialRate) exceptions.push("Loan has an invalid original rate");
  const orderedAudits = [...input.audits].sort((a, b) =>
    a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
  const corrections = orderedAudits.filter((audit) =>
    parseObject(audit.afterValue)?.rateSemantics === "correction");
  if (corrections.length > 0) {
    const latest = corrections.at(-1)!;
    const after = parseObject(latest.afterValue);
    const correctedRate = rateFromValue(after);
    if (!correctedRate || after?.effectiveFrom !== input.loan.startDate.toISOString()) {
      exceptions.push(`Rate correction audit ${latest.id} has invalid rate or effective-from date`);
    }
    const current = normalizedRate(input.loan.interestRateOverride ?? input.loan.interestRate);
    if (correctedRate !== current) {
      exceptions.push("Current loan rate does not reconcile to corrected rate history");
    }
    if (orderedAudits.some((audit) => audit.action !== "loan.update" &&
        audit.occurredAt > latest.occurredAt &&
        parseObject(audit.afterValue)?.rateSemantics !== "correction")) {
      exceptions.push("An unmarked rate change followed the latest correction");
    }
    for (const audit of orderedAudits) {
      if (audit.action !== "loan.update") continue;
      const value = parseObject(audit.afterValue);
      if (value && (Object.hasOwn(value, "interestRate") || Object.hasOwn(value, "startDate"))) {
        exceptions.push("Loan terms were directly edited; rate history or effective date needs review");
      }
    }
    return { initialRate: correctedRate ?? input.loan.interestRate, changes: [], exceptions };
  }
  const approved = new Map(input.approvedRequests.map((request) => [request.id, request]));
  const seenApproved = new Set<string>();
  const changes: RateChange[] = [];
  let previous = initialRate;
  let previousDay: string | null = null;

  for (const audit of orderedAudits) {
    const before = parseObject(audit.beforeValue);
    const after = parseObject(audit.afterValue);
    if (audit.action === "loan.update") {
      if (after && (Object.hasOwn(after, "interestRate") || Object.hasOwn(after, "startDate"))) {
        exceptions.push("Loan terms were directly edited; rate history or effective date needs review");
      }
      continue;
    }
    const fromRate = rateFromValue(before);
    const toRate = rateFromValue(after);
    if (!fromRate || !toRate || !Number.isFinite(audit.occurredAt.getTime())) {
      exceptions.push(`Applied rate audit ${audit.id} has incomplete rate history`);
      continue;
    }
    if (audit.occurredAt < input.loan.startDate) {
      exceptions.push(`Applied rate audit ${audit.id} precedes loan start`);
    }
    const day = audit.occurredAt.toISOString().slice(0, 10);
    if (previousDay === day) {
      exceptions.push("Applied rate changes have an ambiguous same-day order");
    }
    if (previous !== fromRate) {
      exceptions.push(`Applied rate audit ${audit.id} breaks rate history continuity`);
    }
    if (audit.action === "loan.rate_change.approved") {
      const requestId = after?.requestId;
      const request = typeof requestId === "string" ? approved.get(requestId) : undefined;
      if (!request || !request.reviewedAt ||
          normalizedRate(request.requestedRate) !== toRate) {
        exceptions.push(`Approved rate audit ${audit.id} lacks a matching request`);
      } else {
        seenApproved.add(request.id);
      }
    }
    changes.push({ effectiveDate: audit.occurredAt, fromRate, toRate });
    previous = toRate;
    previousDay = day;
  }

  for (const request of input.approvedRequests) {
    if (!seenApproved.has(request.id)) {
      exceptions.push(`Approved rate request ${request.id} has no complete audit history`);
    }
  }
  const current = normalizedRate(input.loan.interestRateOverride ?? input.loan.interestRate);
  if (!current || previous !== current) {
    exceptions.push("Current loan rate does not reconcile to dated rate history");
  }
  return { initialRate: initialRate ?? input.loan.interestRate, changes, exceptions };
}
