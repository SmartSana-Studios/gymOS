import * as Crypto from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { GymAccentColorProvider } from '@/hooks/use-gym-accent-color';
import { useTheme } from '@/hooks/use-theme';
import { useOfflineSync } from '@/lib/offline-sync-context';
import { supabase } from '@/lib/supabase';
import { getCurrentMember } from '@/services/progress';
import {
  getCachedWorkoutPlan,
  loadWorkoutPlan,
  logWorkoutCompletion,
  type WorkoutPlanExerciseRow,
  type WorkoutPlanScreenData,
} from '@/services/workoutPlan';

function formatCompletedDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/** Story 13.3 (Task 4, Subtask 4.5): a flat, non-tab full-screen route
 * mirroring `plan.tsx`/`renew.tsx`'s placement convention -- reached via
 * `router.push('/workout-plan')` from a new Home entry point (Subtask
 * 4.6). No mockup exists for this screen (see the story's own Dev Notes);
 * the on-mount fetch/cache/error shape mirrors `(tabs)/progress/index.tsx`'s
 * own code-review-hardened `requestIdRef`/cache-first pattern, built in
 * from the start here rather than repeating the bugs that pattern exists
 * to prevent. */
export default function WorkoutPlanScreen() {
  return (
    <GymAccentColorProvider>
      <WorkoutPlanScreenContent />
    </GymAccentColorProvider>
  );
}

function WorkoutPlanScreenContent() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const { isConnected, queueOfflineWorkoutCompletion } = useOfflineSync();

  const [screenData, setScreenData] = useState<WorkoutPlanScreenData | null>(null);
  const [usingCachedData, setUsingCachedData] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [markingExerciseId, setMarkingExerciseId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [markError, setMarkError] = useState(false);

  const memberIdRef = useRef<string | null>(null);
  // Mirrors (tabs)/progress/index.tsx's own requestIdRef/isCurrent()
  // convention -- guards against a stale in-flight response overwriting
  // fresher state (e.g. isConnected flipping mid-fetch, or unmounting).
  const requestIdRef = useRef(0);

  const loadScreen = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const isCurrent = () => requestIdRef.current === requestId;

    setLoading(true);
    setLoadError(false);
    let memberId: string | null = null;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        if (isCurrent()) setLoadError(true);
        return;
      }

      const member = await getCurrentMember(userId);
      if (!isCurrent()) return;
      if (!member) {
        setLoadError(true);
        return;
      }
      memberId = member.memberId;
      memberIdRef.current = member.memberId;

      if (!isConnected) {
        const cached = getCachedWorkoutPlan(member.memberId);
        if (cached !== null) {
          setScreenData(cached);
          setUsingCachedData(true);
        } else {
          setLoadError(true);
        }
        return;
      }

      const { data, error } = await loadWorkoutPlan(member.memberId);
      if (!isCurrent()) return;
      if (!error) {
        setScreenData(data);
        setUsingCachedData(false);
        return;
      }

      const cached = getCachedWorkoutPlan(member.memberId);
      if (cached !== null) {
        setScreenData(cached);
        setUsingCachedData(true);
      } else {
        setLoadError(true);
      }
    } catch {
      if (!isCurrent()) return;
      const cached = memberId ? getCachedWorkoutPlan(memberId) : null;
      if (cached !== null) {
        setScreenData(cached);
        setUsingCachedData(true);
      } else {
        setLoadError(true);
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [isConnected]);

  // useFocusEffect (not a plain mount-only useEffect) so completion history
  // stays fresh across re-entries into this already-mounted screen -- mirrors
  // (tabs)/progress/index.tsx's own identical precedent.
  useFocusEffect(
    useCallback(() => {
      void loadScreen();
    }, [loadScreen]),
  );

  // Optimistic local update -- no re-fetch, since the offline path has
  // nothing to re-fetch from yet (the write only exists in the local
  // SQLite queue until the next sync). The module-level cache self-heals
  // on the next full loadWorkoutPlan() call; this optimistic state is
  // component-local only.
  function applyOptimisticCompletion(exerciseId: string, completedAt: string) {
    setScreenData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        exercises: prev.exercises.map((exercise) =>
          exercise.exerciseId === exerciseId
            ? { ...exercise, completions: [completedAt, ...exercise.completions] }
            : exercise,
        ),
      };
    });
  }

  async function markExerciseComplete(exercise: WorkoutPlanExerciseRow) {
    if (!screenData || markingExerciseId || markingAll) return;
    setMarkingExerciseId(exercise.id);
    setMarkError(false);
    try {
      const clientCompletionId = Crypto.randomUUID();
      const completedAt = new Date().toISOString();
      const result = isConnected
        ? await logWorkoutCompletion(screenData.planId, exercise.exerciseId, clientCompletionId)
        : await queueOfflineWorkoutCompletion(screenData.planId, exercise.exerciseId, clientCompletionId);
      if (result.success) {
        applyOptimisticCompletion(exercise.exerciseId, completedAt);
      } else {
        setMarkError(true);
      }
    } catch {
      setMarkError(true);
    } finally {
      setMarkingExerciseId(null);
    }
  }

  // "Mark all complete" -- Subtask 4.5's resolution of AC #2's "session"
  // framing: no session/day entity exists in this schema, so this loops
  // and submits one completion per currently-visible exercise with the
  // same timestamp, rather than inventing new schema. Each exercise's
  // submission is independently try/caught so one failure doesn't abort
  // the rest of the batch.
  async function markAllComplete() {
    if (!screenData || markingExerciseId || markingAll || screenData.exercises.length === 0) return;
    setMarkingAll(true);
    setMarkError(false);
    try {
      const completedAt = new Date().toISOString();
      let anyFailed = false;
      for (const exercise of screenData.exercises) {
        const clientCompletionId = Crypto.randomUUID();
        try {
          const result = isConnected
            ? await logWorkoutCompletion(screenData.planId, exercise.exerciseId, clientCompletionId)
            : await queueOfflineWorkoutCompletion(screenData.planId, exercise.exerciseId, clientCompletionId);
          if (result.success) {
            applyOptimisticCompletion(exercise.exerciseId, completedAt);
          } else {
            anyFailed = true;
          }
        } catch {
          anyFailed = true;
        }
      }
      if (anyFailed) setMarkError(true);
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={() => router.back()}
          style={styles.backButton}>
          <ThemedText type="default">←</ThemedText>
        </Pressable>

        <ThemedText type="subtitle">{t('workoutPlan.screen.title')}</ThemedText>

        {usingCachedData && (
          <View style={[styles.cachedBanner, { borderColor: theme.border }]}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('workoutPlan.screen.showingCachedData')}
            </ThemedText>
          </View>
        )}

        {loading && <ActivityIndicator style={styles.loadingIndicator} />}

        {!loading && loadError && (
          <Card style={styles.card}>
            <ThemedText type="small" style={styles.error}>
              {t('workoutPlan.screen.errorLoadFailed')}
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={() => void loadScreen()}>
              <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
            </Pressable>
          </Card>
        )}

        {!loading && !loadError && screenData === null && (
          <Card style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('workoutPlan.screen.emptyState')}
            </ThemedText>
          </Card>
        )}

        {!loading && !loadError && markError && (
          <ThemedText type="small" style={styles.error}>
            {t('workoutPlan.screen.errorMarkFailed')}
          </ThemedText>
        )}

        {!loading && !loadError && screenData !== null && (
          <View style={styles.planHeaderRow}>
            <ThemedText type="subtitle">{screenData.name}</ThemedText>
            {screenData.exercises.length > 0 && (
              <Button
                label={t('workoutPlan.screen.markAllComplete')}
                variant="secondary"
                loading={markingAll}
                disabled={markingExerciseId !== null}
                onPress={() => void markAllComplete()}
              />
            )}
          </View>
        )}

        {!loading &&
          !loadError &&
          screenData !== null &&
          screenData.exercises.map((exercise) => (
            <Card key={exercise.id} style={styles.card}>
              <ThemedText type="default">
                {exercise.orderIndex}. {exercise.exerciseName}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t('workoutPlan.screen.setsReps', { sets: exercise.sets, reps: exercise.reps })}
              </ThemedText>
              {exercise.note && (
                <ThemedText type="small" themeColor="textSecondary">
                  {t('workoutPlan.screen.noteLine', { note: exercise.note })}
                </ThemedText>
              )}
              {exercise.completions.length > 0 && (
                <ThemedText type="small" style={styles.completed}>
                  {t('workoutPlan.screen.completedCount', {
                    count: exercise.completions.length,
                    date: formatCompletedDate(exercise.completions[0], i18n.language),
                  })}
                </ThemedText>
              )}
              <Button
                label={t('workoutPlan.screen.markComplete')}
                loading={markingExerciseId === exercise.id}
                disabled={markingAll || (markingExerciseId !== null && markingExerciseId !== exercise.id)}
                onPress={() => void markExerciseComplete(exercise)}
              />
            </Card>
          ))}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  backButton: {
    paddingVertical: Spacing.two,
  },
  loadingIndicator: {
    marginTop: Spacing.four,
  },
  card: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  error: {
    color: '#F87171',
  },
  completed: {
    color: '#10B981',
  },
  cachedBanner: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  planHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
  },
});
