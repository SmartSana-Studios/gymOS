import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Animated, BackHandler, findNodeHandle, Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CelebrationMiniMonth } from '@/components/CelebrationMiniMonth';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ShareImageHost } from '@/components/ShareImageHost';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spacing } from '@/constants/theme';
import { GymAccentColorProvider } from '@/hooks/use-gym-accent-color';
import { useReduceMotion } from '@/hooks/use-at-risk-pulse';
import { useSession } from '@/hooks/use-session';
import { useShareImage } from '@/hooks/use-share-image';
import {
  buildCelebrationView,
  buildMiniMonth,
  celebrationButtons,
  celebrationMonth,
  celebrationVisible,
  closeDestination,
  closeRecord,
  finishCelebration,
  markShownAcked,
  motionPlan,
  numeralAt,
  parseMilestoneParam,
  reduceMotionFrom,
  readShown,
  shouldOpenHome,
  showMiniCalendar,
  writeShown,
  type ShownRead,
} from '@/lib/celebrationView';
import { shareMessageKey, shareRetryKey } from '@/lib/shareFlow';
import type { ShareImageInput } from '@/lib/shareImage';
import { getGymBranding, acknowledgeMilestone, type GymBranding } from '@/services/milestones';
import { getMyVisitDays } from '@/services/visitDays';

const MAX_WIDTH = 480;
const CARD_MAX_WIDTH = 420;
const LOGO_SIZE = 48;
const CARD_RADIUS = 24;

/** Story 30.7 (MA-20, FR-229): the milestone celebration, pushed once over Home (hooks/use-home-celebration.ts) with the milestone number as the route
 * parameter `milestoneId` and the gym-local day the server returned as `today`. Layout only: lib/celebrationView.ts decides what is shown, the motion
 * and every word. Dark background, no tab bar, no back arrow. Story 31.3 adds [Share] (primary), [Keep going] (secondary) and the [See your badges] link. [Keep going] and Android back close it;
 * swipe down does nothing (`gestureEnabled: false` in the root layout). A number the device has already shown, or one that is not a milestone, opens Home. */
export default function CelebrationScreen() {
  return (
    <GymAccentColorProvider>
      <CelebrationContent />
    </GymAccentColorProvider>
  );
}

const CLOSE_DEPS = { writeShown, markShownAcked, acknowledge: acknowledgeMilestone };

function CelebrationContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, gymId } = useSession();
  const params = useLocalSearchParams<{ milestoneId?: string; today?: string }>();
  const { height, fontScale } = useWindowDimensions();
  const hookReduceMotion = useReduceMotion();
  const userId = session?.user.id ?? null;
  const milestone = parseMilestoneParam(params.milestoneId);
  const month = celebrationMonth(params.today);
  const miniWanted = month !== null && showMiniCalendar(height, fontScale);

  const [shown, setShown] = useState<ShownRead | null>(null);
  const [branding, setBranding] = useState<GymBranding | null>(null);
  const [litDays, setLitDays] = useState<string[] | null>(null);
  const [dataReady, setDataReady] = useState(false);
  // The screen's own reduce-motion read (null until it resolves): the first frame waits for it, and its value (or the hook's, which follows the setting
  // live) builds the plan, so the card never starts with the full motion and then drops it.
  const [motionRead, setMotionRead] = useState<boolean | null>(null);
  const motionKnown = motionRead !== null;
  const reduceMotion = reduceMotionFrom(motionRead, hookReduceMotion);

  const closedRef = useRef(false);
  const headlineRef = useRef<View | null>(null);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((enabled) => {
        if (!cancelled) setMotionRead(enabled);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The card waits only for the device's shown-store: the gym name and logo and the lit days arrive later into state.
  useEffect(() => {
    if (!userId || !gymId) {
      setShown({ kind: 'unreadable' });
      setDataReady(true);
      return;
    }
    let cancelled = false;
    void readShown(userId, gymId).then((shownRead) => {
      if (cancelled) return;
      setShown(shownRead);
      setDataReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, gymId]);

  useEffect(() => {
    if (!gymId) return;
    let cancelled = false;
    void getGymBranding(gymId).then((read) => {
      if (!cancelled) setBranding(read);
    });
    return () => {
      cancelled = true;
    };
  }, [gymId]);

  useEffect(() => {
    if (!miniWanted || !month) return;
    let cancelled = false;
    void getMyVisitDays(month).then((days) => {
      if (!cancelled) setLitDays(days.status === 'success' ? days.days.map((d) => d.visitDay) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [miniWanted, month]);

  const goHome = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const openHome = dataReady && shown !== null && shouldOpenHome(milestone, shown);
  useEffect(() => {
    if (openHome && !closedRef.current) {
      closedRef.current = true;
      goHome();
    }
  }, [openHome, goHome]);

  const view = useMemo(
    () => (milestone !== null ? buildCelebrationView({ milestone, gymName: branding?.name ?? null, t }) : null),
    [milestone, branding, t],
  );
  const visible = celebrationVisible({ dataReady, motionKnown, openHome, hasView: view !== null });

  // [Keep going] and Android back: the record first, then the server call, in the background; the screen closes at once. Before the card is on screen
  // the member has seen nothing, so back only goes Home: nothing is recorded and nothing is acknowledged.
  // [See your badges] records and acknowledges exactly like [Keep going] (in the background, retried silently when offline) and then REPLACES this
  // route with the shelf, so Back from the shelf returns to Home.
  const close = useCallback(
    (action: 'continue' | 'badges' = 'continue') => {
      if (closedRef.current) return;
      closedRef.current = true;
      const record = closeRecord({ visible, milestone, userId, gymId });
      if (record) void finishCelebration(CLOSE_DEPS, record.userId, record.gymId, record.milestone);
      if (closeDestination(action) === 'badges') router.replace('/badges');
      else goHome();
    },
    [visible, milestone, userId, gymId, goHome, router],
  );

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => subscription.remove();
  }, [close]);

  const plan = useMemo(() => motionPlan(reduceMotion), [reduceMotion]);
  const [opacity] = useState(() => new Animated.Value(0));
  const [scale] = useState(() => new Animated.Value(1));
  const [progress] = useState(() => new Animated.Value(0));
  const [numeral, setNumeral] = useState<number | null>(null);

  const target = view?.milestone ?? null;
  useEffect(() => {
    if (!visible || target === null) return;
    if (plan.haptic) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    scale.setValue(plan.scaleFrom);
    opacity.setValue(0);
    const animations = [Animated.timing(opacity, { toValue: 1, duration: plan.fadeMs, useNativeDriver: true })];
    if (plan.scaleFrom !== 1) animations.push(Animated.timing(scale, { toValue: 1, duration: plan.fadeMs, useNativeDriver: true }));
    let listener: string | null = null;
    if (plan.countUp) {
      progress.setValue(0);
      setNumeral(0);
      listener = progress.addListener(({ value }) => setNumeral(numeralAt(value, target)));
      animations.push(Animated.timing(progress, { toValue: 1, duration: plan.countUpMs, useNativeDriver: false }));
    } else {
      setNumeral(target);
    }
    const run = Animated.parallel(animations);
    run.start();
    return () => {
      run.stop();
      if (listener) progress.removeListener(listener);
    };
  }, [visible, target, plan, opacity, scale, progress]);

  // Announced once as an alert; focus starts on the headline.
  const announced = useRef(false);
  // The sentence names the gym, so it waits for the gym read (at most a second) rather than announcing an empty name.
  useEffect(() => {
    if (!visible || !view || announced.current) return;
    const announce = () => {
      if (announced.current) return;
      announced.current = true;
      AccessibilityInfo.announceForAccessibility(view.a11y);
      const handle = headlineRef.current ? findNodeHandle(headlineRef.current) : null;
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
    };
    if (branding !== null) {
      announce();
      return;
    }
    const timer = setTimeout(announce, 1000);
    return () => clearTimeout(timer);
  }, [visible, view, branding]);

  const mini = visible && miniWanted && month && litDays ? buildMiniMonth(month, litDays) : null;

  // Story 31.3 (FR-231): the share image is composed from this card's own data (the gym's name and logo, the milestone, this month's lit days where the
  // card has room) and nothing else: no member name, phone, payment figure or watermark (lib/shareImage.ts).
  const shareInput = useMemo<ShareImageInput | null>(
    () =>
      milestone !== null
        ? {
            subject: { kind: 'milestone', milestone },
            gymName: branding?.name ?? null,
            logoUrl: branding?.logoUrl ?? null,
            calendar: miniWanted && month && litDays ? { month, litDays } : null,
            t,
          }
        : null,
    [milestone, branding, miniWanted, month, litDays, t],
  );
  const { buttonRef: shareButtonRef, captureViewRef: shareCaptureRef, ...share } = useShareImage(shareInput);
  const buttons = celebrationButtons(share.canShare);
  const messageKey = shareMessageKey(share.status);
  const retryKey = shareRetryKey(share.status);

  if (!visible || !view) return <ThemedView style={styles.container} />;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.column}>
            {view.mascot !== '' && <ThemedText style={styles.mascot}>{view.mascot}</ThemedText>}
            <Animated.View style={[styles.cardWrap, { opacity, transform: [{ scale }] }]} accessibilityRole="alert" accessibilityLabel={view.a11y}>
              <Card variant="flat" style={styles.card}>
                {branding?.logoUrl ? (
                  <Image source={{ uri: branding.logoUrl }} style={styles.logo} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                ) : null}
                {view.gymName !== '' && (
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {view.gymName}
                  </ThemedText>
                )}
                <ThemedText accessibilityRole="none" accessibilityElementsHidden importantForAccessibility="no" style={styles.numeral}>
                  {String(numeral ?? view.milestone)}
                </ThemedText>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {view.unit}
                </ThemedText>
                <View ref={headlineRef} accessible accessibilityRole="header" accessibilityLabel={view.headline}>
                  <ThemedText type="subtitle" style={styles.centered}>
                    {view.headline}
                  </ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                  {view.sub}
                </ThemedText>
                {mini && <CelebrationMiniMonth rows={mini} />}
              </Card>
            </Animated.View>
            {messageKey && (
              <View style={styles.buttonWrap}>
                <ThemedText type="small" themeColor="textSecondary" accessibilityRole="alert" style={styles.centered}>
                  {t(messageKey)}
                </ThemedText>
                {retryKey && <Button label={t(retryKey)} variant="secondary" onPress={() => void share.share()} disabled={share.status === 'sharing'} />}
              </View>
            )}
            <View style={styles.buttonWrap}>
              {buttons.showShare && (
                <View ref={shareButtonRef} collapsable={false}>
                  <Button label={view.shareLabel} onPress={() => void share.share()} loading={share.status === 'sharing'} />
                </View>
              )}
              <Button label={view.continueLabel} variant={buttons.continueVariant} onPress={() => close('continue')} />
              <Pressable accessibilityRole="link" accessibilityLabel={view.badgesLabel} onPress={() => close('badges')} style={styles.badgesLink}>
                <ThemedText type="link">{view.badgesLabel}</ThemedText>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
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
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.four,
  },
  column: {
    width: '100%',
    maxWidth: MAX_WIDTH,
    alignItems: 'center',
    gap: Spacing.three,
  },
  mascot: {
    textAlign: 'center',
  },
  cardWrap: {
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
  },
  card: {
    borderRadius: CARD_RADIUS,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: LOGO_SIZE / 2,
  },
  numeral: {
    fontFamily: 'Barlow_800ExtraBold',
    fontSize: 96,
    lineHeight: 104,
    fontVariant: ['tabular-nums'],
  },
  centered: {
    textAlign: 'center',
  },
  buttonWrap: {
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
    gap: Spacing.two,
  },
  badgesLink: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
