import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

import en from '@/locales/en.json';
import fr from '@/locales/fr.json';

import { buildStreakReminderRow, formatReminderHour, streakReminderAfterToggle } from './streakReminder';
import type { TFn } from './weeklyGoalSheet';

function makeT(lng: 'en' | 'fr', resources: { en: unknown; fr: unknown } = { en, fr }): TFn {
  const i18n = createInstance();
  void i18n.init({
    lng,
    fallbackLng: 'en',
    resources: { en: { translation: resources.en as object }, fr: { translation: resources.fr as object } },
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return (key, options) => i18n.t(key, options) as string;
}

describe('formatReminderHour', () => {
  it('formats the evening hour the way the catalog shows it: "6 pm" in English, "18 h" in French', () => {
    expect(formatReminderHour(18, 'en')).toBe('6 pm');
    expect(formatReminderHour(18, 'fr')).toBe('18 h');
  });

  it('handles midnight, the morning and noon in English, and any French locale tag', () => {
    expect(formatReminderHour(0, 'en')).toBe('12 am');
    expect(formatReminderHour(9, 'en')).toBe('9 am');
    expect(formatReminderHour(12, 'en')).toBe('12 pm');
    expect(formatReminderHour(23, 'en')).toBe('11 pm');
    expect(formatReminderHour(9, 'fr')).toBe('9 h');
    expect(formatReminderHour(18, 'fr-CM')).toBe('18 h');
    expect(formatReminderHour(18, 'en-GB')).toBe('6 pm');
  });

  it('returns null for no hour and for a malformed hour, never a guessed time', () => {
    for (const bad of [null, undefined, -1, 24, 18.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatReminderHour(bad as number | null | undefined, 'en')).toBeNull();
      expect(formatReminderHour(bad as number | null | undefined, 'fr')).toBeNull();
    }
  });
});

describe('buildStreakReminderRow', () => {
  it('shows the English label and the helper with "6 pm", on by default', () => {
    const row = buildStreakReminderRow({ optedOut: false, pending: false, hour: 18, language: 'en', t: makeT('en') });
    expect(row).toEqual({
      label: 'Streak reminder',
      helper: 'One reminder at 6 pm, only when a visit today keeps your week or run going.',
      checked: true,
      disabled: false,
      accessibilityLabel: 'Streak reminder',
    });
  });

  it('shows the French label and the helper with "18 h"', () => {
    const row = buildStreakReminderRow({ optedOut: false, pending: false, hour: 18, language: 'fr', t: makeT('fr') });
    expect(row.label).toBe('Rappel de série');
    expect(row.helper).toBe("Un rappel à 18 h, seulement quand une visite aujourd'hui permet de garder votre semaine ou votre série.");
    expect(row.accessibilityLabel).toBe('Rappel de série');
  });

  it('is off once the member opted out, and disabled while a save is in flight', () => {
    expect(buildStreakReminderRow({ optedOut: true, pending: false, hour: 18, language: 'en', t: makeT('en') }).checked).toBe(false);
    expect(buildStreakReminderRow({ optedOut: false, pending: true, hour: 18, language: 'en', t: makeT('en') }).disabled).toBe(true);
    expect(buildStreakReminderRow({ optedOut: true, pending: true, hour: 18, language: 'en', t: makeT('en') })).toMatchObject({ checked: false, disabled: true });
  });

  it('omits the helper when the hour could not be read, in both languages, and still shows the row', () => {
    for (const language of ['en', 'fr'] as const) {
      const row = buildStreakReminderRow({ optedOut: false, pending: false, hour: null, language, t: makeT(language) });
      expect(row.helper).toBeNull();
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.checked).toBe(true);
    }
  });

  it('takes every string from the catalog: a sentinel in each key shows up, and the time is passed through', () => {
    const sentinel = {
      en: { engage: { profile: { reminder: { label: 'LABEL-SENTINEL', helper: 'HELPER {{time}} SENTINEL' } } } },
      fr: { engage: { profile: { reminder: { label: 'LABEL-SENTINEL', helper: 'HELPER {{time}} SENTINEL' } } } },
    };
    const row = buildStreakReminderRow({ optedOut: false, pending: false, hour: 18, language: 'fr', t: makeT('fr', sentinel) });
    expect(row.label).toBe('LABEL-SENTINEL');
    expect(row.accessibilityLabel).toBe('LABEL-SENTINEL');
    expect(row.helper).toBe('HELPER 18 h SENTINEL');
  });
});

describe('streakReminderAfterToggle (optimistic flip, revert on failure)', () => {
  it('opting out saves true, then opting back in saves false', () => {
    expect(streakReminderAfterToggle(false, true)).toEqual({ optedOut: true, showError: false });
    expect(streakReminderAfterToggle(true, true)).toEqual({ optedOut: false, showError: false });
  });

  it('a failed save puts the previous value back and asks for the error toast, from either side', () => {
    expect(streakReminderAfterToggle(false, false)).toEqual({ optedOut: false, showError: true });
    expect(streakReminderAfterToggle(true, false)).toEqual({ optedOut: true, showError: true });
  });
});
