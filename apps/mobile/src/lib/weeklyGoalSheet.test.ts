import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

import en from '@/locales/en.json';
import fr from '@/locales/fr.json';
import type { SetWeeklyGoalOutcome, WeeklyGoal } from '@/services/weeklyGoal';

import {
  buildSheetViewModel,
  ONE_ROW_MIN_WIDTH,
  effectLineKeyFor,
  formatDayMonth,
  formatWeekdayDayMonth,
  initialChoice,
  isSaveEnabled,
  profileGoalValue,
  savedToastMessage,
  type SheetInput,
  type TFn,
} from './weeklyGoalSheet';

function makeT(resources: { en: object; fr: object } = { en, fr }, lng: 'en' | 'fr' = 'en'): TFn {
  const i18n = createInstance();
  void i18n.init({ lng, fallbackLng: 'en', resources: { en: { translation: resources.en }, fr: { translation: resources.fr } }, interpolation: { escapeValue: false }, initAsync: false });
  return (key, options) => i18n.t(key, options) as string;
}

const BASE: WeeklyGoal = {
  currentGoal: 3,
  currentGoalIsDefault: false,
  pendingGoal: null,
  pendingEffectiveWeek: null,
  nextEffectiveWeek: '2026-11-23',
  goalMin: 1,
  goalMax: 7,
};

function input(over: Partial<Omit<SheetInput, 'goal'>> & { goal?: Partial<WeeklyGoal> } = {}): SheetInput {
  const { goal, ...rest } = over;
  return { goal: { ...BASE, ...goal }, choice: 3, isConnected: true, saving: false, saveFailed: false, screenWidth: 390, t: makeT(), language: 'en', ...rest };
}

describe('date formatting', () => {
  it('formats a date-only string as the calendar day it names, whatever the device zone', () => {
    expect(formatDayMonth('2026-11-23', 'en')).toBe('23 Nov');
    expect(formatWeekdayDayMonth('2026-11-23', 'en')).toBe('Mon 23 Nov');
    expect(formatDayMonth('2026-11-23', 'fr')).toBe('23 novembre');
    expect(formatWeekdayDayMonth('2026-11-23', 'fr')).toBe('lun. 23 novembre');
  });

  it('formats a language it does not know as English', () => {
    expect(formatDayMonth('2026-12-07', 'de')).toBe('7 Dec');
  });
});

describe('effect line and Save', () => {
  it('equal to the goal in force reads no change, and Save is off', () => {
    const vm = buildSheetViewModel(input({ choice: 3 }));
    expect(vm.effectLineKey).toBe('engage.goal.noChange');
    expect(vm.effectLine).toBe('This is your current goal.');
    expect(vm.saveEnabled).toBe(false);
  });

  it('a different choice with nothing pending says when it starts and what this week stays at', () => {
    const vm = buildSheetViewModel(input({ choice: 5 }));
    expect(vm.effectLineKey).toBe('engage.goal.effective');
    expect(vm.effectLine).toBe('Starts Monday 23 Nov. This week stays at 3.');
    expect(vm.saveEnabled).toBe(true);
  });

  it('with a change pending, a new choice replaces it (pending line), and the pending choice itself disables Save', () => {
    const goal = { pendingGoal: 5, pendingEffectiveWeek: '2026-11-23' };
    const replace = buildSheetViewModel(input({ goal, choice: 4 }));
    expect(replace.effectLineKey).toBe('engage.goal.pending');
    expect(replace.effectLine).toBe('Your goal changes to 4 on Mon 23 Nov.');
    expect(replace.saveEnabled).toBe(true);

    const same = buildSheetViewModel(input({ goal, choice: 5 }));
    expect(same.effectLineKey).toBe('engage.goal.pending');
    expect(same.saveEnabled).toBe(false);
  });

  it('with a change pending, choosing the goal in force reads no change and Save is on (it cancels the pending change)', () => {
    const vm = buildSheetViewModel(input({ goal: { pendingGoal: 5, pendingEffectiveWeek: '2026-11-23' }, choice: 3 }));
    expect(vm.effectLineKey).toBe('engage.goal.noChange');
    expect(vm.saveEnabled).toBe(true);
  });

  it('offline: the options still work, Save is off and the offline line shows', () => {
    const vm = buildSheetViewModel(input({ choice: 6, isConnected: false }));
    expect(vm.saveEnabled).toBe(false);
    expect(vm.offlineLine).toBe("You're offline. Connect to change your goal.");
    expect(vm.effectLine).toBe('Starts Monday 23 Nov. This week stays at 3.');
  });

  it('a save in flight turns Save off, a failed save shows the error line', () => {
    expect(buildSheetViewModel(input({ choice: 6, saving: true })).saveEnabled).toBe(false);
    expect(buildSheetViewModel(input({ choice: 6, saveFailed: true })).errorLine).toBe("Couldn't save your goal. Try again.");
    expect(buildSheetViewModel(input({ choice: 6 })).errorLine).toBeNull();
    expect(buildSheetViewModel(input({ choice: 6 })).offlineLine).toBeNull();
  });

  it('exposes the pure rules', () => {
    expect(effectLineKeyFor(BASE, 3)).toBe('engage.goal.noChange');
    expect(isSaveEnabled(BASE, 4, true, false)).toBe(true);
    expect(isSaveEnabled(BASE, 4, false, false)).toBe(false);
    expect(initialChoice(BASE)).toBe(3);
    expect(initialChoice({ ...BASE, pendingGoal: 6, pendingEffectiveWeek: '2026-11-23' })).toBe(6);
  });
});

describe('pills', () => {
  it('has one pill per allowed goal, 1 to 7 by default, and follows the config range', () => {
    expect(buildSheetViewModel(input()).pills.map((p) => p.value)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(buildSheetViewModel(input({ goal: { goalMin: 2, goalMax: 6 } })).pills.map((p) => p.value)).toEqual([2, 3, 4, 5, 6]);
  });

  it('marks the goal in force and the chosen pill with a check, and names "current" in the accessible label', () => {
    const vm = buildSheetViewModel(input({ choice: 5 }));
    const byValue = (n: number) => vm.pills.find((p) => p.value === n)!;
    expect(byValue(3)).toMatchObject({ isCurrent: true, selected: false, showCheck: true, accessibilityLabel: '3 days a week, current' });
    expect(byValue(5)).toMatchObject({ isCurrent: false, selected: true, showCheck: true, accessibilityLabel: '5 days a week' });
    expect(byValue(1)).toMatchObject({ showCheck: false, accessibilityLabel: '1 day a week' });
    expect(vm.pills.filter((p) => p.selected)).toHaveLength(1);
  });

  it('is one row from 404pt (seven 44pt targets, six 8pt gaps, 24pt padding each side) and two rows (1 to 4, 5 to 7) below', () => {
    expect(buildSheetViewModel(input({ screenWidth: 404 })).pillRows.map((r) => r.map((p) => p.value))).toEqual([[1, 2, 3, 4, 5, 6, 7]]);
    expect(buildSheetViewModel(input({ screenWidth: 403 })).pillRows.map((r) => r.map((p) => p.value))).toEqual([[1, 2, 3, 4], [5, 6, 7]]);
    expect(buildSheetViewModel(input({ screenWidth: 360 })).pillRows.map((r) => r.map((p) => p.value))).toEqual([[1, 2, 3, 4], [5, 6, 7]]);
    expect(ONE_ROW_MIN_WIDTH).toBe(404);
    expect(buildSheetViewModel(input({ screenWidth: 320 })).pillRows.map((r) => r.map((p) => p.value))).toEqual([[1, 2, 3, 4], [5, 6, 7]]);
    expect(buildSheetViewModel(input({ screenWidth: 320, goal: { goalMax: 4 } })).pillRows.map((r) => r.map((p) => p.value))).toEqual([[1, 2, 3, 4]]);
  });
});

describe('default-goal hint', () => {
  it('shows while the goal in force is the default and nothing is pending', () => {
    expect(buildSheetViewModel(input({ goal: { currentGoalIsDefault: true } })).hint).toBe(
      'We started you at 3 days a week. Change it any time; a new goal starts next Monday.',
    );
    expect(buildSheetViewModel(input({ goal: { currentGoalIsDefault: false } })).hint).toBeNull();
    expect(buildSheetViewModel(input({ goal: { currentGoalIsDefault: true, pendingGoal: 5, pendingEffectiveWeek: '2026-11-23' } })).hint).toBeNull();
  });
});

describe('Profile row and toast', () => {
  const t = makeT();
  it('reads "3 days", and "3 days, then 4 from Mon 23 Nov" while pending', () => {
    expect(profileGoalValue(BASE, t, 'en')).toBe('3 days');
    expect(profileGoalValue({ ...BASE, currentGoal: 1 }, t, 'en')).toBe('1 day');
    expect(profileGoalValue({ ...BASE, pendingGoal: 4, pendingEffectiveWeek: '2026-11-23' }, t, 'en')).toBe('3 days, then 4 from Mon 23 Nov');
  });

  it('reads in French', () => {
    const tFr = makeT({ en, fr }, 'fr');
    expect(profileGoalValue({ ...BASE, pendingGoal: 4, pendingEffectiveWeek: '2026-11-23' }, tFr, 'fr')).toBe('3 jours, puis 4 dès le lun. 23 novembre');
    const vm = buildSheetViewModel(input({ t: tFr, language: 'fr', choice: 5 }));
    expect(vm.title).toBe('Objectif hebdomadaire');
    expect(vm.effectLine).toBe('Commence le lundi 23 novembre. Cette semaine reste à 3.');
  });

  it('the toast says when the goal starts, or that nothing changed after a cancel', () => {
    const saved: SetWeeklyGoalOutcome = { goal: 5, effectiveWeek: '2026-11-23', currentGoal: 3, currentGoalIsDefault: false };
    expect(savedToastMessage(saved, t, 'en')).toBe('Goal saved. Starts Mon 23 Nov.');
    expect(savedToastMessage({ ...saved, goal: 3, effectiveWeek: null }, t, 'en')).toBe('This is your current goal.');
  });
});

// FR-232: wording is data. The screens render only this view model, so a catalog value swapped for a sentinel must show up in it.
describe('wording is data (sentinel)', () => {
  function withSentinel(path: string[], value: string) {
    const clone = JSON.parse(JSON.stringify(en)) as Record<string, unknown>;
    let node = clone;
    for (const key of path.slice(0, -1)) node = node[key] as Record<string, unknown>;
    node[path[path.length - 1]] = value;
    return makeT({ en: clone, fr });
  }

  it.each([
    [['engage', 'goal', 'title'], (vm: ReturnType<typeof buildSheetViewModel>) => vm.title, {}],
    [['engage', 'goal', 'prompt'], (vm: ReturnType<typeof buildSheetViewModel>) => vm.prompt, {}],
    [['engage', 'goal', 'why'], (vm: ReturnType<typeof buildSheetViewModel>) => vm.why, {}],
    [['engage', 'goal', 'cta', 'save'], (vm: ReturnType<typeof buildSheetViewModel>) => vm.saveLabel, {}],
    [['engage', 'goal', 'noChange'], (vm: ReturnType<typeof buildSheetViewModel>) => vm.effectLine, { choice: 3 }],
    [['engage', 'goal', 'effective'], (vm: ReturnType<typeof buildSheetViewModel>) => vm.effectLine, { choice: 5 }],
    [['engage', 'goal', 'offline'], (vm: ReturnType<typeof buildSheetViewModel>) => vm.offlineLine, { isConnected: false }],
    [['engage', 'goal', 'error'], (vm: ReturnType<typeof buildSheetViewModel>) => vm.errorLine, { saveFailed: true }],
    [['engage', 'ring', 'goalHint', 'default_other'], (vm: ReturnType<typeof buildSheetViewModel>) => vm.hint, { goal: { currentGoalIsDefault: true } }],
  ] as const)('%s', (path, pick, over) => {
    const sentinel = `SENTINEL-${path.join('.')}`;
    const vm = buildSheetViewModel(input({ ...(over as object), t: withSentinel([...path], sentinel) }));
    expect(pick(vm)).toBe(sentinel);
  });

  it('the pending effect line, the Profile value, and the toast read the catalog too', () => {
    const goal = { ...BASE, pendingGoal: 5, pendingEffectiveWeek: '2026-11-23' };
    const pendingT = withSentinel(['engage', 'goal', 'pending'], 'SENTINEL-pending');
    expect(buildSheetViewModel({ ...input({ choice: 4 }), goal, t: pendingT }).effectLine).toBe('SENTINEL-pending');
    expect(profileGoalValue(goal, withSentinel(['engage', 'profile', 'goal', 'pending_other'], 'SENTINEL-profile'), 'en')).toBe('SENTINEL-profile');
    expect(profileGoalValue(BASE, withSentinel(['engage', 'profile', 'goal', 'value_other'], 'SENTINEL-value'), 'en')).toBe('SENTINEL-value');
    const outcome: SetWeeklyGoalOutcome = { goal: 5, effectiveWeek: '2026-11-23', currentGoal: 3, currentGoalIsDefault: false };
    expect(savedToastMessage(outcome, withSentinel(['engage', 'goal', 'saved'], 'SENTINEL-saved'), 'en')).toBe('SENTINEL-saved');
  });

  it('the accessible pill label reads the catalog', () => {
    const vm = buildSheetViewModel(input({ t: withSentinel(['engage', 'goal', 'current'], 'SENTINEL-current') }));
    expect(vm.pills.find((p) => p.isCurrent)!.accessibilityLabel).toBe('3 days a week, SENTINEL-current');
  });
});
