import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

import en from '@/locales/en.json';
import fr from '@/locales/fr.json';

import {
  buildShareComposition,
  buildShareOptions,
  captureSize,
  SHARE_BACKGROUND,
  SHARE_POINT_HEIGHT,
  SHARE_POINT_WIDTH,
  SHARE_PX_HEIGHT,
  SHARE_PX_WIDTH,
  shareImageInputFrom,
  shareSubjectKey,
  type ShareComposition,
  type ShareImageInput,
} from './shareImage';
import type { TFn } from './weeklyGoalSheet';

function makeT(lng: 'en' | 'fr' = 'en'): TFn {
  const i18n = createInstance();
  void i18n.init({ lng, fallbackLng: 'en', resources: { en: { translation: en }, fr: { translation: fr } }, interpolation: { escapeValue: false }, initAsync: false });
  return (key, options) => i18n.t(key, options) as string;
}

const LIT = ['2026-11-02', '2026-11-04', '2026-11-09'];
const milestone = (over: Partial<ShareImageInput> = {}, lng: 'en' | 'fr' = 'en'): ShareImageInput => ({
  subject: { kind: 'milestone', milestone: 30 },
  gymName: 'Iron Gym',
  logoUrl: 'https://cdn.example/iron.png',
  calendar: { month: '2026-11-01', litDays: LIT },
  t: makeT(lng),
  ...over,
});
const badge = (over: Partial<ShareImageInput> = {}, lng: 'en' | 'fr' = 'en'): ShareImageInput => ({
  subject: { kind: 'badge', code: 'visits_30', name: lng === 'en' ? '30 visits' : '30 visites', glyph: 'local-fire-department', earnedOnText: lng === 'en' ? '14 Oct' : '14 octobre' },
  gymName: 'Iron Gym',
  logoUrl: 'https://cdn.example/iron.png',
  calendar: { month: '2026-11-01', litDays: LIT },
  t: makeT(lng),
  ...over,
});
const texts = (c: ShareComposition) => c.nodes.flatMap((n) => (n.kind === 'text' ? [[n.role, n.text] as const] : []));

describe('the size', () => {
  it('is composed at 360 by 640 pt on the card background and captured at 1080 by 1920 px (3x)', () => {
    const c = buildShareComposition(milestone());
    expect([c.width, c.height, c.background]).toEqual([SHARE_POINT_WIDTH, SHARE_POINT_HEIGHT, SHARE_BACKGROUND]);
    expect([SHARE_POINT_WIDTH, SHARE_POINT_HEIGHT, SHARE_BACKGROUND]).toEqual([360, 640, '#0A0F17']);
    expect([SHARE_PX_WIDTH / SHARE_POINT_WIDTH, SHARE_PX_HEIGHT / SHARE_POINT_HEIGHT]).toEqual([3, 3]);
  });

  it.each([1, 2, 2.625, 2.75, 3])('the capture size at pixel ratio %f is whole logical pixels, the nearest to 1080 by 1920 px', (ratio) => {
    const size = captureSize(ratio);
    expect(Number.isInteger(size.width)).toBe(true);
    expect(Number.isInteger(size.height)).toBe(true);
    // Whole logical pixels land on a multiple of the ratio, so the nearest size is within half a logical pixel (ratio / 2) of the target: within 1 px at
    // ratios 1, 2, 2.75 and 3, and 1.125 px at 2.625, where no whole logical size does better.
    expect(Math.abs(size.width * ratio - 1080)).toBeLessThanOrEqual(ratio / 2);
    expect(Math.abs(size.height * ratio - 1920)).toBeLessThanOrEqual(ratio / 2);
    if (ratio !== 2.625) {
      expect(Math.abs(size.width * ratio - 1080)).toBeLessThanOrEqual(1);
      expect(Math.abs(size.height * ratio - 1920)).toBeLessThanOrEqual(1);
    }
  });

  it('a pixel ratio that is not a positive number falls back to 1, never NaN', () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) expect(captureSize(bad)).toEqual({ width: 1080, height: 1920 });
  });
});

describe('the milestone composition', () => {
  it.each([
    ['en', 7, 'visits', '7 visits', '7 visits at Iron Gym. One day at a time.'],
    ['en', 30, 'visits', '30 visits', '30 visits at Iron Gym. One day at a time.'],
    ['en', 100, 'visits', '100 visits', '100 visits at Iron Gym. One day at a time.'],
    ['fr', 30, 'visites', '30 visites', '30 visites chez Iron Gym. Un jour après l\'autre.'],
  ] as const)('%s, %i: logo, gym name, numeral, unit, headline, calendar and caption in order', (lang, n, unit, headline, caption) => {
    const c = buildShareComposition(milestone({ subject: { kind: 'milestone', milestone: n } }, lang));
    expect(c.variant).toBe('milestone');
    expect(c.nodes.map((node) => (node.kind === 'text' ? node.role : node.kind))).toEqual(['logo', 'gymName', 'numeral', 'unit', 'headline', 'calendar', 'caption']);
    expect(texts(c)).toEqual([['gymName', 'Iron Gym'], ['numeral', String(n)], ['unit', unit], ['headline', headline], ['caption', caption]]);
  });

  it('the calendar holds only the member\'s own lit days, no numerals', () => {
    const c = buildShareComposition(milestone());
    const calendar = c.nodes.find((n) => n.kind === 'calendar');
    expect(calendar?.kind === 'calendar' && calendar.rows.flat().filter((cell) => cell.lit).map((cell) => cell.date)).toEqual(LIT);
    expect(Object.keys(calendar?.kind === 'calendar' ? calendar.rows[0][0] : {}).sort()).toEqual(['date', 'lit']);
  });

  it('without room (no calendar given) the image has none', () => {
    const c = buildShareComposition(milestone({ calendar: null }));
    expect(c.nodes.some((n) => n.kind === 'calendar')).toBe(false);
  });

  it('without a logo the image is made with the gym name only, no error and no placeholder', () => {
    const c = buildShareComposition(milestone({ logoUrl: null }));
    expect(c.nodes.some((n) => n.kind === 'logo')).toBe(false);
    expect(texts(c)[0]).toEqual(['gymName', 'Iron Gym']);
  });

  it('without a readable gym name there is no gym line and no caption (never "at null")', () => {
    const c = buildShareComposition(milestone({ gymName: null }));
    expect(texts(c).map(([, text]) => text).join(' ')).not.toMatch(/null|undefined| at \./);
    expect(texts(c).map(([role]) => role)).toEqual(['numeral', 'unit', 'headline']);
  });
});

describe('the badge composition', () => {
  it.each([
    ['en', '30 visits', 'Earned 14 Oct', '30 visits at Iron Gym.'],
    ['fr', '30 visites', 'Obtenu le 14 octobre', '30 visites chez Iron Gym.'],
  ] as const)('%s: logo, gym name, glyph, badge name, date earned, calendar and caption', (lang, name, date, caption) => {
    const c = buildShareComposition(badge({}, lang));
    expect(c.variant).toBe('badge');
    expect(c.nodes.map((node) => (node.kind === 'text' ? node.role : node.kind))).toEqual(['logo', 'gymName', 'glyph', 'badgeName', 'date', 'calendar', 'caption']);
    expect(texts(c)).toEqual([['gymName', 'Iron Gym'], ['badgeName', name], ['date', date], ['caption', caption]]);
    expect(c.nodes.find((n) => n.kind === 'glyph')).toEqual({ kind: 'glyph', icon: 'local-fire-department' });
  });

  it('a badge without a known date has no date line', () => {
    const c = buildShareComposition(badge({ subject: { kind: 'badge', code: 'first_visit', name: 'First visit', glyph: 'flag', earnedOnText: null } }));
    expect(texts(c).some(([role]) => role === 'date')).toBe(false);
  });
});

describe('privacy (FR-231)', () => {
  // Everything a member screen could hold in state beside what the image may carry.
  const STATE = {
    member: { name: 'Aïcha Test', phone: '+237 6 99 99 99 99', email: 'aicha@example.com' },
    plan: { name: 'Gold Monthly', price: 15000, currency: 'XAF' },
    loyalty: { reward: 'Free protein shake', stamps: 7 },
    other: { rank: 'Marc D.', visitsOfNeighbour: 41 },
  };
  const FORBIDDEN = ['Aïcha', 'Test', '+237', '699', '6 99', 'aicha@', 'Gold Monthly', '15000', '15 000', 'XAF', 'protein', 'Marc', 'GymOS', 'gymos'];

  // What a screen could hand over beyond the declared fields (state spread into the input, a subject that carries a name): the builder itself drops it.
  function withExtras(base: ShareImageInput): ShareImageInput {
    return { ...base, ...STATE, subject: { ...base.subject, memberName: 'Aïcha Test', phone: '+237 6 99 99 99 99' } } as unknown as ShareImageInput;
  }

  // The nodes a composition may contain, and the text roles a text node may have. A new kind or role must be added here on purpose.
  const NODE_KINDS = ['logo', 'glyph', 'text', 'calendar'];
  const TEXT_ROLES = ['gymName', 'numeral', 'unit', 'headline', 'badgeName', 'date', 'caption'];

  it.each([['milestone', milestone()], ['badge', badge()]] as const)('a %s composition built straight from an input that carries that state serialises none of it', (_name, input) => {
    const composition = buildShareComposition(withExtras(input));
    const serialised = JSON.stringify(composition);
    for (const needle of FORBIDDEN) expect(serialised, needle).not.toContain(needle);
    // Every text node is one of the allowed roles, and its text is the gym's, the milestone or badge's, the date's or the caption's: nothing from STATE.
    for (const node of composition.nodes) {
      expect(NODE_KINDS).toContain(node.kind);
      if (node.kind === 'text') expect(TEXT_ROLES).toContain(node.role);
    }
    expect(Object.keys(JSON.parse(serialised)).sort()).toEqual(['background', 'height', 'nodes', 'variant', 'width']);
    // The composition is the same as one built from a clean input: the extras changed nothing.
    expect(composition).toEqual(buildShareComposition(input));
  });

  it('the node kinds and text roles of every composition are within the allow-list (a new role fails here)', () => {
    for (const lang of ['en', 'fr'] as const) {
      for (const input of [milestone({}, lang), badge({}, lang), milestone({ calendar: null, logoUrl: null }, lang)]) {
        for (const node of buildShareComposition(input).nodes) {
          expect(NODE_KINDS).toContain(node.kind);
          if (node.kind === 'text') expect(TEXT_ROLES).toContain(node.role);
        }
      }
    }
  });

  it('the subject key tells one thing to share from another', () => {
    expect(shareSubjectKey(null)).toBeNull();
    expect(shareSubjectKey(milestone())).toBe('milestone:30');
    expect(shareSubjectKey(badge())).toBe('badge:visits_30');
    expect(shareSubjectKey(badge({ subject: { kind: 'badge', code: 'first_visit', name: 'First visit', glyph: 'flag', earnedOnText: null } }))).toBe('badge:first_visit');
  });

  it('the copy keeps exactly the allowed fields and nothing else', () => {
    const copy = shareImageInputFrom({ ...milestone(), ...STATE } as unknown as ShareImageInput);
    expect(Object.keys(copy).sort()).toEqual(['calendar', 'gymName', 'logoUrl', 'subject', 't']);
    expect(Object.keys(copy.subject).sort()).toEqual(['kind', 'milestone']);
    const b = shareImageInputFrom({ ...badge(), ...STATE } as unknown as ShareImageInput);
    expect(Object.keys(b.subject).sort()).toEqual(['code', 'earnedOnText', 'glyph', 'kind', 'name']);
  });

  it('the props type has no field for a name, a phone, a price or a reward (type level)', () => {
    type Keys = keyof ShareImageInput;
    type Forbidden = 'name' | 'memberName' | 'phone' | 'email' | 'price' | 'amount' | 'reward' | 'rank' | 'watermark' | 'brand';
    // Extract<> is `never` when no forbidden key is a key of the input; tsc fails this file otherwise.
    const none: [Extract<Keys, Forbidden>] extends [never] ? true : false = true;
    expect(none).toBe(true);
    // An object literal with a forbidden field is rejected by the compiler (excess property check).
    const rejected: ShareImageInput = {
      ...milestone(),
      // @ts-expect-error a member name is not a field of the share input
      memberName: 'Aïcha Test',
    };
    expect(rejected).toBeTruthy();
    // @ts-expect-error a phone number is not a field of the share input
    const rejectedPhone: ShareImageInput = { ...milestone(), phone: '+237' };
    expect(rejectedPhone).toBeTruthy();
  });

  it('there is no GymOS watermark node, whatever the variant or language', () => {
    for (const lang of ['en', 'fr'] as const) {
      for (const input of [milestone({}, lang), badge({}, lang)]) {
        expect(JSON.stringify(buildShareComposition(input)).toLowerCase()).not.toContain('gymos');
      }
    }
  });

  it('the composition builder reads nothing but its input (no network, no storage, no clock)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(fileURLToPath(new URL('./shareImage.ts', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/fetch\(|supabase|AsyncStorage|Date\.|new Date|XMLHttpRequest|WebSocket/);
  });
});

describe('the OS share sheet options', () => {
  it('the PNG type on both platforms and the catalog title, without an anchor off iPad', () => {
    expect(buildShareOptions('Share your progress')).toEqual({ mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share your progress' });
  });

  it('on iPad the sheet is anchored to the button', () => {
    const anchor = { x: 20, y: 600, width: 320, height: 52 };
    expect(buildShareOptions('Partager votre progression', anchor)).toEqual({ mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Partager votre progression', anchor });
  });

  it('the dialog title is in the catalog in both languages', () => {
    expect(makeT('en')('engage.share.dialogTitle')).toBe('Share your progress');
    expect(makeT('fr')('engage.share.dialogTitle')).toBe('Partager votre progression');
  });
});
