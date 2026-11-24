import type { MaterialIconsIconName } from '@react-native-vector-icons/material-icons';

import { buildMiniMonth, type MiniCell } from '@/lib/celebrationView';
import type { TFn } from '@/lib/weeklyGoalSheet';
import type { BadgeCode } from '@/lib/badgeCodes';

/** Story 31.3 (FR-231, FR-232; AD-60; MA-20 and MA-21 "Composition equals the shared image"): the share image as a pure view model. The composition is
 * a plain, serialisable tree of nodes; `components/ShareImageComposition.tsx` only maps the nodes to views, so what the image may contain is decided
 * here and can be tested without a renderer. The input type has NO field for a member name, a phone number, a payment figure, a reward or another
 * member's data: the only things that enter are the gym's name and logo, the milestone or the badge (and its date), and the member's own lit days.
 * There is no GymOS watermark. Nothing here reads the network, the clock or a table. */

/** Composed at 360 by 640 pt (the portrait ratio of a WhatsApp status) on the card background, captured at 1080 by 1920 px (3x). */
export const SHARE_POINT_WIDTH = 360;
export const SHARE_POINT_HEIGHT = 640;
export const SHARE_PX_WIDTH = 1080;
export const SHARE_PX_HEIGHT = 1920;
export const SHARE_BACKGROUND = '#0A0F17';

/** The size to hand to the capture so the PNG is 1080 by 1920 px whatever the screen density: the capture library takes logical pixels (Expo docs:
 * divide the target pixel size by PixelRatio.get()). */
export function captureSize(pixelRatio: number): { width: number; height: number } {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  // Whole logical pixels: a fractional size at ratios such as 2.625 or 2.75 can come out a pixel short or long.
  return { width: Math.round(SHARE_PX_WIDTH / ratio), height: Math.round(SHARE_PX_HEIGHT / ratio) };
}

export type ShareSubject =
  | { kind: 'milestone'; milestone: number }
  | { kind: 'badge'; code: BadgeCode; name: string; glyph: MaterialIconsIconName; earnedOnText: string | null };

export interface ShareImageInput {
  subject: ShareSubject;
  /** The gym's name; null when it could not be read (the image then has no gym line and no caption). */
  gymName: string | null;
  /** The gym's logo; omitted without an error when it is null or cannot be loaded. */
  logoUrl: string | null;
  /** The member's own current month (first of the month) and lit days, only where the card has room (`showMiniCalendar`); else null. */
  calendar: { month: string; litDays: readonly string[] } | null;
  t: TFn;
}

/** Copies exactly the allowed fields, never a spread: an object that carries more (a member name, a phone, a plan price, a loyalty reward) loses it. */
export function shareImageInputFrom(source: ShareImageInput): ShareImageInput {
  const subject: ShareSubject =
    source.subject.kind === 'milestone'
      ? { kind: 'milestone', milestone: source.subject.milestone }
      : { kind: 'badge', code: source.subject.code, name: source.subject.name, glyph: source.subject.glyph, earnedOnText: source.subject.earnedOnText };
  return {
    subject,
    gymName: source.gymName,
    logoUrl: source.logoUrl,
    calendar: source.calendar ? { month: source.calendar.month, litDays: [...source.calendar.litDays] } : null,
    t: source.t,
  };
}

/** The subject the image is about, as a key: `milestone:30`, `badge:visits_30`, or null with no input. A change of key is a different thing to share, so a
 * result (an error message, an unavailable answer) belongs to one key only. */
export function shareSubjectKey(input: Pick<ShareImageInput, 'subject'> | null): string | null {
  if (!input) return null;
  return input.subject.kind === 'milestone' ? `milestone:${input.subject.milestone}` : `badge:${input.subject.code}`;
}

export type ShareTextRole = 'gymName' | 'numeral' | 'unit' | 'headline' | 'badgeName' | 'date' | 'caption';

export type ShareNode =
  | { kind: 'logo'; uri: string }
  | { kind: 'glyph'; icon: MaterialIconsIconName }
  | { kind: 'text'; role: ShareTextRole; text: string }
  | { kind: 'calendar'; rows: MiniCell[][] };

export interface ShareComposition {
  variant: 'milestone' | 'badge';
  width: number;
  height: number;
  background: string;
  nodes: ShareNode[];
}

/** The composition for a milestone (7, 30 or 100) or an earned badge. Order, top to bottom: logo, gym name, the milestone numeral and headline or the
 * badge glyph, name and date, the mini month where it fits, the caption. */
export function buildShareComposition(raw: ShareImageInput): ShareComposition {
  // The allow-list copy runs on every build, so whatever a caller hands over beyond the declared fields (a name, a phone, a price, a reward) never reaches a node.
  const input = shareImageInputFrom(raw);
  const { subject, t } = input;
  const gym = input.gymName ?? '';
  const nodes: ShareNode[] = [];
  if (input.logoUrl) nodes.push({ kind: 'logo', uri: input.logoUrl });
  if (gym !== '') nodes.push({ kind: 'text', role: 'gymName', text: gym });

  if (subject.kind === 'milestone') {
    const n = subject.milestone;
    nodes.push({ kind: 'text', role: 'numeral', text: String(n) });
    nodes.push({ kind: 'text', role: 'unit', text: t('engage.celebration.unit') });
    nodes.push({ kind: 'text', role: 'headline', text: t(`engage.celebration.${n}.headline`) });
  } else {
    nodes.push({ kind: 'glyph', icon: subject.glyph });
    nodes.push({ kind: 'text', role: 'badgeName', text: subject.name });
    if (subject.earnedOnText) nodes.push({ kind: 'text', role: 'date', text: t('engage.badges.earnedOn', { date: subject.earnedOnText }) });
  }

  if (input.calendar) nodes.push({ kind: 'calendar', rows: buildMiniMonth(input.calendar.month, input.calendar.litDays) });

  if (gym !== '') {
    const caption =
      subject.kind === 'milestone' ? t(`engage.share.caption.${subject.milestone}`, { gym }) : t('engage.share.caption.badge', { badge: subject.name, gym });
    nodes.push({ kind: 'text', role: 'caption', text: caption });
  }

  return { variant: subject.kind, width: SHARE_POINT_WIDTH, height: SHARE_POINT_HEIGHT, background: SHARE_BACKGROUND, nodes };
}

/** The OS share sheet's options: the PNG file type on both platforms, the catalog's dialog title, and on iPad the sheet anchored to the button. */
export const SHARE_MIME_TYPE = 'image/png';
export const SHARE_UTI = 'public.png';

export interface ShareAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function buildShareOptions(dialogTitle: string, anchor?: ShareAnchor): { mimeType: string; UTI: string; dialogTitle: string; anchor?: ShareAnchor } {
  return { mimeType: SHARE_MIME_TYPE, UTI: SHARE_UTI, dialogTitle, ...(anchor ? { anchor } : {}) };
}
