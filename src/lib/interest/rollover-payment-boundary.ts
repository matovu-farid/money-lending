const DAY_MS = 86_400_000;

function isUtcMidnight(date: Date): boolean {
  return Number.isFinite(date.getTime()) &&
    date.getUTCHours() === 0 && date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
}

/** Date-only rollovers settle predecessor-owned receipts through their effective day. */
export function rolloverPaymentCutoff(predecessorStart: Date, successorStart: Date): Date {
  if (!isUtcMidnight(predecessorStart) || !isUtcMidnight(successorStart)) {
    return successorStart;
  }
  return new Date(successorStart.getTime() + DAY_MS - 1);
}

export function paymentAfterRollover(
  predecessorStart: Date, successorStart: Date, paymentDate: Date,
): boolean {
  if (paymentDate < successorStart) return false;
  const cutoff = rolloverPaymentCutoff(predecessorStart, successorStart);
  return cutoff.getTime() === successorStart.getTime() || paymentDate > cutoff;
}
