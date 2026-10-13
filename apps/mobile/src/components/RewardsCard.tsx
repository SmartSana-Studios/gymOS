import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/Card';
import { IconChip } from '@/components/ui/IconChip';
import { Spacing } from '@/constants/theme';
import { useGymAccentColor } from '@/hooks/use-gym-accent-color';
import { useTheme } from '@/hooks/use-theme';
import { buildRewardsView, type RewardsData, type RewardsHeadline } from '@/lib/rewards';
import { readSeenGrants, recordSeenGrants } from '@/services/loyaltySeen';

// Date-only string ("YYYY-MM-DD") built at local midnight, same as Home.
function formatDateOnly(value: string, locale: string, style: 'medium' | 'long'): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale, { dateStyle: style });
}

function formatInstant(value: string, locale: string, style: 'medium' | 'long'): string {
  return new Date(value).toLocaleDateString(locale, { dateStyle: style });
}

export interface RewardsCardProps {
  data: RewardsData | null;
  planType: string | null;
}

/** Story 20.6 / MA-09: flat Rewards card on Home. Absent (not empty) unless
 * the program is on or an unexpired free session is held. Read-only. */
export function RewardsCard({ data, planType }: RewardsCardProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const accent = useGymAccentColor();
  const locale = i18n.language;

  // Seen grant ids for this user + gym. null = unread or unreadable, which
  // suppresses the headline (storage failure must not repeat it).
  const scope = data?.scope ?? null;
  const [seenState, setSeenState] = useState<{ scope: string; ids: Set<string> } | null>(null);
  const seen = seenState && seenState.scope === scope ? seenState.ids : null;
  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    void readSeenGrants(scope).then((ids) => {
      if (!cancelled) setSeenState(ids ? { scope, ids } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const view = useMemo(() => buildRewardsView(data, planType, seen), [data, planType, seen]);

  // The headline is recorded first and shown only if the record succeeded,
  // then latched for this `data` so it stays for the render that earned it
  // and is gone on the next refetch.
  const [shown, setShown] = useState<{ data: RewardsData; headline: RewardsHeadline } | null>(null);
  const pending = view?.headline ?? null;
  useEffect(() => {
    if (!data || !pending || !scope || shown?.data === data) return;
    let cancelled = false;
    void recordSeenGrants(scope, pending.grantIds).then((ok) => {
      if (cancelled || !ok) return;
      setShown({ data, headline: pending });
      setSeenState((prev) => (prev && prev.scope === scope ? { scope, ids: new Set([...prev.ids, ...pending.grantIds]) } : prev));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, pending, scope]);

  if (!view || !data) return null;
  const headline = shown?.data === data ? shown.headline : null;
  const { progress } = view;
  // Absent, not a bare title (e.g. enabled with no thresholds yet).
  if (!progress && view.rows.length === 0 && !view.freeDays && !headline) return null;

  let progressLabel = '';
  let progressCaption = '';
  if (progress) {
    const params = { current: progress.current, total: progress.total, count: progress.rewardDays ?? 0 };
    if (progress.counter === 'guest') {
      progressLabel = t('home.rewards.guestLabel', params);
      progressCaption = t('home.rewards.guestCaption');
    } else {
      progressLabel = t('home.rewards.subscriberLabel', params);
      progressCaption = t('home.rewards.subscriberCaption', params);
    }
  }

  let footnote: string | null = null;
  if (view.footnote?.kind === 'guest' && view.footnote.windowDays !== null) {
    footnote = t('home.rewards.footnoteGuest', { count: view.footnote.windowDays });
  } else if (view.footnote?.kind === 'subscriber') {
    footnote = t('home.rewards.footnoteSubscriber');
  }

  return (
    <Card variant="flat" style={styles.card}>
      <ThemedText type="smallBold">{t('home.rewards.title')}</ThemedText>

      {headline && (
        <ThemedText type="smallBold" accessibilityLiveRegion="polite" style={{ color: '#4ADE80' }}>
          {t('home.rewards.headline', { count: headline.validityDays })}
        </ThemedText>
      )}

      {view.freeDays && (
        <ThemedText type="small">
          {t('home.rewards.freeDays', {
            count: view.freeDays.days,
            date: formatDateOnly(view.freeDays.expiryDate, locale, 'medium'),
          })}
        </ThemedText>
      )}

      {progress && (
        <View accessible accessibilityLabel={progressLabel} style={styles.progress}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.progressInner}>
            <ThemedText type="smallBold">
              {t('home.rewards.counter', { current: progress.current, total: progress.total })}
            </ThemedText>
            {progress.display === 'segments' ? (
              <View style={styles.segments}>
                {Array.from({ length: progress.total }, (_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.segment,
                      { backgroundColor: i < progress.current ? accent : theme.backgroundSelected },
                    ]}
                  />
                ))}
              </View>
            ) : (
              <View style={[styles.bar, { backgroundColor: theme.backgroundSelected }]}>
                <View
                  style={[
                    styles.barFill,
                    { backgroundColor: accent, width: `${(progress.current / progress.total) * 100}%` },
                  ]}
                />
              </View>
            )}
            <ThemedText type="small" themeColor="textSecondary">
              {progressCaption}
            </ThemedText>
          </View>
        </View>
      )}

      {view.rows.map((row) => {
        const free = row.kind === 'free';
        const label = t(free ? 'home.rewards.freeRowLabel' : 'home.rewards.paidRowLabel', {
          date: formatInstant(row.usableUntil, locale, 'long'),
        });
        const text = t(free ? 'home.rewards.freeRow' : 'home.rewards.paidRow', {
          date: formatInstant(row.usableUntil, locale, 'medium'),
        });
        const dormantNote = free && row.dormant ? t('home.rewards.dormantNote') : null;
        return (
          <View
            key={`${row.kind}-${row.id}`}
            accessible
            accessibilityLabel={dormantNote ? `${label}. ${dormantNote}` : label}
            style={styles.row}
          >
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <IconChip
                icon={free ? 'card-giftcard' : 'confirmation-number'}
                tint={free ? (row.dormant ? 'neutral' : 'success') : 'accent'}
              />
            </View>
            <View style={styles.rowText}>
              <ThemedText type="smallBold">{text}</ThemedText>
              {dormantNote && (
                <ThemedText type="small" themeColor="textSecondary">
                  {dormantNote}
                </ThemedText>
              )}
            </View>
          </View>
        );
      })}

      {footnote && (
        <ThemedText type="small" themeColor="textSecondary">
          {footnote}
        </ThemedText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two },
  progress: { gap: Spacing.one },
  progressInner: { gap: Spacing.one },
  segments: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 10, borderRadius: 5 },
  bar: { height: 10, borderRadius: 5, overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  rowText: { flex: 1 },
});
