import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MaterialIconsIconName } from '@react-native-vector-icons/material-icons';
import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/Card';
import { IconChip, type IconChipTint } from '@/components/ui/IconChip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import {
  getNotificationHistory,
  markNotificationRead,
  type NotificationHistoryItem,
  type NotificationType,
} from '@/services/notificationHistory';
import { getCurrentMember } from '@/services/progress';

// Story 6.7: no source doc specifies per-notification-type iconography, so
// this mapping is a deliberate choice, reusing icons/tints already
// established elsewhere in this app for the same underlying meaning rather
// than inventing a new visual vocabulary -- N-04/N-07 reuse (tabs)/index.tsx's
// own recentActivity ("payments"/success) and upcomingClasses ("event"/
// primary) icon+tint pairs exactly; N-01/N-02/N-03 mirror Home's own
// STATUS_ICON_CHIP expiring/expired warning->danger progression; N-06 uses
// "fitness-center" (not "notifications" again) to avoid a bell-on-bell
// redundancy with the screen's own entry-point icon.
const NOTIFICATION_ICON_CHIP: Record<NotificationType, { icon: MaterialIconsIconName; tint: IconChipTint }> = {
  'N-01': { icon: 'schedule', tint: 'warning' },
  'N-02': { icon: 'schedule', tint: 'warning' },
  'N-03': { icon: 'error', tint: 'danger' },
  'N-04': { icon: 'payments', tint: 'success' },
  'N-05': { icon: 'payments', tint: 'danger' },
  'N-06': { icon: 'fitness-center', tint: 'primary' },
  'N-07': { icon: 'event', tint: 'primary' },
};

function formatNotificationTimestamp(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/** A single history row -- not built from the shared ListItem (Story 15.2)
 * since this is the one place in the app needing an unread/read visual
 * distinction (bold+full-opacity vs. regular+muted title), a screen-
 * specific need per Story 15.4's own established precedent for when NOT to
 * extend a shared component ("ListItem has no description slot, don't add
 * one for one caller") -- this composes the same IconChip + title + meta
 * layout ListItem itself uses, just with that one added variation. */
function NotificationRow({
  item,
  locale,
  onPress,
}: {
  item: NotificationHistoryItem;
  locale: string;
  onPress: () => void;
}) {
  // Review finding: defensive fallback -- today every `item.type` is
  // guaranteed to be a mapped key (DB `CHECK` constraint + this union type
  // agree on the same 7 codes), but a crashed render on any future drift
  // between them is a worse failure mode than one row showing a generic
  // icon.
  const { icon, tint } = NOTIFICATION_ICON_CHIP[item.type] ?? { icon: 'notifications', tint: 'primary' };
  const isUnread = item.readAt === null;

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      <IconChip icon={icon} tint={tint} />
      <View style={styles.rowTextGroup}>
        <ThemedText type={isUnread ? 'smallBold' : 'small'} themeColor={isUnread ? undefined : 'textSecondary'}>
          {item.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {item.body}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {formatNotificationTimestamp(item.createdAt, locale)}
      </ThemedText>
    </Pressable>
  );
}

// Review finding: history-only -- the Quiet-gym alerts/Class reminders
// preference toggles were relocated here by Story 6.7, then moved back to
// (tabs)/profile.tsx per user request (they must stay reachable from
// Profile, not exist only here). This screen no longer duplicates them.
export default function NotificationsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const theme = useTheme();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [history, setHistory] = useState<NotificationHistoryItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        setLoadError(true);
        return;
      }

      const current = await getCurrentMember(userId);
      if (!current) {
        setLoadError(true);
        return;
      }

      const result = await getNotificationHistory(current.memberId);
      if (result === null) {
        setLoadError(true);
        return;
      }
      setHistory(result);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // AC #5: optimistic read-state update -- flips locally first (matching
  // this codebase's established optimistic-update/rollback shape), then
  // persists; rolled back on failure since a silently-stuck-unread row with
  // no visible error is worse than briefly reverting.
  async function handleRowPress(item: NotificationHistoryItem) {
    if (item.readAt !== null) return;
    const optimisticReadAt = new Date().toISOString();
    setHistory((prev) => prev.map((row) => (row.id === item.id ? { ...row, readAt: optimisticReadAt } : row)));
    const ok = await markNotificationRead(item.id);
    if (!ok) {
      setHistory((prev) => prev.map((row) => (row.id === item.id ? { ...row, readAt: null } : row)));
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={() => router.back()}
            hitSlop={Spacing.two}
            style={styles.closeButton}>
            <MaterialIcons name="close" size={22} color={theme.textSecondary} />
          </Pressable>
          <ThemedText type="subtitle">{t('notifications.title')}</ThemedText>
        </View>

        {loading && <ActivityIndicator style={styles.loadingIndicator} />}

        {!loading && loadError && (
          <View style={[styles.card, { borderColor: theme.border }]}>
            <ThemedText type="small" style={styles.error}>
              {t('notifications.errorLoadFailed')}
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={() => void load()}>
              <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
            </Pressable>
          </View>
        )}

        {!loading && !loadError && (
          <View style={styles.scrollContent}>
            {history.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t('notifications.empty')}
              </ThemedText>
            ) : (
              <Card variant="flat">
                {history.map((item, index) => (
                  <View
                    key={item.id}
                    style={index > 0 ? [styles.rowDivider, { borderTopColor: theme.border }] : undefined}>
                    <NotificationRow item={item} locale={i18n.language} onPress={() => void handleRowPress(item)} />
                  </View>
                ))}
              </Card>
            )}
          </View>
        )}
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.two,
    marginBottom: Spacing.three,
  },
  closeButton: {
    padding: Spacing.one,
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
  scrollContent: {
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    minHeight: 44,
  },
  rowTextGroup: {
    flex: 1,
    gap: Spacing.half,
  },
  rowDivider: {
    borderTopWidth: 1,
    paddingTop: Spacing.two,
  },
});
