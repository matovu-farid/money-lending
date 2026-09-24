import { describe, expect, it } from 'vitest';
import {
  currentKampalaWeek,
  isFutureKampalaWeek,
  parseWeeklyReportPeriod,
  shiftKampalaWeek,
} from '../weekly-report-period';

describe('weekly report periods', () => {
  it('uses the Monday of the current Kampala week', () => {
    expect(currentKampalaWeek(new Date('2026-09-23T12:00:00.000Z'))).toBe('2026-09-21');
    // Sunday evening UTC is still Sunday in Kampala until 21:00 UTC.
    expect(currentKampalaWeek(new Date('2026-09-27T20:59:00.000Z'))).toBe('2026-09-21');
  });

  it('identifies future weeks using Kampala time across the Monday boundary', () => {
    const beforeKampalaMonday = new Date('2026-09-27T20:59:00.000Z');
    const atKampalaMonday = new Date('2026-09-27T21:00:00.000Z');
    expect(isFutureKampalaWeek('2026-09-28', beforeKampalaMonday)).toBe(true);
    expect(isFutureKampalaWeek('2026-09-28', atKampalaMonday)).toBe(false);
    expect(isFutureKampalaWeek('2026-09-21', atKampalaMonday)).toBe(false);
  });

  it('validates real calendar Mondays, including leap days', () => {
    expect(parseWeeklyReportPeriod('2024-02-26').endLocalDate).toBe('2024-03-03');
    expect(() => parseWeeklyReportPeriod('2023-02-29')).toThrow();
    expect(() => parseWeeklyReportPeriod('2026-09-22')).toThrow();
    expect(() => parseWeeklyReportPeriod('2026-9-21')).toThrow();
  });

  it('shifts weeks across year boundaries', () => {
    expect(shiftKampalaWeek('2026-12-28', 1)).toBe('2027-01-04');
    expect(shiftKampalaWeek('2027-01-04', -1)).toBe('2026-12-28');
  });

  it('converts Kampala Monday through Sunday to half-open UTC bounds', () => {
    const period = parseWeeklyReportPeriod('2026-09-21');
    expect(period.startUtc.toISOString()).toBe('2026-09-20T21:00:00.000Z');
    expect(period.endUtc.toISOString()).toBe('2026-09-27T21:00:00.000Z');
    expect(period.endLocalDate).toBe('2026-09-27');

    const sundayLastMillisecond = new Date('2026-09-27T20:59:59.999Z');
    const nextMonday = new Date('2026-09-27T21:00:00.000Z');
    expect(sundayLastMillisecond >= period.startUtc && sundayLastMillisecond < period.endUtc).toBe(true);
    expect(nextMonday >= period.startUtc && nextMonday < period.endUtc).toBe(false);
  });
});
