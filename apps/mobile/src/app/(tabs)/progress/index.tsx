import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Circle, Path, Svg } from 'react-native-svg';

import { LogEntrySheet } from '@/components/LogEntrySheet';
import { Button } from '@/components/ui/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { STATUS_COLORS } from '@/constants/subscription-status';
import { useTheme } from '@/hooks/use-theme';
import { useGymAccentColor } from '@/hooks/use-gym-accent-color';
import { getContrastTextColor } from '@/lib/color-contrast';
import { getProgressPhotoSignedUrl } from '@/lib/photo-upload';
import { useOfflineSync } from '@/lib/offline-sync-context';
import { supabase } from '@/lib/supabase';
import {
  getCachedProgressPayload,
  getCurrentMember,
  loadProgressScreenData,
  type ProgressEntryRow,
  type ProgressScreenData,
} from '@/services/progress';

const MEASUREMENT_FIELDS: { key: 'waistCm' | 'chestCm' | 'hipsCm' | 'armsCm' | 'thighsCm'; labelKey: string }[] = [
  { key: 'waistCm', labelKey: 'progress.screen.waistLabel' },
  { key: 'chestCm', labelKey: 'progress.screen.chestLabel' },
  { key: 'hipsCm', labelKey: 'progress.screen.hipsLabel' },
  { key: 'armsCm', labelKey: 'progress.screen.armsLabel' },
  { key: 'thighsCm', labelKey: 'progress.screen.thighsLabel' },
];

const CHART_HEIGHT = 160;
const CHART_PADDING = 16;

function formatChartDate(value: string, locale: string): string {
  return new Date(value).toLocaleDateString(locale, { dateStyle: 'medium' });
}

function formatDelta(delta: number, unit: string): string {
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)} ${unit}`;
}

interface ChartPoint {
  x: number;
  y: number;
  loggedAt: string;
  weightKg: number;
}

// Story 10.3 Task 5: this codebase has no charting library anywhere
// (confirmed via `grep -iE "chart|victory|skia|svg" apps/mobile/package.json`
// returning zero matches before this story) -- EXPERIENCE.md MA-15
// explicitly leaves the choice to the implementer, "no new dependency
// mandated." `react-native-svg` was added (`npx expo install`, letting Expo
// resolve the SDK-57-compatible version) and this draws a single polyline +
// tappable point markers directly, rather than pulling in a full charting
// library for one simple line series. Recorded in docs/decisions.md.
function buildWeightChartGeometry(entries: ProgressEntryRow[], width: number): { path: string; points: ChartPoint[] } {
  const weightEntries = entries.filter((entry): entry is ProgressEntryRow & { weightKg: number } => entry.weightKg != null);
  if (weightEntries.length < 2) return { path: '', points: [] };

  const times = weightEntries.map((entry) => new Date(entry.loggedAt).getTime());
  const weights = weightEntries.map((entry) => entry.weightKg);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);
  const timeSpan = maxTime - minTime || 1;
  const weightSpan = maxWeight - minWeight || 1;
  const innerWidth = width - CHART_PADDING * 2;
  const innerHeight = CHART_HEIGHT - CHART_PADDING * 2;

  const points: ChartPoint[] = weightEntries.map((entry, index) => ({
    x: CHART_PADDING + ((times[index] - minTime) / timeSpan) * innerWidth,
    y: CHART_PADDING + innerHeight - ((entry.weightKg - minWeight) / weightSpan) * innerHeight,
    loggedAt: entry.loggedAt,
    weightKg: entry.weightKg,
  }));

  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  return { path, points };
}

interface MeasurementRow {
  key: string;
  label: string;
  latest: number;
  delta: number | null;
}

function buildMeasurementRows(entries: ProgressEntryRow[], t: (key: string) => string): MeasurementRow[] {
  const rows: MeasurementRow[] = [];
  for (const field of MEASUREMENT_FIELDS) {
    const values = entries.map((entry) => entry[field.key]).filter((value): value is number => value != null);
    if (values.length < 2) continue;
    const latest = values[values.length - 1];
    const previous = values[values.length - 2];
    rows.push({ key: field.key, label: t(field.labelKey), latest, delta: latest - previous });
  }
  return rows;
}

// EXPERIENCE.md:924 "never red on this screen" -- reuses the existing
// green/gray hex values from subscription-status.ts's STATUS_COLORS rather
// than inventing new ones. `build_muscle` reads a weight *increase* as
// "toward goal" -- this schema's only numeric trend is body weight (no
// muscle-mass/body-fat metric exists), an imperfect but the only available
// proxy; recorded in the story's Dev Notes ("Why build_muscle Maps to a
// Weight Increase").
function resolveDeltaColor(goal: ProgressScreenData['goal'], deltaKg: number | null): string {
  if (deltaKg == null) return STATUS_COLORS.no_plan.text;
  if (goal === 'lose_weight') return deltaKg < 0 ? STATUS_COLORS.active.text : STATUS_COLORS.no_plan.text;
  if (goal === 'build_muscle') return deltaKg > 0 ? STATUS_COLORS.active.text : STATUS_COLORS.no_plan.text;
  return STATUS_COLORS.no_plan.text;
}

/** MA-15. On mount, resolves the caller's own member id (`getCurrentMember`,
 * reused from `services/progress.ts`) then `loadProgressScreenData`. AC #3:
 * when `isConnected === false`, or a fresh fetch fails/throws, falls back to
 * the module-level `cachedProgressPayload` (session-lifetime only, see the
 * story's Dev Notes "What 'Local Cache' Means Here") rather than blanking
 * the screen -- a cold start with nothing cached yet shows the existing
 * empty/error pattern instead, same as any other screen's first-load
 * failure. */
export default function ProgressScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const accent = useGymAccentColor();
  const { isConnected, pendingProgressEntryCount } = useOfflineSync();

  const [screenData, setScreenData] = useState<ProgressScreenData | null>(null);
  const [usingCachedData, setUsingCachedData] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [logEntrySheetVisible, setLogEntrySheetVisible] = useState(false);
  const [chartWidth, setChartWidth] = useState(0);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [photoSignedUrls, setPhotoSignedUrls] = useState<Record<string, string>>({});
  const [failedPhotoIds, setFailedPhotoIds] = useState<Set<string>>(new Set());

  // Review finding: mirrors (tabs)/index.tsx's own requestIdRef/isCurrent()
  // convention -- guards against a stale in-flight response (e.g. isConnected
  // flipping mid-fetch, or this component unmounting) overwriting fresher
  // state.
  const requestIdRef = useRef(0);

  const loadScreen = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const isCurrent = () => requestIdRef.current === requestId;

    setLoading(true);
    setLoadError(false);
    let member: Awaited<ReturnType<typeof getCurrentMember>> = null;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        if (isCurrent()) setLoadError(true);
        return;
      }

      member = await getCurrentMember(userId);
      if (!isCurrent()) return;
      if (!member) {
        setLoadError(true);
        return;
      }

      if (!isConnected) {
        const cached = getCachedProgressPayload(member.memberId);
        if (cached) {
          setScreenData(cached);
          setUsingCachedData(true);
        } else {
          setLoadError(true);
        }
        return;
      }

      const { data } = await loadProgressScreenData(member.memberId);
      if (!isCurrent()) return;
      if (data) {
        setScreenData(data);
        setUsingCachedData(false);
        return;
      }

      const cached = getCachedProgressPayload(member.memberId);
      if (cached) {
        setScreenData(cached);
        setUsingCachedData(true);
      } else {
        setLoadError(true);
      }
    } catch {
      if (!isCurrent()) return;
      const cached = member ? getCachedProgressPayload(member.memberId) : null;
      if (cached) {
        setScreenData(cached);
        setUsingCachedData(true);
      } else {
        setLoadError(true);
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [isConnected]);

  // Review finding: refetches whenever this tab regains focus, not just on
  // mount -- returning from entries.tsx (after a delete) or photo/[id].tsx
  // (after a sharing-toggle) needs the chart/measurements/photo-lock-icon to
  // update without a manual reload, and expo-router keeps tab screens
  // mounted across navigation, so a plain mount-only effect never re-runs.
  // Mirrors (tabs)/index.tsx's own identical `useFocusEffect` precedent.
  useFocusEffect(
    useCallback(() => {
      void loadScreen();
    }, [loadScreen]),
  );

  // Review finding: resets the selected chart point whenever a genuinely
  // new payload loads (not on every render -- `screenData` only changes
  // reference on an actual reload), so a stale tooltip can't survive a
  // reload where the underlying entries shifted.
  useEffect(() => {
    setSelectedPointIndex(null);
  }, [screenData]);

  useEffect(() => {
    if (!screenData || screenData.photos.length === 0) return;
    // Review finding: only resolves signed URLs for photos not already
    // resolved, instead of re-requesting every photo on every reload.
    const missing = screenData.photos.filter((photo) => !(photo.id in photoSignedUrls));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const resolved = await Promise.all(
        missing.map(async (photo) => [photo.id, await getProgressPhotoSignedUrl(photo.photoPath)] as const),
      );
      if (cancelled) return;
      setPhotoSignedUrls((prev) => {
        const next = { ...prev };
        for (const [id, url] of resolved) {
          if (url) next[id] = url;
        }
        return next;
      });
      setFailedPhotoIds((prev) => {
        const next = new Set(prev);
        for (const [id, url] of resolved) {
          if (url) next.delete(id);
          else next.add(id);
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [screenData, photoSignedUrls]);

  function handleEntrySaved() {
    setLogEntrySheetVisible(false);
    void loadScreen();
  }

  const entries = screenData?.entries ?? [];
  const weightEntries = entries.filter((entry): entry is ProgressEntryRow & { weightKg: number } => entry.weightKg != null);
  const currentWeight = weightEntries.length > 0 ? weightEntries[weightEntries.length - 1].weightKg : null;
  const baselineWeight = screenData?.startingWeightKg ?? (weightEntries.length > 0 ? weightEntries[0].weightKg : null);
  const deltaKg = currentWeight != null && baselineWeight != null ? currentWeight - baselineWeight : null;
  const deltaColor = resolveDeltaColor(screenData?.goal ?? null, deltaKg);

  const { path: chartPath, points: chartPoints } = buildWeightChartGeometry(entries, chartWidth || 300);
  const selectedPoint = selectedPointIndex != null ? chartPoints[selectedPointIndex] : null;
  const measurementRows = buildMeasurementRows(entries, t);
  const isEmpty = !loading && !loadError && entries.length === 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + BottomTabInset + Spacing.three },
          ]}>
          <ThemedText type="subtitle">{t('progress.screen.title')}</ThemedText>

          {pendingProgressEntryCount > 0 && (
            <View style={styles.offlineBanner}>
              <ThemedText type="small" style={styles.offlineBannerText}>
                {t('progress.screen.offlineSyncPending')}
              </ThemedText>
            </View>
          )}

          {usingCachedData && (
            <View style={[styles.cachedBanner, { borderColor: theme.border }]}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('progress.screen.showingCachedData')}
              </ThemedText>
            </View>
          )}

          {loading && <ActivityIndicator style={styles.loadingIndicator} />}

          {!loading && loadError && (
            <View style={[styles.card, { borderColor: theme.border }]}>
              <ThemedText type="small" style={styles.error}>
                {t('progress.screen.errorLoadFailed')}
              </ThemedText>
              <Pressable accessibilityRole="button" onPress={() => void loadScreen()}>
                <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
              </Pressable>
            </View>
          )}

          {isEmpty && (
            <View style={styles.emptyState}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                {t('progress.screen.emptyState')}
              </ThemedText>
              <View style={styles.emptyStateButton}>
                <Button label={t('progress.screen.logAction')} onPress={() => setLogEntrySheetVisible(true)} />
              </View>
            </View>
          )}

          {!loading && !loadError && !isEmpty && screenData && (
            <>
              <View style={[styles.headerRow, { borderColor: theme.border }]}>
                <View style={styles.headerLeft}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('progress.screen.currentWeightLabel')}
                  </ThemedText>
                  <ThemedText type="subtitle">
                    {currentWeight != null ? `${currentWeight} kg` : t('progress.screen.noWeightYet')}
                  </ThemedText>
                  {deltaKg != null && (
                    <ThemedText type="small" style={{ color: deltaColor }}>
                      {t('progress.screen.sinceStart', { delta: formatDelta(deltaKg, 'kg') })}
                    </ThemedText>
                  )}
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setLogEntrySheetVisible(true)}
                  style={[styles.logButton, { backgroundColor: accent }]}>
                  <ThemedText type="smallBold" style={{ color: getContrastTextColor(accent) }}>
                    {t('progress.screen.logAction')}
                  </ThemedText>
                </Pressable>
              </View>

              {chartPoints.length > 0 ? (
                <View>
                  <View
                    style={[styles.chartContainer, { borderColor: theme.border }]}
                    onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}>
                    {chartWidth > 0 && (
                      <Svg width={chartWidth} height={CHART_HEIGHT}>
                        <Path d={chartPath} stroke={accent} strokeWidth={2} fill="none" />
                        {chartPoints.map((point, index) => (
                          <Circle
                            key={`${point.loggedAt}-${index}`}
                            cx={point.x}
                            cy={point.y}
                            r={10}
                            fill={accent}
                            onPress={() => setSelectedPointIndex(index)}
                            accessibilityLabel={`${formatChartDate(point.loggedAt, i18n.language)}, ${point.weightKg} kg`}
                          />
                        ))}
                      </Svg>
                    )}
                  </View>
                  {selectedPoint && (
                    <ThemedText type="small" themeColor="textSecondary" style={styles.chartTooltip}>
                      {formatChartDate(selectedPoint.loggedAt, i18n.language)} · {selectedPoint.weightKg} kg
                    </ThemedText>
                  )}
                </View>
              ) : (
                <View style={[styles.chartEmpty, { borderColor: theme.border }]}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('progress.screen.chartEmptyState')}
                  </ThemedText>
                </View>
              )}

              {measurementRows.length > 0 && (
                <View style={[styles.section, { borderTopColor: theme.border }]}>
                  <ThemedText type="default">{t('progress.screen.measurementsTitle')}</ThemedText>
                  {measurementRows.map((row) => (
                    <View key={row.key} style={styles.measurementRow}>
                      <ThemedText type="small">{row.label}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {row.latest} cm{row.delta != null ? ` (${formatDelta(row.delta, 'cm')})` : ''}
                      </ThemedText>
                    </View>
                  ))}
                </View>
              )}

              <View style={[styles.section, { borderTopColor: theme.border }]}>
                <ThemedText type="default">{t('progress.screen.photosTitle')}</ThemedText>
                {screenData.photos.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('progress.screen.photosEmptyState')}
                  </ThemedText>
                ) : (
                  <View style={styles.photoGrid}>
                    {screenData.photos.map((photo) => (
                      <Pressable
                        key={photo.id}
                        accessibilityRole="button"
                        onPress={() =>
                          router.push({
                            pathname: '/progress/photo/[id]',
                            params: {
                              id: photo.id,
                              photoPath: photo.photoPath,
                              sharedWithCoach: photo.sharedWithCoach ? '1' : '0',
                            },
                          })
                        }
                        style={[styles.photoThumb, { backgroundColor: theme.surfaceElevated }]}>
                        {photoSignedUrls[photo.id] && (
                          <Image
                            source={{ uri: photoSignedUrls[photo.id] }}
                            style={styles.photoThumbImage}
                            onError={() => {
                              setPhotoSignedUrls((prev) => {
                                const next = { ...prev };
                                delete next[photo.id];
                                return next;
                              });
                              setFailedPhotoIds((prev) => new Set(prev).add(photo.id));
                            }}
                          />
                        )}
                        {!photoSignedUrls[photo.id] && failedPhotoIds.has(photo.id) && (
                          <View style={styles.photoThumbError}>
                            <ThemedText type="small">⚠️</ThemedText>
                          </View>
                        )}
                        {!photo.sharedWithCoach && (
                          <View style={styles.lockBadge}>
                            <ThemedText type="small">🔒</ThemedText>
                          </View>
                        )}
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>

              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/progress/entries')}
                style={styles.viewAllLink}>
                <ThemedText type="link">{t('progress.screen.viewAllEntries')}</ThemedText>
              </Pressable>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
      <LogEntrySheet
        visible={logEntrySheetVisible}
        onClose={() => setLogEntrySheetVisible(false)}
        onSaved={handleEntrySaved}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  loadingIndicator: {
    marginTop: Spacing.four,
  },
  card: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.one,
  },
  error: {
    color: '#F87171',
  },
  centered: {
    textAlign: 'center',
  },
  emptyState: {
    marginTop: Spacing.six,
    alignItems: 'center',
    gap: Spacing.three,
  },
  emptyStateButton: {
    minWidth: 200,
  },
  offlineBanner: {
    backgroundColor: '#3A2A12',
    borderWidth: 1,
    borderColor: '#5C4420',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  offlineBannerText: {
    color: '#FBBF24',
  },
  cachedBanner: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  headerLeft: {
    gap: Spacing.half,
  },
  logButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  chartContainer: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },
  chartEmpty: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.four,
    alignItems: 'center',
  },
  chartTooltip: {
    marginTop: Spacing.one,
    textAlign: 'center',
  },
  section: {
    borderTopWidth: 1,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  measurementRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  photoThumb: {
    width: 72,
    height: 72,
    borderRadius: Spacing.one,
    overflow: 'hidden',
  },
  photoThumbImage: {
    width: '100%',
    height: '100%',
  },
  photoThumbError: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
  },
  viewAllLink: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
});
