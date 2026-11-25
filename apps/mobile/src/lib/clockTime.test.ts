import { describe, expect, it } from 'vitest';

import { formatClockTime } from './clockTime';

describe('formatClockTime', () => {
  it('formats a time of day on this phone, in both languages', () => {
    const ms = Date.UTC(2026, 10, 25, 14, 30);
    expect(formatClockTime(ms, 'en')).toMatch(/\d{2}[:.]\d{2}/);
    expect(formatClockTime(ms, 'fr')).toMatch(/\d{2}[:.h]\d{2}/);
  });
  it('is empty for a value that is not a time', () => {
    expect(formatClockTime(Number.NaN, 'en')).toBe('');
  });
});
