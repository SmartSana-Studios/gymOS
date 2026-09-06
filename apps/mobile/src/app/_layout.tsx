import {
  Barlow_400Regular,
  Barlow_500Medium,
  Barlow_600SemiBold,
  Barlow_700Bold,
  Barlow_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/barlow';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { I18nextProvider } from 'react-i18next';
import { PostHogProvider } from 'posthog-react-native';
import * as Sentry from '@sentry/react-native';
import { ANALYTICS_EVENT } from '@gymos/types';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { SessionProvider, useSession } from '@/hooks/use-session';
import { i18n } from '@/lib/i18n';
import { captureEvent, posthogClient, resolveAnalyticsEnvironment } from '@/lib/analytics';
import { OfflineSyncProvider } from '@/lib/offline-sync-context';
import { registerPushToken, subscribeToPushTokenChanges } from '@/services/pushTokens';

// Story 14.1 (AC #1, #2): mirrors this file's own `if (!posthogClient)`
// guard style below -- Sentry.init must never run when no DSN is
// configured, e.g. local dev.
const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

if (sentryDsn) {
  try {
    Sentry.init({
      dsn: sentryDsn,
      environment: resolveAnalyticsEnvironment(),
    });
  } catch (err) {
    console.error('[sentry] failed to initialize', err);
  }
}

SplashScreen.preventAutoHideAsync();

// Root auth gate (Story 2.6, Task 4; Story 2.7, Task 7). No session, or a
// session whose current membership row still has a null
// `onboarding_completed_at` -> onboarding is the only reachable group; a
// session that has completed the full onboarding flow (MA-06/07/08) -> the
// existing tab experience. Gating on `isOnboarded` (not just session
// presence) is required, not a nicety -- see useSession()'s own comment for
// the race it closes (Review finding, 2026-07-17) and for why the
// underlying signal changed from `users.display_name` (Story 2.7 Scope
// Note #1).
function RootNavigator() {
  const { session, isOnboarded, gymId, isLoading, isSuspended } = useSession();
  // Story 11.4 (AC #1, #3): a suspended/deactivated gym's member is routed
  // to the neutral full-screen state instead of either onboarding or
  // (tabs) -- mutually exclusive with both other guards below so exactly
  // one Stack.Protected group is ever active at a time.
  const showSuspended = !!session && isSuspended;
  const isFullyOnboarded = !!session && isOnboarded && !isSuspended;
  const sessionUserId = session?.user.id;

  // Story 9.5 (Task 6): app_opened, the concrete hook for the non-visit-
  // day-app-opens success metric. Fired once per cold launch (guarded by
  // the ref below, gated on isLoading so gymId reflects the settled
  // session state) and once per foreground-from-background transition
  // (the AppState listener further down) -- never on re-renders.
  const hasCapturedColdLaunch = useRef(false);
  useEffect(() => {
    if (hasCapturedColdLaunch.current || isLoading) return;
    hasCapturedColdLaunch.current = true;
    captureEvent(ANALYTICS_EVENT.APP_OPENED, { gymId });
  }, [isLoading, gymId]);

  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        captureEvent(ANALYTICS_EVENT.APP_OPENED, { gymId });
      }
      appStateRef.current = nextState;
    });
    return () => subscription.remove();
  }, [gymId]);

  // Story 8.3: Barlow replaces the system font app-wide. Declared
  // unconditionally alongside the other hooks below (Rules of Hooks) --
  // combined with `isLoading` in the single early-return gate further down,
  // so real screens never render in the system font before Barlow is ready.
  const [fontsLoaded, fontsError] = useFonts({
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    Barlow_700Bold,
    Barlow_800ExtraBold,
  });

  useEffect(() => {
    if (fontsError) {
      console.error('Failed to load Barlow fonts, falling back to system font:', fontsError);
    }
  }, [fontsError]);

  // Story 6.1 AC #1: registration fires once onboarding fully completes --
  // the same gate the auth Stack.Protected guard below already uses -- using
  // only the OS's own native permission dialog (no custom pre-permission
  // screen exists in the UX spec). Fire-and-forget: must not delay hiding
  // the splash screen or block the (tabs)/onboarding navigation switch,
  // which is why registerPushToken is never awaited here. Declared before
  // the isLoading early return below so this hook's call order never
  // changes across renders (Rules of Hooks).
  useEffect(() => {
    if (!isFullyOnboarded || !sessionUserId) return;
    void registerPushToken(sessionUserId);
    return subscribeToPushTokenChanges(sessionUserId);
  }, [isFullyOnboarded, sessionUserId]);

  // Keep the native splash visible (AnimatedSplashOverlay below still owns
  // hiding it) until the persisted session has been read once, so a
  // returning member never sees a flash of the onboarding flow -- and until
  // Barlow has loaded (or failed), so no screen ever flashes the system font.
  if (isLoading || (!fontsLoaded && !fontsError)) {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isFullyOnboarded}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="plan" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="renew" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="notifications" options={{ presentation: 'modal', headerShown: false }} />
        {/* Review finding: was never registered here despite being reachable
            via router.push('/workout-plan') from Home -- an unregistered
            top-level route still resolves via expo-router's file-based
            routing, but renders outside every Stack.Protected group's own
            JSX subtree, which is what let it reach useOfflineSync() without
            OfflineSyncProvider actually being an ancestor. */}
        <Stack.Screen name="workout-plan" />
      </Stack.Protected>

      <Stack.Protected guard={showSuspended}>
        <Stack.Screen name="suspended" />
      </Stack.Protected>

      <Stack.Protected guard={!isFullyOnboarded && !showSuspended}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
    </Stack>
  );
}

// Story 8.3 (Review finding): navigation chrome now matches the
// unconditionally-dark content theme (see hooks/use-theme.ts) instead of
// following the device color scheme -- device scheme is intentionally
// ignored app-wide until a real light-mode toggle is built.
function RootLayout() {
  const content = (
    <I18nextProvider i18n={i18n}>
      <SessionProvider>
        {/* Review finding: previously scoped to (tabs) only, on the stated
            rationale that "the sync engine has no reason to run before a
            member is signed in and onboarded" -- true, but the app has two
            real call sites that reach useOfflineSync() from outside that
            wrapper (workout-plan.tsx as an unregistered top-level route, and
            LogEntrySheet when opened from onboarding/body-profile.tsx),
            which crashed instead of the intended graceful "nothing to sync
            yet." Hoisted to the root instead of chasing each call site
            individually -- the provider itself doesn't depend on an
            authenticated session to construct (network state + local SQLite
            queue counts only), so mounting it before sign-in is harmless,
            not just tolerated. */}
        <OfflineSyncProvider>
          <ThemeProvider value={DarkTheme}>
            <StatusBar style="light" />
            <AnimatedSplashOverlay />
            <RootNavigator />
          </ThemeProvider>
        </OfflineSyncProvider>
      </SessionProvider>
    </I18nextProvider>
  );

  // Skip the provider entirely when no PostHog key is configured (local
  // dev with no project set up) rather than instantiating a client with an
  // empty api key.
  if (!posthogClient) {
    return content;
  }

  return <PostHogProvider client={posthogClient}>{content}</PostHogProvider>;
}

// Story 14.1: Sentry.wrap is safe to apply even when Sentry.init was never
// called (DSN unset, e.g. local dev) -- the SDK no-ops -- so it does not
// need its own conditional guard, unlike Sentry.init itself above.
export default Sentry.wrap(RootLayout);
