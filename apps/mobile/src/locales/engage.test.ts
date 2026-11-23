import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

import en from './en.json';
import fr from './fr.json';

// Story 30.1 (FR-232): the engagement wording is data in the locale files, never fixed in a screen. This file holds the keys this story added,
// copied from the V1.8 member catalog of EXPERIENCE.md (one array: [key, plural]). A plural key has `_one` and `_other` forms and no bare form.
// Screen stories (30.4 to 30.7) add their own keys to the files; the tone and placeholder checks below cover every engage.* and n08.* key,
// whoever added it.
const REQUIRED: readonly (readonly [string, boolean])[] = [
  ["engage.ring.title", false],
  ["engage.ring.unit", false],
  ["engage.ring.goalLabel", true],
  ["engage.ring.goalPending", true],
  ["engage.ring.goalHint.default", true],
  ["engage.ring.a11y.progress", true],
  ["engage.ring.a11y.met", false],
  ["engage.ring.cardHint", false],
  ["engage.ring.caption.progress", true],
  ["engage.ring.caption.fresh", true],
  ["engage.ring.caption.met", false],
  ["engage.ring.caption.metStreak", true],
  ["engage.ring.caption.extra", true],
  ["engage.ring.pendingSync", true],
  ["engage.atRisk.weekly", false],
  ["engage.atRisk.hoursLeft", true],
  ["engage.atRisk.minutesLeft", false],
  ["engage.calendar.title", false],
  ["engage.calendar.prev", false],
  ["engage.calendar.next", false],
  ["engage.calendar.monthSummary", true],
  ["engage.calendar.legend.visit", false],
  ["engage.calendar.legend.today", false],
  ["engage.calendar.day.visited", false],
  ["engage.calendar.day.none", false],
  ["engage.calendar.day.pending", false],
  ["engage.calendar.day.today.atRisk", false],
  ["engage.calendar.day.today.visited", false],
  ["engage.calendar.day.today.none", false],
  ["engage.calendar.empty.current", false],
  ["engage.calendar.empty.past", false],
  ["engage.calendar.offline.banner", false],
  ["engage.calendar.offline.none", false],
  ["engage.calendar.error", false],
  ["engage.calendar.cell.hours", true],
  ["engage.calendar.cell.minutes", true],
  ["engage.calendar.week.a11y", true],
  ["engage.calendar.heading.a11y", true],
  ["engage.home.error", false],
  ["engage.home.settleError", false],
  ["engage.streak.weeks", true],
  ["engage.streak.first", false],
  ["engage.streak.firstWeek", false],
  ["engage.streak.startsMonday", false],
  ["engage.streak.nextShield", true],
  ["engage.streak.shieldMax", false],
  ["engage.streak.daily", false],
  ["engage.streak.best", true],
  ["engage.goal.title", false],
  ["engage.goal.prompt", false],
  ["engage.goal.option.a11y", true],
  ["engage.goal.current", false],
  ["engage.goal.effective", false],
  ["engage.goal.noChange", false],
  ["engage.goal.pending", false],
  ["engage.goal.why", false],
  ["engage.goal.cta.save", false],
  ["engage.goal.saved", false],
  ["engage.goal.error", false],
  ["engage.goal.offline", false],
  ["engage.shield.chip", true],
  ["engage.shield.saved.week", true],
  ["engage.shield.saved.day", false],
  ["engage.shield.earned", false],
  ["engage.shield.explainer.title", false],
  ["engage.shield.explainer.body", false],
  ["engage.shield.gotIt", false],
  ["engage.comeback.title", false],
  ["engage.comeback.best", true],
  ["engage.comeback.goal", false],
  ["engage.comeback.progress", false],
  ["engage.comeback.windowRestart", false],
  ["engage.comeback.restored.title", false],
  ["engage.comeback.restored.body", false],
  ["engage.updatedAt", false],
  ["engage.celebration.unit", false],
  ["engage.celebration.7.headline", false],
  ["engage.celebration.7.sub", false],
  ["engage.celebration.30.headline", false],
  ["engage.celebration.30.sub", false],
  ["engage.celebration.100.headline", false],
  ["engage.celebration.100.sub", false],
  ["engage.celebration.cta.share", false],
  ["engage.celebration.cta.continue", false],
  ["engage.celebration.cta.badges", false],
  ["engage.celebration.a11y", false],
  ["engage.profile.section", false],
  ["engage.profile.goal.row", false],
  ["engage.profile.goal.value", true],
  ["engage.profile.goal.pending", true],
  ["engage.profile.reminder.label", false],
  ["engage.profile.reminder.helper", false],
  ["n08.weekly.title", false],
  ["n08.weekly.body", true],
  ["n08.daily.title", false],
  ["n08.daily.body", false],
];

// The reserved mascot keys: present in both files, empty until the mascot artwork and copy exist.
const MASCOT_KEYS = [
  'engage.celebration.mascot.7',
  'engage.celebration.mascot.30',
  'engage.celebration.mascot.100',
  'engage.comeback.mascot',
  'engage.shield.mascot',
  'n08.mascot',
] as const;

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[path] = v;
    else Object.assign(out, flatten(v, path));
  }
  return out;
}

const EN = flatten(en as unknown as Tree);
const FR = flatten(fr as unknown as Tree);

/** Every concrete key the required list stands for (a plural key stands for its two forms). */
function concreteKeys(): string[] {
  return REQUIRED.flatMap(([key, plural]) => (plural ? [`${key}_one`, `${key}_other`] : [key]));
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
}

const engageKeys = (flat: Record<string, string>) => Object.keys(flat).filter((k) => k.startsWith('engage.') || k.startsWith('n08.'));

describe('engagement catalog: required keys', () => {
  it('lists each key once', () => {
    const keys = REQUIRED.map(([k]) => k);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(['en', 'fr'] as const)('every required key is present and non-empty in %s', (lang) => {
    const flat = lang === 'en' ? EN : FR;
    const missing = concreteKeys().filter((k) => typeof flat[k] !== 'string' || flat[k].trim() === '');
    expect(missing).toEqual([]);
  });

  it('a plural key has no bare form in either file', () => {
    const bare = REQUIRED.filter(([key, plural]) => plural && (key in EN || key in FR)).map(([key]) => key);
    expect(bare).toEqual([]);
  });

  it('a plural form carries {{count}} in both languages', () => {
    const lacking = REQUIRED.filter(([, plural]) => plural).flatMap(([key]) =>
      ['_one', '_other'].flatMap((s) => [EN, FR].filter((f) => !placeholders(f[key + s]).includes('count')).map(() => key + s)),
    );
    expect(lacking).toEqual([]);
  });

  it('a non-plural required key never carries {{count}}', () => {
    const wrong = REQUIRED.filter(([, plural]) => !plural).filter(([key]) => placeholders(EN[key] ?? '').includes('count') || placeholders(FR[key] ?? '').includes('count'));
    expect(wrong).toEqual([]);
  });

  it('has the same placeholders in English and French for every engage.* and n08.* key', () => {
    const drift = engageKeys(EN)
      .filter((k) => k in FR)
      .filter((k) => JSON.stringify(placeholders(EN[k])) !== JSON.stringify(placeholders(FR[k])));
    expect(drift).toEqual([]);
  });

  it('has the same engage.* and n08.* key set in both files', () => {
    expect(engageKeys(FR).sort()).toEqual(engageKeys(EN).sort());
  });

  it.each(['en', 'fr'] as const)('keeps ICU braces out of the strings in %s (i18next uses {{name}})', (lang) => {
    const flat = lang === 'en' ? EN : FR;
    const icu = engageKeys(flat).filter((k) => /(^|[^{])\{\w+[,}]/.test(flat[k]));
    expect(icu).toEqual([]);
  });
});

describe('engagement catalog: plural forms', () => {
  it('has one and other for every plural key in both languages', () => {
    const lacking = REQUIRED.filter(([, plural]) => plural).flatMap(([key]) =>
      [`${key}_one`, `${key}_other`].flatMap((k) => [EN, FR].filter((f) => typeof f[k] !== 'string').map(() => k)),
    );
    expect(lacking).toEqual([]);
  });

  it('resolves the right form through i18next in both languages', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en }, fr: { translation: fr } }, interpolation: { escapeValue: false } });
    expect(i18n.t('engage.ring.goalLabel', { count: 1 })).toBe('Goal: 1 day');
    expect(i18n.t('engage.ring.goalLabel', { count: 4 })).toBe('Goal: 4 days');
    expect(i18n.t('engage.profile.goal.pending', { count: 3, next: 4, date: 'Mon 24 Nov' })).toBe('3 days, then 4 from Mon 24 Nov');
    expect(i18n.t('engage.goal.option.a11y', { count: 1 })).toBe('1 day a week');
    expect(i18n.t('engage.ring.goalHint.default', { count: 1 })).toContain('1 day a week');
    expect(i18n.t('engage.ring.goalHint.default', { count: 4 })).toContain('4 days a week');
    expect(i18n.t('engage.atRisk.hoursLeft', { count: 1 })).toBe('1 hour left');
    expect(i18n.t('engage.atRisk.hoursLeft', { count: 6 })).toBe('6 hours left');
    expect(i18n.t('engage.atRisk.minutesLeft', { m: 40 })).toBe('40 min left');
    await i18n.changeLanguage('fr');
    expect(i18n.t('engage.atRisk.hoursLeft', { count: 1 })).toBe('1 heure restante');
    expect(i18n.t('engage.atRisk.hoursLeft', { count: 6 })).toBe('6 heures restantes');
    expect(i18n.t('engage.ring.goalHint.default', { count: 4 })).toContain('4 jours par semaine');
    expect(i18n.t('engage.ring.goalLabel', { count: 1 })).toBe('Objectif : 1 jour');
    expect(i18n.t('engage.ring.goalLabel', { count: 5 })).toBe('Objectif : 5 jours');
    expect(i18n.t('engage.profile.goal.pending', { count: 3, next: 4, date: 'lun. 24 nov.' })).toBe('3 jours, puis 4 dès le lun. 24 nov.');
  });
});

describe('engagement catalog: operator-tunable values', () => {
  // platform_engagement_config holds goal_default, shield_every_weeks and daily_streak_min: the wording takes them as {{placeholders}}, so an operator
  // edit never leaves the copy wrong. A literal count of days or weeks in a catalog value is a copy of a config value (the milestone numbers of the
  // celebration, 7, 30 and 100 visits, are product constants and name visits, not days or weeks).
  const LITERAL_CONFIG = /(^|[^\d{])\d+\s*(days?|weeks?|jours?|semaines?)\b/i;
  // Epic 31 turns the Shield explainer's "Every 4 weeks" into a placeholder (deferred-work.md, 30.1 review); until its consumer ships it is the one exception.
  const KNOWN_LITERALS = ['engage.shield.explainer.body'];

  it.each(['en', 'fr'] as const)('no engage.* value in %s carries a literal day or week count', (lang) => {
    const flat = lang === 'en' ? EN : FR;
    const offenders = engageKeys(flat).filter((k) => !KNOWN_LITERALS.includes(k) && LITERAL_CONFIG.test(flat[k]));
    expect(offenders).toEqual([]);
  });

  it('the check can see a literal config value (positive control)', () => {
    expect(LITERAL_CONFIG.test('We started you at 3 days a week.')).toBe(true);
    expect(LITERAL_CONFIG.test('Nous démarrons à 3 jours par semaine.')).toBe(true);
    expect(LITERAL_CONFIG.test('We started you at {{count}} days a week.')).toBe(false);
  });
});

describe('engagement catalog: tone', () => {
  const FORBIDDEN = [/!/, /last chance/i, /streak lost/i, /dernière chance/i, /série perdue/i];

  it.each(['en', 'fr'] as const)('no engage.* or n08.* value in %s has an exclamation mark or loss wording', (lang) => {
    const flat = lang === 'en' ? EN : FR;
    const offenders = engageKeys(flat).filter((k) => FORBIDDEN.some((re) => re.test(flat[k])));
    expect(offenders).toEqual([]);
  });

  it('the tone check can see a violation (positive control)', () => {
    expect(FORBIDDEN.some((re) => re.test('Last chance! Streak lost'))).toBe(true);
    expect(FORBIDDEN.some((re) => re.test('Goal met. Nice week.'))).toBe(false);
  });
});

describe('engagement catalog: reserved mascot keys', () => {
  it.each(['en', 'fr'] as const)('each is present and empty in %s', (lang) => {
    const flat = lang === 'en' ? EN : FR;
    for (const key of MASCOT_KEYS) {
      expect(key in flat, key).toBe(true);
      expect(flat[key], key).toBe('');
    }
  });

  it.each(['en', 'fr'] as const)('no other engage.* or n08.* key is empty in %s', (lang) => {
    const flat = lang === 'en' ? EN : FR;
    const empty = engageKeys(flat)
      .filter((k) => !MASCOT_KEYS.includes(k as (typeof MASCOT_KEYS)[number]))
      .filter((k) => flat[k].trim() === '');
    expect(empty).toEqual([]);
  });
});
