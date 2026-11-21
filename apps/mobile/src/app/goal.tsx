import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { GymAccentColorProvider, useGymAccentColor } from '@/hooks/use-gym-accent-color';
import { useTheme } from '@/hooks/use-theme';
import { getContrastTextColor } from '@/lib/color-contrast';
import { useOfflineSync } from '@/lib/offline-sync-context';
import { setPendingToast } from '@/lib/pendingToast';
import { supabase } from '@/lib/supabase';
import { buildSheetViewModel, initialChoice, PILL_GAP, PILL_MIN_TARGET, savedToastMessage, SHEET_HORIZONTAL_PADDING } from '@/lib/weeklyGoalSheet';
import { getMyWeeklyGoal, markGoalHintSeen, setWeeklyGoal, type WeeklyGoal } from '@/services/weeklyGoal';

/** MA-23, the Weekly Goal sheet at `/goal` (Story 30.1, FR-219). Presented as a bottom sheet (see _layout.tsx); swipe down or Android back
 * dismisses without saving. Every string and every decision (option state, effect line, whether Save is on) comes from
 * `lib/weeklyGoalSheet.ts`, so this file holds layout only. A goal change is never queued offline: the effective Monday is the server's
 * gym-local next Monday. */
export default function GoalSheet() {
  return (
    <GymAccentColorProvider>
      <GoalSheetContent />
    </GymAccentColorProvider>
  );
}

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; goal: WeeklyGoal };

function GoalSheetContent() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const accent = useGymAccentColor();
  const { width } = useWindowDimensions();
  const { isConnected } = useOfflineSync();

  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [choice, setChoice] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadGoal = useCallback(async () => {
    setLoad({ status: 'loading' });
    const result = await getMyWeeklyGoal();
    if (!mountedRef.current) return;
    if (result.status === 'success') {
      setLoad({ status: 'ready', goal: result.goal });
      setChoice((previous) => previous ?? initialChoice(result.goal));
    } else {
      setLoad({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    void loadGoal();
    // Opening the sheet dismisses the one-time default-goal hint on Home (Story 30.4 reads this flag).
    void supabase.auth.getSession().then(({ data }) => {
      const userId = data.session?.user.id;
      if (userId) void markGoalHintSeen(userId);
    });
  }, [loadGoal]);

  const goal = load.status === 'ready' ? load.goal : null;
  const language = i18n.language === 'fr' ? 'fr' : 'en';
  const vm =
    goal && choice !== null
      ? buildSheetViewModel({ goal, choice, isConnected, saving, saveFailed, screenWidth: width, t, language })
      : null;

  async function handleSave() {
    if (!goal || choice === null || !vm?.saveEnabled) return;
    setSaving(true);
    setSaveFailed(false);
    const result = await setWeeklyGoal(choice);
    if (!mountedRef.current) return;
    if (result.status === 'success') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setPendingToast(savedToastMessage(result.outcome, t, language));
      router.back();
      return;
    }
    setSaving(false);
    setSaveFailed(true);
  }

  return (
    <ThemedView style={styles.container}>
      {/* Scrollable: at the 0.6 detent French copy, two pill rows or large text can push Save below the sheet. */}
      <ScrollView contentContainerStyle={styles.content}>
      {load.status === 'loading' && <ActivityIndicator style={styles.loading} />}

      {load.status === 'error' && (
        <View style={styles.block}>
          <ThemedText type="small" style={styles.error}>
            {t('profile.errorLoadFailed')}
          </ThemedText>
          <Pressable accessibilityRole="button" onPress={() => void loadGoal()}>
            <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
          </Pressable>
        </View>
      )}

      {vm && (
        <View style={styles.block}>
          <ThemedText type="subtitle" accessibilityRole="header">
            {vm.title}
          </ThemedText>
          <ThemedText type="default">{vm.prompt}</ThemedText>

          {vm.hint && (
            <ThemedText type="small" themeColor="textSecondary">
              {vm.hint}
            </ThemedText>
          )}

          <View style={styles.pillRows}>
            {vm.pillRows.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.pillRow}>
                {row.map((pill) => {
                  const textColor = pill.selected ? getContrastTextColor(accent) : theme.text;
                  return (
                    <Pressable
                      key={pill.value}
                      accessibilityRole="button"
                      accessibilityLabel={pill.accessibilityLabel}
                      accessibilityState={{ selected: pill.selected }}
                      onPress={() => {
                        setChoice(pill.value);
                        setSaveFailed(false);
                      }}
                      style={[
                        styles.pill,
                        pill.selected ? { backgroundColor: accent, borderColor: accent } : { borderColor: theme.border },
                      ]}>
                      <ThemedText type="smallBold" style={{ color: textColor }}>
                        {pill.value}
                      </ThemedText>
                      {pill.showCheck && <MaterialIcons name="check" size={14} color={textColor} />}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>

          <ThemedText type="default" accessibilityLiveRegion="polite">
            {vm.effectLine}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {vm.why}
          </ThemedText>

          {vm.errorLine && (
            <ThemedText type="small" style={styles.error}>
              {vm.errorLine}
            </ThemedText>
          )}
          {vm.offlineLine && (
            <ThemedText type="small" themeColor="textSecondary">
              {vm.offlineLine}
            </ThemedText>
          )}

          <Button label={vm.saveLabel} disabled={!vm.saveEnabled} loading={saving} onPress={() => void handleSave()} />
        </View>
      )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: SHEET_HORIZONTAL_PADDING,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
  },
  loading: {
    marginTop: Spacing.four,
  },
  block: {
    gap: Spacing.three,
  },
  pillRows: {
    gap: Spacing.two,
  },
  pillRow: {
    flexDirection: 'row',
    gap: PILL_GAP,
  },
  pill: {
    flex: 1,
    minWidth: PILL_MIN_TARGET,
    minHeight: PILL_MIN_TARGET,
    borderWidth: 1,
    borderRadius: PILL_MIN_TARGET / 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  error: {
    color: '#F87171',
  },
});
