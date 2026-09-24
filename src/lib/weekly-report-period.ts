const KAMPALA_TIME_ZONE = 'Africa/Kampala';
const KAMPALA_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export type WeeklyReportPeriod = {
  week: string;
  startUtc: Date;
  endUtc: Date;
  endLocalDate: string;
};

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function utcCalendarDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function parseMonday(week: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(week);
  if (!match) throw new RangeError('Week must be a valid YYYY-MM-DD Monday');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = utcCalendarDate(year, month, day);

  if (
    year === 0 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day ||
    date.getUTCDay() !== 1
  ) {
    throw new RangeError('Week must be a valid YYYY-MM-DD Monday');
  }

  return date;
}

export function parseWeeklyReportPeriod(week: string): WeeklyReportPeriod {
  const monday = parseMonday(week);
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);
  const startUtc = new Date(monday.getTime() - KAMPALA_UTC_OFFSET_MS);
  const endUtc = new Date(monday.getTime() + WEEK_MS - KAMPALA_UTC_OFFSET_MS);

  return {
    week,
    startUtc,
    endUtc,
    endLocalDate: formatDate(sunday.getUTCFullYear(), sunday.getUTCMonth() + 1, sunday.getUTCDate()),
  };
}

export function currentKampalaWeek(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KAMPALA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const year = Number(part('year'));
  const month = Number(part('month'));
  const day = Number(part('day'));
  const localDate = utcCalendarDate(year, month, day);
  const monday = new Date(localDate.getTime() - ((localDate.getUTCDay() + 6) % 7) * DAY_MS);

  return formatDate(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
}

/** Returns whether a valid report week starts after the current Kampala week. */
export function isFutureKampalaWeek(week: string, now = new Date()): boolean {
  parseMonday(week);
  return week > currentKampalaWeek(now);
}

export function shiftKampalaWeek(week: string, weeks: number): string {
  const monday = parseMonday(week);
  if (!Number.isInteger(weeks)) throw new RangeError('Week shift must be an integer');
  const shifted = new Date(monday.getTime() + weeks * WEEK_MS);
  const result = formatDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
  parseMonday(result);
  return result;
}
