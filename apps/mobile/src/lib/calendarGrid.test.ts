import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  buildMonthGrid,
  canGoNext,
  canGoPrev,
  dayNumeral,
  daysInMonth,
  earliestMonth,
  formatDayMonthLong,
  formatLongDate,
  formatMonthName,
  formatMonthYear,
  isDateOnly,
  isMonthStart,
  mondayOf,
  monthStartOf,
  weekdayIndex,
  weekdayInitials,
} from './calendarGrid';

describe('date arithmetic on YYYY-MM-DD', () => {
  it('finds the month start and checks it', () => {
    expect(monthStartOf('2026-11-23')).toBe('2026-11-01');
    expect(isMonthStart('2026-11-01')).toBe(true);
    expect(isMonthStart('2026-11-15')).toBe(false);
    expect(isMonthStart('2026-13-01')).toBe(false);
    expect(isDateOnly('2026-02-30')).toBe(false);
    expect(isDateOnly('2026-02-28')).toBe(true);
    expect(isDateOnly('nope')).toBe(false);
  });
  it('moves months across a year end', () => {
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
    expect(addMonths('2025-12-01', 1)).toBe('2026-01-01');
    expect(addMonths('2026-11-01', 0)).toBe('2026-11-01');
    expect(addMonths('2026-03-01', -14)).toBe('2025-01-01');
  });
  it('counts the days of a month, leap years included', () => {
    expect(daysInMonth('2026-02-01')).toBe(28);
    expect(daysInMonth('2028-02-01')).toBe(29);
    expect(daysInMonth('2026-11-01')).toBe(30);
    expect(daysInMonth('2026-12-01')).toBe(31);
  });
  it('adds days across month ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('indexes weekdays from Monday', () => {
    expect(weekdayIndex('2026-11-23')).toBe(0); // Monday
    expect(weekdayIndex('2026-11-29')).toBe(6); // Sunday
    expect(mondayOf('2026-11-29')).toBe('2026-11-23');
    expect(mondayOf('2026-11-01')).toBe('2026-10-26');
  });
});

describe('the month grid', () => {
  it('November 2026 starts on a Sunday: six leading blanks, 6 rows', () => {
    const rows = buildMonthGrid('2026-11-01');
    expect(rows).toHaveLength(6);
    expect(rows[0].days).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(rows[5].days).toEqual(['2026-11-30', null, null, null, null, null, null]);
    expect(rows[0].weekStart).toBe('2026-10-26');
    expect(rows[1].days[0]).toBe('2026-11-02');
    expect(rows[4].days).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
  });
  it('February 2027 starting on a Monday fits in four rows with no blank', () => {
    const rows = buildMonthGrid('2027-02-01');
    expect(rows).toHaveLength(4);
    expect(rows.flatMap((r) => r.days).every((d) => d !== null)).toBe(true);
    expect(rows[0].weekStart).toBe('2027-02-01');
  });
  it('a month can need six rows', () => {
    // August 2026 starts on a Saturday and has 31 days.
    const rows = buildMonthGrid('2026-08-01');
    expect(rows).toHaveLength(6);
    expect(rows[5].days.filter((d) => d !== null)).toEqual(['2026-08-31']);
  });
  it('lists every day of the month exactly once, in order', () => {
    for (const month of ['2026-02-01', '2026-03-01', '2026-11-01', '2028-02-01']) {
      const days = buildMonthGrid(month).flatMap((r) => r.days).filter((d): d is string => d !== null);
      expect(days).toHaveLength(daysInMonth(month));
      expect(days[0]).toBe(month);
      expect([...days].sort()).toEqual(days);
    }
  });
  it('does not depend on the device time zone (no Date.now, no local getters in the source: see the source scan)', () => {
    const previous = process.env.TZ;
    for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC']) {
      process.env.TZ = tz;
      expect(buildMonthGrid('2026-03-01')[0].days[6]).toBe('2026-03-01');
      expect(formatLongDate('2026-03-01', 'en')).toBe('Sunday 1 March');
    }
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });
});

describe('chevron bounds', () => {
  it('never goes past the gym month', () => {
    expect(canGoNext('2026-11-01', '2026-11-01')).toBe(false);
    expect(canGoNext('2026-10-01', '2026-11-01')).toBe(true);
  });
  it('never goes before the earliest month with a visit', () => {
    expect(canGoPrev('2026-03-01', '2026-03-01')).toBe(false);
    expect(canGoPrev('2026-04-01', '2026-03-01')).toBe(true);
  });
  it('the earliest month is the current month when there is no visit, and never after it', () => {
    expect(earliestMonth(null, '2026-11-01')).toBe('2026-11-01');
    expect(earliestMonth('2026-03-15', '2026-11-01')).toBe('2026-03-01');
    expect(earliestMonth('2027-01-02', '2026-11-01')).toBe('2026-11-01');
  });
});

describe('labels', () => {
  it('formats the month and year in both languages', () => {
    expect(formatMonthYear('2026-11-01', 'en')).toBe('November 2026');
    expect(formatMonthYear('2026-11-01', 'fr')).toBe('novembre 2026');
    expect(formatMonthName('2026-11-01', 'en')).toBe('November');
    expect(formatMonthName('2026-11-01', 'fr')).toBe('novembre');
  });
  it('formats a long date without a comma', () => {
    expect(formatLongDate('2026-11-12', 'en')).toBe('Thursday 12 November');
    expect(formatLongDate('2026-11-12', 'fr')).toBe('jeudi 12 novembre');
    expect(formatDayMonthLong('2026-11-10', 'en')).toBe('10 November');
    expect(formatDayMonthLong('2026-11-10', 'fr')).toBe('10 novembre');
  });
  it('names the weekdays Monday first, one letter each', () => {
    expect(weekdayInitials('en')).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(weekdayInitials('fr')).toEqual(['L', 'M', 'M', 'J', 'V', 'S', 'D']);
  });
  it('shows the day number without a leading zero', () => {
    expect(dayNumeral('2026-11-03')).toBe('3');
    expect(dayNumeral('2026-11-23')).toBe('23');
  });
});
