import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Pressable, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getProgressPhotoSignedUrl } from '@/lib/photo-upload';
import { setProgressPhotoSharing } from '@/services/progress';

/** Story 10.3 Task 6: resolves Story 10.2's deferred photo-sharing-toggle
 * UI -- the first caller of `setProgressPhotoSharing()` (zero callers
 * before this screen, per Story 10.2's own documented Scope Boundary).
 * Reached via `router.push({ pathname, params })` from the Progress
 * screen's photo grid (Task 5), which already has the photo's id/path/
 * shared-state in hand from its own `loadProgressScreenData` fetch --
 * params carry that data across so this screen needs no re-fetch of the
 * `progress_photos` row itself, only a signed URL for the image. */
export default function ProgressPhotoDetailScreen() {
  const { id, photoPath, sharedWithCoach } = useLocalSearchParams<{
    id: string;
    photoPath: string;
    sharedWithCoach: string;
  }>();
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadingImage, setLoadingImage] = useState(true);
  const [shared, setShared] = useState(sharedWithCoach === '1');
  const [togglePending, setTogglePending] = useState(false);
  const [toggleError, setToggleError] = useState(false);

  useEffect(() => {
    // Review finding: guards against an undefined route param -- reachable
    // via the Expo Router state-restoration quirk this story's own
    // docs/decisions.md entry already flags, not just normal internal
    // navigation (which always supplies photoPath).
    if (!photoPath) {
      setLoadingImage(false);
      return;
    }
    let cancelled = false;
    setLoadingImage(true);
    getProgressPhotoSignedUrl(photoPath)
      .then((url) => {
        if (cancelled) return;
        setSignedUrl(url);
        setLoadingImage(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSignedUrl(null);
        setLoadingImage(false);
      });
    return () => {
      cancelled = true;
    };
  }, [photoPath]);

  // Same optimistic-flip/rollback-on-failure shape as profile.tsx's
  // `handleToggleQuietGymAlerts` -- flip immediately, revert only if the
  // write fails, no separate Save action.
  async function handleToggleShared() {
    if (togglePending || !id) return;
    const previous = shared;
    setTogglePending(true);
    setToggleError(false);
    setShared(!previous);
    try {
      const { error } = await setProgressPhotoSharing(id, !previous);
      if (error && mountedRef.current) {
        setShared(previous);
        setToggleError(true);
      }
    } finally {
      if (mountedRef.current) setTogglePending(false);
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

        <View style={[styles.imageContainer, { backgroundColor: theme.surfaceElevated }]}>
          {loadingImage && <ActivityIndicator style={styles.loadingIndicator} />}
          {!loadingImage && signedUrl && (
            <Image
              source={{ uri: signedUrl }}
              style={styles.image}
              resizeMode="contain"
              onError={() => setSignedUrl(null)}
            />
          )}
          {!loadingImage && !signedUrl && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('progress.photoDetail.errorLoadFailed')}
            </ThemedText>
          )}
        </View>

        <View style={[styles.toggleRow, { borderTopColor: theme.border }]}>
          <View style={styles.toggleLabel}>
            <ThemedText type="default">{t('progress.photoDetail.shareLabel')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('progress.photoDetail.shareDescription')}
            </ThemedText>
          </View>
          <Switch
            accessibilityRole="switch"
            accessibilityLabel={t('progress.photoDetail.shareLabel')}
            accessibilityState={{ checked: shared, disabled: togglePending }}
            disabled={togglePending}
            value={shared}
            onValueChange={() => void handleToggleShared()}
          />
        </View>

        {toggleError && (
          <ThemedText type="small" style={styles.error}>
            {t('progress.photoDetail.errorToggleFailed')}
          </ThemedText>
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
    gap: Spacing.three,
  },
  backButton: {
    paddingVertical: Spacing.two,
  },
  imageContainer: {
    flex: 1,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  loadingIndicator: {
    marginTop: Spacing.four,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  toggleLabel: {
    flex: 1,
    gap: Spacing.half,
  },
  error: {
    color: '#F87171',
  },
});
