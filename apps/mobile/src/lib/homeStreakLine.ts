import type { HomeEngagementView } from '@/lib/weeklyRing';
import type { TFn } from '@/lib/weeklyGoalSheet';
import type { Engagement } from '@/services/engagement';

/** Story 31.4: the one line Home keeps for the engagement area, "3-week streak" or "1 of 3 this week", which opens the Streak tab. Pure: the numbers are the
 * server's row (`streakWeeks`, `visitsThisWeek`, `goal`), the words are the locale's, and the rule for "a streak is active" is the ring card's own (the
 * view's `streak.kind === 'chip'`, so the line and the card never disagree). Null for every face but a card (hidden, dark, loading, error): no line then. */
export interface HomeStreakLineView {
  text: string;
  /** The same sentence for a screen reader. */
  accessibilityLabel: string;
}

export function buildHomeStreakLine(view: HomeEngagementView, engagement: Engagement | null, t: TFn): HomeStreakLineView | null {
  if (view.kind !== 'card' || !engagement) return null;
  const weeks = engagement.streakWeeks ?? 0;
  const text =
    view.streak.kind === 'chip' && weeks >= 1
      ? t('engage.home.line.streak', { count: weeks })
      : t('engage.home.line.week', { done: view.ring.accessibilityValue.now, goal: view.ring.goal });
  return { text, accessibilityLabel: text };
}
