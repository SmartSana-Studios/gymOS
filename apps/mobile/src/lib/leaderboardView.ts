import AsyncStorage from '@react-native-async-storage/async-storage';

import { addMonths, isMonthStart, monthStartOf } from '@/lib/calendarGrid';
import { formatClockTime } from '@/lib/clockTime';
import type { TFn } from '@/lib/weeklyGoalSheet';
import type { EngagementLoadOutcome } from '@/lib/weeklyRing';
import type { GetMyEngagementResult } from '@/services/engagement';
import { type LeaderboardRow, type LeaderboardSettings, type LeaderboardWriteResult } from '@/services/leaderboard';

/** Story 30.6 (FR-226, FR-227, FR-228, NFR-027; MA-19, MA-12, MA-09 N3): the pure view models of the gym leaderboard screen, its first-open notice, the
 * Profile "Appear as Anonymous" row and the Home card. The screens render only what this module returns. Every string comes from `t()` (wording is
 * data in the locale files). The SERVER decides everything about a member: who is "Anonymous", every label, rank, tie, total and `visits_behind`. This
 * module never sorts, ranks, counts, splits a name or builds a label: it maps the rows it is given, in the order it is given them, and chooses which
 * state to draw from the server's `rankedTotal`, never from a count of rows. The two month arguments are built from the server's own gym-local
 * "today" through calendarGrid.ts, never from the phone. */

/** FR-226: fewer than this many ranked members shows no names. The server enforces it (it sends one nameless row); the number is here only for the
 * sentence "appears once {{min}} members have visited" and for choosing the "not enough" face from the server's `rankedTotal`. */
export const MIN_RANKED = 3;

export type Tab = 'current' | 'previous';

/** The two months the board accepts, from the gym-local today the server returned. */
export function monthsFromToday(gymToday: string): { current: string; previous: string } {
  const current = monthStartOf(gymToday);
  return { current, previous: addMonths(current, -1) };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The device copy
// ---------------------------------------------------------------------------------------------------------------------------------------------
// A board copy holds only what the server already sent (labels it chose, 'Anonymous' where it chose that). It is written only after the member has
// chosen on the notice, and read only once the notice is known to be chosen, so a cached board is never shown before the choice. A hide made after the
// copy was taken applies from the next load (the offline screen says so).

const CACHE_KEY_PREFIX = 'gymos.engageLeaderboard.v1.';
export interface CachedBoard {
  rows: LeaderboardRow[];
  updatedAtMs: number;
}

export interface LeaderboardCache {
  /** The stored choice and the own-label preview, written only once the notice has been chosen on (so a copy implies it was). */
  settings: { hidden: boolean; ownLabel: string } | null;
  /** `YYYY-MM-01` to the board of that month. */
  months: Record<string, CachedBoard>;
}

export function leaderboardCacheKey(userId: string, gymId: string): string {
  return `${CACHE_KEY_PREFIX}${userId}.${gymId}`;
}

function emptyCache(): LeaderboardCache {
  return { settings: null, months: {} };
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** A stored row (the camel-case shape this app keeps) with every field of the right type, and the two row forms checked as forms. */
function isStoredRow(value: unknown): value is LeaderboardRow {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  const nullableInt = (v: unknown) => v === null || isInt(v);
  if (!nullableInt(r.position) || !nullableInt(r.rank) || !nullableInt(r.visits) || !nullableInt(r.visitsBehind)) return false;
  if (r.label !== null && typeof r.label !== 'string') return false;
  if (typeof r.isAnonymous !== 'boolean' || typeof r.isSelf !== 'boolean' || typeof r.isTied !== 'boolean' || typeof r.selfRanked !== 'boolean') return false;
  if (!isInt(r.rankedTotal) || r.rankedTotal < 0) return false;
  const detail = [r.position, r.rank, r.label, r.visits].map((v) => v !== null);
  return detail.every(Boolean) || !detail.some(Boolean);
}

function parseCache(raw: string | null): LeaderboardCache {
  if (!raw) return emptyCache();
  try {
    const parsed = JSON.parse(raw) as { settings?: unknown; months?: unknown } | null;
    if (!parsed || typeof parsed !== 'object') return emptyCache();
    let settings: LeaderboardCache['settings'] = null;
    const s = parsed.settings as { hidden?: unknown; ownLabel?: unknown } | null | undefined;
    if (s && typeof s.hidden === 'boolean' && typeof s.ownLabel === 'string') settings = { hidden: s.hidden, ownLabel: s.ownLabel };
    const months: Record<string, CachedBoard> = {};
    if (parsed.months && typeof parsed.months === 'object' && !Array.isArray(parsed.months)) {
      for (const [month, value] of Object.entries(parsed.months as Record<string, unknown>)) {
        const entry = value as { rows?: unknown; updatedAtMs?: unknown } | null;
        if (!isMonthStart(month) || !entry || typeof entry.updatedAtMs !== 'number' || !Number.isFinite(entry.updatedAtMs)) continue;
        const rows = entry.rows;
        if (!Array.isArray(rows) || rows[0] === undefined || !rows.every(isStoredRow)) continue;
        months[month] = { rows, updatedAtMs: entry.updatedAtMs };
      }
    }
    return { settings, months };
  } catch {
    return emptyCache();
  }
}

export async function readLeaderboardCache(userId: string, gymId: string): Promise<LeaderboardCache> {
  try {
    return parseCache(await AsyncStorage.getItem(leaderboardCacheKey(userId, gymId)));
  } catch {
    return emptyCache();
  }
}

// Every write is a read-modify-write of one key; they run one at a time so two overlapping writes cannot drop each other.
let writeChain: Promise<unknown> = Promise.resolve();

function update(userId: string, gymId: string, change: (cache: LeaderboardCache) => LeaderboardCache): Promise<boolean> {
  const run = writeChain.then(async () => {
    try {
      const key = leaderboardCacheKey(userId, gymId);
      const next = change(parseCache(await AsyncStorage.getItem(key)));
      await AsyncStorage.setItem(key, JSON.stringify({ settings: next.settings, months: next.months }));
      return true;
    } catch {
      return false;
    }
  });
  writeChain = run.catch(() => undefined);
  return run;
}

/** Stores one month's board as the server sent it. Call it only once the member has chosen on the notice. */
export function writeLeaderboardBoard(userId: string, gymId: string, month: string, rows: readonly LeaderboardRow[], updatedAtMs: number): Promise<boolean> {
  // Only the month written and the one before it are kept (the two months the board accepts); an older copy is dropped. `YYYY-MM-DD` compares as text.
  const oldest = addMonths(month, -1);
  return update(userId, gymId, (cache) => ({
    ...cache,
    months: Object.fromEntries(Object.entries({ ...cache.months, [month]: { rows: [...rows], updatedAtMs } }).filter(([key]) => key >= oldest)),
  }));
}

/** Stores the choice and the label preview. Call it only once the member has chosen on the notice. */
export function writeLeaderboardSettings(userId: string, gymId: string, settings: { hidden: boolean; ownLabel: string }): Promise<boolean> {
  return update(userId, gymId, (cache) => ({ ...cache, settings: { hidden: settings.hidden, ownLabel: settings.ownLabel } }));
}

// Home keeps only the member's own standing: no name, no other row.
const HOME_KEY_PREFIX = 'gymos.engageLeaderboardHome.v1.';

/** What the Home card needs and nothing more. */
export interface HomeStanding {
  rankedTotal: number;
  selfRanked: boolean;
  rank: number | null;
  visitsBehind: number | null;
}

export function standingFromRows(rows: readonly LeaderboardRow[]): HomeStanding | null {
  const first = rows[0];
  if (!first) return null;
  const own = rows.find((row) => row.isSelf);
  return { rankedTotal: first.rankedTotal, selfRanked: first.selfRanked, rank: own ? own.rank : null, visitsBehind: own ? own.visitsBehind : null };
}

export interface CachedStanding {
  standing: HomeStanding;
  updatedAtMs: number;
  /** The gym-local month (`YYYY-MM-01`) the standing was read for: a copy of another month is never shown as "this month". */
  month: string;
}

function isNullableInt(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value));
}

export async function readHomeStanding(userId: string, gymId: string): Promise<CachedStanding | null> {
  try {
    const raw = await AsyncStorage.getItem(`${HOME_KEY_PREFIX}${userId}.${gymId}`);
    if (!raw) return null;
    const p = JSON.parse(raw) as { standing?: Record<string, unknown>; updatedAtMs?: unknown; month?: unknown } | null;
    const s = p?.standing;
    if (!s || typeof p?.updatedAtMs !== 'number' || !Number.isFinite(p.updatedAtMs) || typeof p.month !== 'string' || !isMonthStart(p.month)) return null;
    if (typeof s.rankedTotal !== 'number' || !Number.isInteger(s.rankedTotal) || typeof s.selfRanked !== 'boolean' || !isNullableInt(s.rank) || !isNullableInt(s.visitsBehind)) return null;
    return { standing: { rankedTotal: s.rankedTotal, selfRanked: s.selfRanked, rank: s.rank, visitsBehind: s.visitsBehind }, updatedAtMs: p.updatedAtMs, month: p.month };
  } catch {
    return null;
  }
}

export async function writeHomeStanding(userId: string, gymId: string, standing: HomeStanding, updatedAtMs: number, month: string): Promise<boolean> {
  try {
    await AsyncStorage.setItem(`${HOME_KEY_PREFIX}${userId}.${gymId}`, JSON.stringify({ standing, updatedAtMs, month }));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Shared lines
// ---------------------------------------------------------------------------------------------------------------------------------------------

/** The line under the member's own standing: visits behind, level, or leading. The server sets `visitsBehind` on the member's row only (null = first). */
export function standingLine(visitsBehind: number | null, t: TFn): string {
  if (visitsBehind === null) return t('engage.leaderboard.leading');
  if (visitsBehind === 0) return t('engage.leaderboard.level');
  return t('engage.leaderboard.behind', { count: visitsBehind });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The dark-area gate and the plans every consumer follows
// ---------------------------------------------------------------------------------------------------------------------------------------------
// Everything below is a pure decision. The hooks and Profile call these and do what they say, so a rule (no leaderboard call in a dark area, a failed
// toggle reverts, a hide without the notice leaves the member un-noticed) is one tested function, not a branch copied into four files.

/** What an engagement read says about the area: `open` (the operator has set the release week), `dark` (it has not, or the caller is not a live member), or
 * `unknown` (the read failed, so nothing is known). */
export type EngagementGate = 'open' | 'dark' | 'unknown';

/** The gate from a `getMyEngagement()` result (the leaderboard screen and Profile). A missing result is `unknown`. */
export function gateFromResult(result: GetMyEngagementResult | null | undefined): EngagementGate {
  if (!result) return 'unknown';
  if (result.status === 'unavailable') return 'dark';
  if (result.status === 'success') return result.engagement.enabled ? 'open' : 'dark';
  return 'unknown';
}

/** The gate from the outcome of Home's engagement load (the Home card, which reuses the ring card's read). */
export function gateFromOutcome(outcome: EngagementLoadOutcome | null | undefined): EngagementGate {
  if (!outcome) return 'unknown';
  if (outcome.kind === 'dark') return 'dark';
  return outcome.kind === 'row' ? 'open' : 'unknown';
}

/** The only gate that lets a leaderboard function be called: a dark area and an unknown one call none. */
export function mayCallLeaderboard(gate: EngagementGate): boolean {
  return gate === 'open';
}

/** The gym-local month of an engagement row on hand (the live row, or the device copy of it); null when there is none or the area is off. */
export function monthOfEngagement(row: { enabled: boolean; gymToday: string } | null | undefined): string | null {
  return row && row.enabled ? monthsFromToday(row.gymToday).current : null;
}

/** The copy of the Home standing, only when it was read for `month` (the gym-local month of the row on hand). A copy of another month, or no month, is nothing. */
export function standingCopyFor(cached: CachedStanding | null, month: string | null): CachedStanding | null {
  return cached !== null && month !== null && cached.month === month ? cached : null;
}

export interface HomePlan {
  /** The board may be read now (the area is on). */
  call: boolean;
  /** What to draw without calling: nothing for a dark area; a device copy of this month's standing, or nothing, when it is unknown. Null when `call` is true. */
  show: HomeLoad | null;
  /** What to draw when the call fails: the device copy of this month, else the error card (the area is known to be on). */
  fallback: HomeLoad;
}

/** What Home's Leaderboard card does for an engagement gate. `month` is the gym-local month of the row on hand: the live row's, or, when the read failed,
 * the device copy's (null when there is none). */
export function planHomeLoad(input: { gate: EngagementGate; cached: CachedStanding | null; month: string | null }): HomePlan {
  const copy = standingCopyFor(input.cached, input.month);
  const fromCopy: HomeLoad | null = copy ? { kind: 'ready', standing: copy.standing, fromCache: true, updatedAtMs: copy.updatedAtMs } : null;
  if (mayCallLeaderboard(input.gate)) return { call: true, show: null, fallback: fromCopy ?? { kind: 'error' } };
  // Dark draws nothing; unknown draws a copy this device holds for this month and otherwise nothing (never an error card for a member who may be in a dark area).
  return { call: false, show: input.gate === 'dark' ? { kind: 'hidden' } : (fromCopy ?? { kind: 'hidden' }), fallback: { kind: 'hidden' } };
}

/** What Profile does with the Anonymous row after an engagement read: `read` the settings from the server (the area is on), `clear` the row (dark), use the
 * `device` copy (the read failed and the device copy of the engagement row says on), or `keep` what is showing. */
export function profileSettingsPlan(gate: EngagementGate, deviceCopyEnabled: boolean): 'read' | 'clear' | 'device' | 'keep' {
  if (gate === 'open') return 'read';
  if (gate === 'dark') return 'clear';
  return deviceCopyEnabled ? 'device' : 'keep';
}

/** The settings a device copy stands for. A copy exists only once the notice was chosen on, so it is `noticeSeen: true`. Null when there is none. */
export function settingsFromDeviceCopy(cache: LeaderboardCache): LeaderboardSettings | null {
  return cache.settings ? { hidden: cache.settings.hidden, noticeSeen: true, ownLabel: cache.settings.ownLabel } : null;
}

/** The settings after a toggle: the new choice on success, and the previous choice on failure (the optimistic flip is reverted). */
export function settingsAfterToggle(current: LeaderboardSettings, nextHidden: boolean, ok: boolean): LeaderboardSettings {
  return { ...current, hidden: ok ? nextHidden : current.hidden };
}

/** The settings after a notice choice. A written hide stands even when the mark failed (the member is hidden and un-noticed, never named); the notice
 * counts as chosen on only when the whole choice succeeded. */
export function settingsAfterNotice(current: LeaderboardSettings, outcome: NoticeOutcome): LeaderboardSettings {
  return { ...current, hidden: outcome.hiddenWritten ? true : current.hidden, noticeSeen: outcome.ok ? true : current.noticeSeen };
}

/** A device copy of the settings is kept only for a member who has chosen on the notice (every reader treats a copy as `noticeSeen: true`). */
export function mayKeepSettingsCopy(settings: LeaderboardSettings): boolean {
  return settings.noticeSeen;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The first-open notice
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type NoticeChoice = 'show' | 'hide';

export interface NoticeView {
  title: string;
  body: string;
  until: string;
  change: string;
  showLabel: string;
  hideLabel: string;
  /** `notice.error` after a failed choice; null otherwise. */
  error: string | null;
  /** `offline.notice` while the phone is offline: both buttons are off. */
  offlineNote: string | null;
  /** Both buttons are disabled: a call is running, or the phone is offline. */
  disabled: boolean;
  /** The button whose call is running (it shows the spinner), or null. */
  busy: NoticeChoice | null;
}

export interface NoticeInput {
  ownLabel: string;
  gymName: string | null;
  busy: NoticeChoice | null;
  failed: boolean;
  connected: boolean;
  t: TFn;
}

export function buildNoticeView(input: NoticeInput): NoticeView {
  const { t } = input;
  return {
    title: t('engage.leaderboard.notice.title'),
    body: t('engage.leaderboard.notice.body', { gym: input.gymName ?? '', label: input.ownLabel }),
    until: t('engage.leaderboard.notice.until'),
    change: t('engage.leaderboard.notice.change'),
    showLabel: t('engage.leaderboard.notice.cta.show'),
    hideLabel: t('engage.leaderboard.notice.cta.hide'),
    error: input.failed ? t('engage.leaderboard.notice.error') : null,
    offlineNote: input.connected ? null : t('engage.leaderboard.offline.notice'),
    disabled: input.busy !== null || !input.connected,
    busy: input.busy,
  };
}

export interface NoticeDeps {
  setVisibility: (hidden: boolean) => Promise<LeaderboardWriteResult>;
  markSeen: () => Promise<LeaderboardWriteResult>;
}

export interface NoticeOutcome {
  /** Both calls the choice needs succeeded: the notice is chosen on. */
  ok: boolean;
  /** The member's hidden choice was written (true after a successful [Appear as Anonymous], even when the second call then failed). */
  hiddenWritten: boolean;
}

/** [Show my name] calls only `mark_leaderboard_notice_seen`. [Appear as Anonymous] calls `set_leaderboard_visibility(true)` FIRST and only then
 * `mark_leaderboard_notice_seen`, so a failure between the two leaves the member hidden and un-noticed, never named. Never throws. */
export async function runNoticeChoice(choice: NoticeChoice, deps: NoticeDeps): Promise<NoticeOutcome> {
  let hiddenWritten = false;
  try {
    if (choice === 'hide') {
      const hidden = await deps.setVisibility(true);
      if (hidden.status !== 'success') return { ok: false, hiddenWritten: false };
      hiddenWritten = true;
    }
    const seen = await deps.markSeen();
    return { ok: seen.status === 'success', hiddenWritten };
  } catch {
    return { ok: false, hiddenWritten };
  }
}

/** Turning the toggle ON (hide) always saves. Turning it OFF (show my name) while the notice is unseen saves nothing and opens the notice. */
export function decideToggle(nextHidden: boolean, noticeSeen: boolean): 'save' | 'openNotice' {
  return !nextHidden && !noticeSeen ? 'openNotice' : 'save';
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The Profile row (MA-12)
// ---------------------------------------------------------------------------------------------------------------------------------------------

export interface AnonymousRowView {
  label: string;
  helper: string;
  checked: boolean;
  /** States the state: the toggle reads "…: on" or "…: off". */
  accessibilityLabel: string;
  disabled: boolean;
  linkLabel: string;
}

export function buildAnonymousRowView(input: { settings: LeaderboardSettings; pending: boolean; connected: boolean; t: TFn }): AnonymousRowView {
  const { settings, t } = input;
  const helper = !settings.noticeSeen
    ? t('engage.profile.anonymous.helperUnseen')
    : settings.hidden
      ? t('engage.profile.anonymous.helperOn')
      : t('engage.profile.anonymous.helperOff', { label: settings.ownLabel });
  return {
    label: t('engage.profile.anonymous.label'),
    helper,
    checked: settings.hidden,
    accessibilityLabel: t(settings.hidden ? 'engage.profile.anonymous.a11yOn' : 'engage.profile.anonymous.a11yOff'),
    disabled: input.pending || !input.connected,
    linkLabel: t('engage.profile.anonymous.link'),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The screen (MA-19)
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type BoardData =
  | { kind: 'loading' }
  | { kind: 'ready'; rows: readonly LeaderboardRow[]; fromCache: boolean; updatedAtMs: number | null }
  | { kind: 'error' };

export interface LeaderboardInput {
  tab: Tab;
  gymName: string | null;
  /** The member's settings: live, or the device copy (which exists only once the notice was chosen on). Null until known. */
  settings: LeaderboardSettings | null;
  /** The settings read has finished (settings is null after it failed). */
  settingsLoaded: boolean;
  board: BoardData;
  /** Real connectivity. */
  connected: boolean;
  visibilityPending: boolean;
  noticeBusy: NoticeChoice | null;
  noticeFailed: boolean;
  t: TFn;
  language: string;
}

export type LeaderboardFace = 'loading' | 'notice' | 'list' | 'notEnough' | 'error';

export interface RowView {
  kind: 'row';
  key: string;
  /** The server's rank, as text. */
  rankText: string;
  /** "Tied" on a tie, else null. */
  tied: string | null;
  icon: 'person' | 'visibility-off';
  label: string;
  isSelf: boolean;
  /** The visible "You" tag of the member's own row (shape and word, not colour alone). */
  selfTag: string | null;
  /** `hidden.self` inside the member's own row when others see them as Anonymous. */
  hiddenSelf: string | null;
  visitsText: string;
  /** Behind / level / leading, under the member's own row (current month only). */
  below: string | null;
  accessibilityLabel: string;
}

export interface GapView {
  kind: 'gap';
  key: string;
  accessibilityLabel: string;
}

export interface VisibilityRowView {
  label: string;
  helper: string;
  checked: boolean;
  accessibilityLabel: string;
  disabled: boolean;
}

export interface LeaderboardView {
  title: string;
  subtitle: string | null;
  tabs: { value: Tab; label: string }[];
  face: LeaderboardFace;
  notice: NoticeView | null;
  /** The rows and separators of the list face. */
  items: (RowView | GapView)[];
  /** In place of the member's own row when they are not ranked (3 or more ranked). */
  unrankedLine: string | null;
  notEnough: { title: string; body: string; support: string | null } | null;
  /** The text in the list slot of the error face. */
  errorText: string | null;
  banner: { text: string; updated: string | null; applies: string } | null;
  footnote: string | null;
  visibility: VisibilityRowView | null;
}

function buildItems(rows: readonly LeaderboardRow[], tab: Tab, t: TFn): (RowView | GapView)[] {
  const items: (RowView | GapView)[] = [];
  let previous: number | null = null;
  for (const row of rows) {
    if (row.position === null || row.rank === null || row.visits === null || row.label === null) continue;
    // The server's `position` lets the screen draw the separator where positions are not consecutive.
    if (previous !== null && row.position !== previous + 1) {
      items.push({ kind: 'gap', key: `gap-${row.position}`, accessibilityLabel: t('engage.leaderboard.row.gap') });
    }
    previous = row.position;
    const label = row.isSelf ? t('engage.leaderboard.row.you') : row.isAnonymous ? t('engage.leaderboard.row.anonymous') : row.label;
    const visitsText = t('engage.leaderboard.row.visits', { count: row.visits });
    const tied = row.isTied ? t('engage.leaderboard.row.tied') : null;
    const below = row.isSelf && tab === 'current' ? standingLine(row.visitsBehind, t) : null;
    const hiddenSelf = row.isSelf && row.isAnonymous ? t('engage.leaderboard.hidden.self') : null;
    items.push({
      kind: 'row',
      key: `row-${row.position}`,
      rankText: String(row.rank),
      tied,
      icon: row.isAnonymous ? 'visibility-off' : 'person',
      label,
      isSelf: row.isSelf,
      selfTag: row.isSelf ? t('engage.leaderboard.row.you') : null,
      hiddenSelf,
      visitsText,
      below,
      accessibilityLabel: [String(row.rank), tied, label, visitsText, hiddenSelf, below].filter((part): part is string => part !== null).join('. '),
    });
  }
  return items;
}

export function buildLeaderboardView(input: LeaderboardInput): LeaderboardView {
  const { t, settings, board, tab, language } = input;

  let face: LeaderboardFace;
  if (!input.settingsLoaded) face = 'loading';
  else if (!settings) face = 'error';
  else if (!settings.noticeSeen) face = 'notice';
  else if (board.kind === 'loading') face = 'loading';
  else if (board.kind === 'error') face = 'error';
  else face = board.rows[0] && board.rows[0].rankedTotal < MIN_RANKED ? 'notEnough' : 'list';

  const ready = board.kind === 'ready' ? board : null;
  const first = ready ? ready.rows[0] : undefined;

  let notEnough: LeaderboardView['notEnough'] = null;
  if (face === 'notEnough' && first) {
    const support =
      first.rankedTotal === 0
        ? t('engage.leaderboard.empty.month', { gym: input.gymName ?? '' })
        : !first.selfRanked
          ? t('engage.leaderboard.unranked')
          : first.rankedTotal === 1
            ? t('engage.leaderboard.onlyYou')
            : null;
    notEnough = { title: t('engage.leaderboard.notEnough.title'), body: t('engage.leaderboard.notEnough.body', { min: MIN_RANKED }), support };
  }

  const items = face === 'list' && ready ? buildItems(ready.rows, tab, t) : [];
  const unrankedLine = face === 'list' && first && !first.selfRanked ? t('engage.leaderboard.unranked') : null;

  const stale = ready !== null && ready.fromCache;
  const banner =
    face !== 'notice' && stale && ready
      ? {
          text: t('engage.leaderboard.offline.banner'),
          updated: ready.updatedAtMs !== null ? t('engage.updatedAt', { time: formatClockTime(ready.updatedAtMs, language) }) : null,
          applies: t('engage.leaderboard.offline.applies'),
        }
      : null;

  // The visibility row shows once the notice is chosen on, in every board state (a failed list keeps it); the notice has its own buttons.
  let visibility: VisibilityRowView | null = null;
  if (settings && settings.noticeSeen && face !== 'loading') {
    const row = buildAnonymousRowView({ settings, pending: input.visibilityPending, connected: input.connected, t });
    visibility = {
      label: t('engage.leaderboard.toggle.label'),
      helper: settings.hidden ? t('engage.leaderboard.hidden.self') : t('engage.leaderboard.visible.self', { label: settings.ownLabel }),
      checked: row.checked,
      accessibilityLabel: row.accessibilityLabel,
      disabled: row.disabled,
    };
  }

  return {
    title: t('engage.leaderboard.title'),
    subtitle: input.gymName,
    tabs: [
      { value: 'current', label: t('engage.leaderboard.tab.thisMonth') },
      { value: 'previous', label: t('engage.leaderboard.tab.lastMonth') },
    ],
    face,
    notice: face === 'notice' && settings ? buildNoticeView({ ownLabel: settings.ownLabel, gymName: input.gymName, busy: input.noticeBusy, failed: input.noticeFailed, connected: input.connected, t }) : null,
    items,
    unrankedLine,
    notEnough,
    errorText: face === 'error' ? t('engage.leaderboard.error.full') : null,
    banner,
    footnote: face === 'notice' || face === 'loading' ? null : t('engage.leaderboard.footnote'),
    visibility,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The Home card (MA-09 N3)
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type HomeLoad =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; standing: HomeStanding; fromCache: boolean; updatedAtMs: number | null };

export type HomeCardView =
  | { kind: 'hidden' }
  | { kind: 'skeleton' }
  | { kind: 'error'; title: string; text: string }
  | {
      kind: 'card';
      title: string;
      /** "Rank 9 of 43 this month", "Not enough members yet" or the unranked line. */
      headline: string;
      /** True when the headline is the rank sentence (drawn as the stat numeral). */
      isRank: boolean;
      /** Behind / level / leading; null when there is no rank. */
      line: string | null;
      /** "Updated 14:30" while a device copy is on screen. */
      updated: string | null;
      accessibilityLabel: string;
    };

export function buildHomeCardView(input: { load: HomeLoad; t: TFn; language: string }): HomeCardView {
  const { load, t, language } = input;
  const title = t('engage.leaderboard.title');
  if (load.kind === 'hidden') return { kind: 'hidden' };
  if (load.kind === 'loading') return { kind: 'skeleton' };
  if (load.kind === 'error') return { kind: 'error', title, text: t('engage.leaderboard.error.short') };

  const { standing } = load;
  let headline: string;
  let isRank = false;
  let line: string | null = null;
  if (standing.rankedTotal < MIN_RANKED) {
    headline = t('engage.leaderboard.notEnough.title');
  } else if (!standing.selfRanked || standing.rank === null) {
    headline = t('engage.leaderboard.unranked');
  } else {
    headline = t('engage.home.rank', { n: standing.rank, total: standing.rankedTotal });
    isRank = true;
    line = standingLine(standing.visitsBehind, t);
  }
  const updated = load.fromCache && load.updatedAtMs !== null ? t('engage.updatedAt', { time: formatClockTime(load.updatedAtMs, language) }) : null;
  return { kind: 'card', title, headline, isRank, line, updated, accessibilityLabel: [title, headline, line, updated].filter((part): part is string => part !== null).join('. ') };
}
