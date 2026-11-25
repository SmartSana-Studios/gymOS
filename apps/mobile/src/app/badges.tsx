import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BadgeDetailSheet } from '@/components/BadgeDetailSheet';
import { BadgeTile, BadgeTileSkeleton } from '@/components/BadgeTile';
import { ShareImageHost } from '@/components/ShareImageHost';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card } from '@/components/ui/Card';
import { Spacing } from '@/constants/theme';
import { useBadges } from '@/hooks/use-badges';
import { GymAccentColorProvider } from '@/hooks/use-gym-accent-color';
import { useShareContext } from '@/hooks/use-share-context';
import { useShareImage } from '@/hooks/use-share-image';
import { useSession } from '@/hooks/use-session';
import { useOfflineSync } from '@/lib/offline-sync-context';
import { buildSheetView, type BadgeTileView } from '@/lib/badgesView';
import { showMiniCalendar } from '@/lib/celebrationView';
import { shareMessageKey, shareRetryKey } from '@/lib/shareFlow';
import type { ShareImageInput } from '@/lib/shareImage';

const MAX_WIDTH = 480;
const SKELETON_COUNT = 5;

/** Story 31.3 (MA-21, FR-230, FR-231): the Badge Shelf, pushed from the Profile "Badges" row and from the celebration's [See your badges]. Layout only:
 * the hook (hooks/use-badges.ts) loads, caches and sequences, the view model (lib/badgesView.ts) decides every tile state and every word. A two-column
 * grid of five tiles in fixed order, the footnote, pull to refresh, skeletons while loading, the error card, the device copy offline. Tapping a tile
 * opens the detail sheet; an earned badge there can be shared (the image is built on the device, from local data, and works offline). */
export default function BadgesScreen() {
  return (
    <GymAccentColorProvider>
      <BadgesScreenContent />
    </GymAccentColorProvider>
  );
}

function BadgesScreenContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, gymId } = useSession();
  const { isConnected } = useOfflineSync();
  const { view, refreshing, refresh } = useBadges(isConnected, session?.user.id ?? null, gymId);
  const { height, fontScale } = useWindowDimensions();

  const [openCode, setOpenCode] = useState<BadgeTileView['code'] | null>(null);
  const openTile = useMemo(() => view.tiles.find((tile) => tile.code === openCode) ?? null, [view.tiles, openCode]);

  // What the share image of the open badge needs besides the badge itself: the gym's name and logo, and (where there is room) this month's lit days.
  const roomForCalendar = showMiniCalendar(height, fontScale);
  const { branding, calendar } = useShareContext(openTile?.earned === true, gymId, roomForCalendar);

  const shareInput = useMemo<ShareImageInput | null>(
    () =>
      openTile?.earned
        ? {
            subject: { kind: 'badge', code: openTile.code, name: openTile.name, glyph: openTile.glyph, earnedOnText: openTile.dateText },
            gymName: branding?.name ?? null,
            logoUrl: branding?.logoUrl ?? null,
            calendar,
            t,
          }
        : null,
    [openTile, branding, calendar, t],
  );
  const { buttonRef: shareButtonRef, captureViewRef: shareCaptureRef, ...share } = useShareImage(shareInput);
  const sheetView = useMemo(() => (openTile ? buildSheetView(openTile, t, share.canShare) : null), [openTile, t, share.canShare]);
  const messageKey = shareMessageKey(share.status);
  const retryKey = shareRetryKey(share.status);
  const close = useCallback(() => setOpenCode(null), []);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.backButton}>
            <ThemedText type="default">←</ThemedText>
          </Pressable>
          <ThemedText type="subtitle" accessibilityRole="header" style={styles.headerTitle}>
            {view.title}
          </ThemedText>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
          showsVerticalScrollIndicator={false}>
          <View style={styles.column}>
            {view.summary && (
              <ThemedText type="smallBold" themeColor="textSecondary">
                {view.summary}
              </ThemedText>
            )}

            {view.face === 'loading' && (
              <View style={styles.grid}>
                {Array.from({ length: SKELETON_COUNT }, (_, index) => (
                  <BadgeTileSkeleton key={index} />
                ))}
              </View>
            )}

            {view.face === 'tiles' && (
              <View style={styles.grid}>
                {view.tiles.map((tile) => (
                  <BadgeTile key={tile.code} tile={tile} onPress={() => setOpenCode(tile.code)} />
                ))}
              </View>
            )}

            {view.face === 'error' && (
              <Card variant="flat" style={styles.errorCard}>
                <ThemedText type="small" themeColor="textSecondary">
                  {view.errorMessage}
                </ThemedText>
              </Card>
            )}

            <ThemedText type="small" themeColor="textSecondary">
              {view.footnote}
            </ThemedText>
          </View>
        </ScrollView>
      </SafeAreaView>

      <BadgeDetailSheet
        visible={openTile !== null}
        view={sheetView}
        message={messageKey ? t(messageKey) : null}
        retryLabel={retryKey ? t(retryKey) : null}
        sharing={share.status === 'sharing'}
        onShare={() => void share.share()}
        onClose={close}
        shareButtonRef={shareButtonRef}
      />
      <ShareImageHost composition={share.composition} captureRef={shareCaptureRef} onLogoSettled={share.onLogoSettled} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
  },
  backButton: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
  },
  content: {
    alignItems: 'center',
    paddingBottom: Spacing.five,
  },
  column: {
    width: '100%',
    maxWidth: MAX_WIDTH,
    gap: Spacing.three,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -Spacing.three / 2,
  },
  errorCard: {
    gap: Spacing.three,
  },
});
