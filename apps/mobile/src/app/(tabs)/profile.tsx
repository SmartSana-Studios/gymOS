import { profileSetupSchema } from '@gymos/types';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { LogEntrySheet } from '@/components/LogEntrySheet';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useGymAccentColor } from '@/hooks/use-gym-accent-color';
import { getContrastTextColor } from '@/lib/color-contrast';
import type { MobileLocale } from '@/lib/i18n';
import { openPhotoPicker, pickPhoto, uploadPhoto } from '@/lib/photo-upload';
import { supabase } from '@/lib/supabase';
import { getMemberPreferences, updateMemberPreferences } from '@/services/notificationPreferences';

// Narrows the untyped embedded-select response, same discipline as
// onboarding/plan.tsx's `isSubscriptionRow` (Review finding there) -- a
// shape mismatch falls through to the existing loadError handling instead
// of masking itself as a generic failure with no signal.
interface PlanNameRow {
  plans: { name: string } | null;
}
function isPlanNameRow(value: unknown): value is PlanNameRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.plans === 'object';
}

/** MA-12. On mount, resolves the caller's own `users` row
 * (`self_read_own_user`), gym name (`"read own gym"`, scoped via JWT claim,
 * no explicit gym_id filter needed -- Story 2.8 Scope Note #1), and current
 * plan name via the same member-id tie-break + active-subscription->plan
 * join pattern onboarding/plan.tsx's `loadPlan` already uses (Story 2.7
 * Scope Note #3), but only needs `plans.name`. */
export default function ProfileScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const accent = useGymAccentColor();
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [gymName, setGymName] = useState<string | null>(null);
  const [planName, setPlanName] = useState<string | null>(null);
  const [noActivePlan, setNoActivePlan] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhotoUri, setEditPhotoUri] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [langPending, setLangPending] = useState(false);

  const [memberId, setMemberId] = useState<string | null>(null);
  const [quietGymAlertsOptedOut, setQuietGymAlertsOptedOut] = useState(false);
  const [classReminderOptedOut, setClassReminderOptedOut] = useState(false);
  const [quietGymAlertsPending, setQuietGymAlertsPending] = useState(false);
  const [classReminderPending, setClassReminderPending] = useState(false);
  const [notificationsLoadError, setNotificationsLoadError] = useState(false);

  const [logEntrySheetVisible, setLogEntrySheetVisible] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setNoActivePlan(false);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user.id;
      if (!uid) {
        if (mountedRef.current) setLoadError(true);
        return;
      }
      if (mountedRef.current) setUserId(uid);

      const [userResult, gymResult, memberResult] = await Promise.all([
        supabase.from('users').select('display_name, photo_url, phone').eq('id', uid).single(),
        supabase.from('gyms').select('name').single(),
        supabase
          .from('members')
          .select('id')
          .eq('user_id', uid)
          .is('deactivated_at', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .single(),
      ]);

      if (!mountedRef.current) return;

      if (userResult.error || !userResult.data || gymResult.error || !gymResult.data) {
        setLoadError(true);
        return;
      }

      setDisplayName(userResult.data.display_name);
      setPhotoUrl(userResult.data.photo_url);
      setPhone(userResult.data.phone);
      setGymName(gymResult.data.name);

      // PGRST116 = PostgREST's "no rows" code for `.single()` -- a member
      // with no currently-active membership row is a distinct, non-retryable
      // state (no plan to show), not a load failure.
      if (memberResult.error?.code === 'PGRST116') {
        setNoActivePlan(true);
        return;
      }
      if (memberResult.error || !memberResult.data) {
        setLoadError(true);
        return;
      }

      const resolvedMemberId = memberResult.data.id;
      if (mountedRef.current) setMemberId(resolvedMemberId);

      // Preferences load only depends on the member row existing (guaranteed
      // by migration 0047's auto-create trigger), not on an active
      // subscription -- fetched alongside subscription rather than gated
      // behind noActivePlan (Story 6.4 AC #2).
      const [subscriptionResult, preferences] = await Promise.all([
        // Same PGRST116 distinction as above -- a member with no active
        // subscription is a distinct, non-retryable state from a real
        // network/connectivity failure (same distinction onboarding/plan.tsx's
        // loadPlan already makes).
        supabase
          .from('subscriptions')
          .select('plans(name)')
          .eq('member_id', resolvedMemberId)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .single(),
        getMemberPreferences(resolvedMemberId),
      ]);

      if (!mountedRef.current) return;

      if (subscriptionResult.error?.code === 'PGRST116') {
        setNoActivePlan(true);
      } else if (
        subscriptionResult.error ||
        !isPlanNameRow(subscriptionResult.data) ||
        !subscriptionResult.data.plans
      ) {
        setLoadError(true);
        return;
      } else {
        setPlanName(subscriptionResult.data.plans.name);
      }

      // A notifications-load failure is isolated to its own section (inline
      // retry) rather than failing the whole profile -- this is an inert,
      // non-critical feature (Story 6.4 AC #5), unlike the user/gym/member
      // fetches above which are load-bearing for the rest of the screen.
      if (preferences) {
        setNotificationsLoadError(false);
        setQuietGymAlertsOptedOut(preferences.quietGymAlertsOptedOut);
        setClassReminderOptedOut(preferences.classReminderOptedOut);
      } else {
        setNotificationsLoadError(true);
      }
    } catch {
      if (mountedRef.current) setLoadError(true);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  function handleStartEdit() {
    setEditName(displayName ?? '');
    setEditPhotoUri(null);
    setEditError(null);
    setEditing(true);
  }

  function handleCancelEdit() {
    setEditing(false);
    setEditError(null);
    setEditPhotoUri(null);
  }

  function handleOpenPhotoPicker() {
    openPhotoPicker(handlePickPhoto, t);
  }

  async function handlePickPhoto(source: 'camera' | 'library') {
    const result = await pickPhoto(source);
    if ('error' in result) {
      setEditError(
        result.error === 'permission_denied'
          ? t('onboarding.profile.errorPhotoPermissionDenied')
          : t('onboarding.profile.errorPhotoTooLarge'),
      );
      return;
    }
    if ('canceled' in result) return;
    setEditError(null);
    setEditPhotoUri(result.uri);
  }

  async function handleSaveProfile() {
    if (!userId) return;
    const trimmedName = editName.trim();
    if (trimmedName.length > 100) {
      setEditError(t('onboarding.profile.errorNameTooLong'));
      return;
    }

    setEditSubmitting(true);
    setEditError(null);
    try {
      let nextPhotoUrl = photoUrl;
      if (editPhotoUri) {
        const uploaded = await uploadPhoto(userId, editPhotoUri);
        if (!uploaded) {
          setEditError(t('onboarding.profile.errorPhotoUploadFailed'));
          return;
        }
        nextPhotoUrl = uploaded;
      }

      const parsed = profileSetupSchema.safeParse({ displayName: trimmedName, photoUrl: nextPhotoUrl });
      if (!parsed.success) {
        setEditError(t('profile.errorSaveFailed'));
        return;
      }

      // `.select()` + row-count check (Story 2.7's review-fixed discipline
      // for self-writes) -- a zero-row update returns `error: null` under
      // PostgREST and must not be silently treated as success.
      const { data, error } = await supabase
        .from('users')
        .update({ display_name: parsed.data.displayName, photo_url: parsed.data.photoUrl ?? null })
        .eq('id', userId)
        .select('id');

      if (error || !data || data.length === 0) {
        setEditError(t('profile.errorSaveFailed'));
        return;
      }

      setDisplayName(parsed.data.displayName);
      setPhotoUrl(parsed.data.photoUrl ?? null);
      setEditPhotoUri(null);
      setEditing(false);
    } catch {
      setEditError(t('profile.errorSaveFailed'));
    } finally {
      setEditSubmitting(false);
    }
  }

  // Exact optimistic-update/rollback shape as
  // apps/dashboard/components/shared/LanguageToggle.tsx's `handleChange` --
  // referenced directly rather than reinvented for mobile (Story 2.8 Task
  // 4). No separate error toast: the toggle visually reverting is the
  // user-visible feedback on a failed persist.
  async function handleLanguageChange(code: MobileLocale) {
    if (code === i18n.language || langPending || !userId) return;
    const previous = i18n.language;
    setLangPending(true);
    void i18n.changeLanguage(code);
    try {
      const { error } = await supabase.from('users').update({ preferred_language: code }).eq('id', userId);
      if (error) {
        void i18n.changeLanguage(previous);
        return;
      }
    } finally {
      if (mountedRef.current) setLangPending(false);
    }
  }

  // Same optimistic-update/rollback shape as handleLanguageChange above --
  // no separate error toast, the toggle visually reverting is the
  // user-visible feedback on a failed persist (Story 6.4 AC #3). Each row
  // has its own pending flag (not a single shared one) so toggling one
  // category doesn't visually disable the other while its write is in
  // flight -- confirmed on-device that a shared flag made the untouched
  // switch look like it was reacting too.
  async function handleToggleQuietGymAlerts() {
    if (quietGymAlertsPending || !memberId) return;
    const previous = quietGymAlertsOptedOut;
    setQuietGymAlertsPending(true);
    setQuietGymAlertsOptedOut(!previous);
    try {
      const ok = await updateMemberPreferences(memberId, { quietGymAlertsOptedOut: !previous });
      if (!ok && mountedRef.current) setQuietGymAlertsOptedOut(previous);
    } finally {
      if (mountedRef.current) setQuietGymAlertsPending(false);
    }
  }

  async function handleToggleClassReminder() {
    if (classReminderPending || !memberId) return;
    const previous = classReminderOptedOut;
    setClassReminderPending(true);
    setClassReminderOptedOut(!previous);
    try {
      const ok = await updateMemberPreferences(memberId, { classReminderOptedOut: !previous });
      if (!ok && mountedRef.current) setClassReminderOptedOut(previous);
    } finally {
      if (mountedRef.current) setClassReminderPending(false);
    }
  }

  async function handleRetryNotifications() {
    if (!memberId) return;
    const preferences = await getMemberPreferences(memberId);
    if (!mountedRef.current) return;
    if (preferences) {
      setNotificationsLoadError(false);
      setQuietGymAlertsOptedOut(preferences.quietGymAlertsOptedOut);
      setClassReminderOptedOut(preferences.classReminderOptedOut);
    }
  }

  function handleLogOut() {
    Alert.alert(t('profile.logOutConfirmTitle'), undefined, [
      {
        text: t('profile.logOut'),
        style: 'destructive',
        onPress: () => {
          void supabase.auth.signOut().catch(() => Alert.alert(t('profile.errorSaveFailed')));
        },
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }

  const displayPhotoUri = editing ? (editPhotoUri ?? photoUrl) : photoUrl;
  const isDirty = editName.trim() !== (displayName ?? '') || editPhotoUri !== null;
  const canSaveEdit = isDirty && editName.trim().length > 0 && !editSubmitting;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + BottomTabInset + Spacing.three },
          ]}>
          <ThemedText type="subtitle">{t('profile.title')}</ThemedText>

          {loading && <ActivityIndicator style={styles.loadingIndicator} />}

        {!loading && loadError && (
          <Card style={styles.card}>
            <ThemedText type="small" style={styles.error}>
              {t('profile.errorLoadFailed')}
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={() => void loadProfile()}>
              <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
            </Pressable>
          </Card>
        )}

        {!loading && !loadError && (
          <>
            <Pressable
              accessibilityRole={editing ? 'button' : undefined}
              disabled={!editing}
              onPress={handleOpenPhotoPicker}
              style={[styles.avatar, { backgroundColor: theme.surfaceElevated }]}>
              {displayPhotoUri ? (
                <Image source={{ uri: displayPhotoUri }} style={styles.avatarImage} />
              ) : editing ? (
                <ThemedText type="small" style={styles.avatarPlaceholderText}>
                  {t('onboarding.profile.addPhoto')}
                </ThemedText>
              ) : null}
            </Pressable>

            <ThemedText type="subtitle" style={styles.centered}>
              {displayName}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
              {gymName} · {noActivePlan ? t('profile.noActivePlan') : planName}
            </ThemedText>

            <View style={[styles.row, { borderTopColor: theme.border }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(editing ? 'common.cancel' : 'profile.editProfile')}
                onPress={editing ? handleCancelEdit : handleStartEdit}
                style={styles.rowContent}>
                <ThemedText type="default">{t(editing ? 'common.cancel' : 'profile.editProfile')}</ThemedText>
                <ThemedText type="default">{editing ? '×' : '→'}</ThemedText>
              </Pressable>

              {editing && (
                <View style={styles.editSection}>
                  <ThemedText type="small">{t('onboarding.profile.nameLabel')}</ThemedText>
                  <TextInput
                    value={editName}
                    onChangeText={setEditName}
                    autoCapitalize="words"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.nameInput, { borderColor: theme.border, color: theme.text }]}
                  />

                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    accessibilityLabel={`${phone}. ${t('profile.phoneNotEditable')}`}>
                    {phone}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('profile.phoneNotEditable')}
                  </ThemedText>

                  {editError && (
                    <ThemedText type="small" style={styles.error}>
                      {editError}
                    </ThemedText>
                  )}

                  <View style={styles.saveButton}>
                    <Button
                      label={t('common.save')}
                      disabled={!canSaveEdit}
                      loading={editSubmitting}
                      onPress={handleSaveProfile}
                    />
                  </View>
                </View>
              )}
            </View>

            {/* Story 10.1 AC #2's "or visit Progress at any later time" --
                an interim entry point before Story 10.3 formally adds this
                to the Progress tab. Reuses /onboarding/body-profile itself
                (skippable-safe to revisit; no dependency on
                onboarding_completed_at). A second row underneath opens
                LogEntrySheet directly for AC #3's "log an entry." */}
            <View style={[styles.row, { borderTopColor: theme.border }]}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/onboarding/body-profile', params: { from: 'profile' } })}
                style={styles.rowContent}>
                <ThemedText type="default">{t('profile.bodyProfile')}</ThemedText>
                <ThemedText type="default">→</ThemedText>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setLogEntrySheetVisible(true)} style={styles.logEntryRow}>
                <ThemedText type="link">{t('profile.logProgressEntry')}</ThemedText>
              </Pressable>
            </View>

            <View style={[styles.row, { borderTopColor: theme.border }]}>
              <View style={styles.rowContent}>
                <ThemedText type="default">{t('profile.language')}</ThemedText>
                <View style={styles.languageToggle}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: i18n.language === 'en', disabled: langPending }}
                    disabled={langPending}
                    onPress={() => void handleLanguageChange('en')}
                    style={[
                      styles.languageOption,
                      { backgroundColor: theme.surfaceElevated },
                      i18n.language === 'en' && { backgroundColor: accent },
                    ]}>
                    <ThemedText
                      type="smallBold"
                      style={i18n.language === 'en' && { color: getContrastTextColor(accent) }}>
                      {t('profile.languageEn')}
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: i18n.language === 'fr', disabled: langPending }}
                    disabled={langPending}
                    onPress={() => void handleLanguageChange('fr')}
                    style={[
                      styles.languageOption,
                      { backgroundColor: theme.surfaceElevated },
                      i18n.language === 'fr' && { backgroundColor: accent },
                    ]}>
                    <ThemedText
                      type="smallBold"
                      style={i18n.language === 'fr' && { color: getContrastTextColor(accent) }}>
                      {t('profile.languageFr')}
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            </View>

            {memberId && (
              <View style={[styles.row, { borderTopColor: theme.border }]}>
                <ThemedText type="default">{t('profile.notifications.title')}</ThemedText>

                {notificationsLoadError ? (
                  <View style={styles.notificationRow}>
                    <ThemedText type="small" style={styles.error}>
                      {t('profile.errorLoadFailed')}
                    </ThemedText>
                    <Pressable accessibilityRole="button" onPress={() => void handleRetryNotifications()}>
                      <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <View style={[styles.rowContent, styles.notificationRow]}>
                      <ThemedText type="small">{t('profile.notifications.quietGymAlerts')}</ThemedText>
                      <Switch
                        accessibilityRole="switch"
                        accessibilityLabel={t('profile.notifications.quietGymAlerts')}
                        accessibilityState={{ checked: !quietGymAlertsOptedOut, disabled: quietGymAlertsPending }}
                        disabled={quietGymAlertsPending}
                        value={!quietGymAlertsOptedOut}
                        onValueChange={() => void handleToggleQuietGymAlerts()}
                      />
                    </View>
                    <ThemedText type="small" themeColor="textSecondary">
                      {t('profile.notifications.quietGymAlertsDescription')}
                    </ThemedText>

                    <View style={[styles.rowContent, styles.notificationRow]}>
                      <ThemedText type="small">{t('profile.notifications.classReminder')}</ThemedText>
                      <Switch
                        accessibilityRole="switch"
                        accessibilityLabel={t('profile.notifications.classReminder')}
                        accessibilityState={{ checked: !classReminderOptedOut, disabled: classReminderPending }}
                        disabled={classReminderPending}
                        value={!classReminderOptedOut}
                        onValueChange={() => void handleToggleClassReminder()}
                      />
                    </View>
                    <ThemedText type="small" themeColor="textSecondary">
                      {t('profile.notifications.classReminderDescription')}
                    </ThemedText>
                  </>
                )}
              </View>
            )}

            <View style={[styles.row, { borderTopColor: theme.border }]}>
              <Pressable accessibilityRole="button" onPress={handleLogOut} style={styles.rowContent}>
                <ThemedText type="default">{t('profile.logOut')}</ThemedText>
              </Pressable>
            </View>
          </>
          )}
        </ScrollView>
      </SafeAreaView>
      <LogEntrySheet
        visible={logEntrySheetVisible}
        onClose={() => setLogEntrySheetVisible(false)}
        onSaved={() => setLogEntrySheetVisible(false)}
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
    gap: Spacing.one,
  },
  error: {
    color: '#F87171',
  },
  centered: {
    textAlign: 'center',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 64,
    height: 64,
  },
  avatarPlaceholderText: {
    textAlign: 'center',
    paddingHorizontal: Spacing.one,
  },
  row: {
    borderTopWidth: 1,
    paddingTop: Spacing.three,
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  notificationRow: {
    marginTop: Spacing.two,
  },
  logEntryRow: {
    marginTop: Spacing.two,
  },
  editSection: {
    marginTop: Spacing.three,
    gap: Spacing.two,
  },
  nameInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  saveButton: {
    marginTop: Spacing.two,
  },
  languageToggle: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  languageOption: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.one,
  },
});
