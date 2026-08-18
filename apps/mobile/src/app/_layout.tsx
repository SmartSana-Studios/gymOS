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
import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { useSession } from '@/hooks/use-session';
import { i18n } from '@/lib/i18n';
import { registerPushToken, subscribeToPushTokenChanges } from '@/services/pushTokens';

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
  const { session, isOnboarded, isLoading } = useSession();
  const isFullyOnboarded = !!session && isOnboarded;
  const sessionUserId = session?.user.id;

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
      </Stack.Protected>

      <Stack.Protected guard={!isFullyOnboarded}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
    </Stack>
  );
}

// Story 8.3 (Review finding): navigation chrome now matches the
// unconditionally-dark content theme (see hooks/use-theme.ts) instead of
// following the device color scheme -- device scheme is intentionally
// ignored app-wide until a real light-mode toggle is built.
export default function RootLayout() {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider value={DarkTheme}>
        <StatusBar style="light" />
        <AnimatedSplashOverlay />
        <RootNavigator />
      </ThemeProvider>
    </I18nextProvider>
  );
}
