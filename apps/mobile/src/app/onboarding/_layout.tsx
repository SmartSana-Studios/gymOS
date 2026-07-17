import { Stack, usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { OnboardingProgressProvider, useOnboardingProgress } from '@/lib/onboarding-context';

/** UX-DR6 sequencing guard: linear, non-skippable, blocks direct
 * navigation into any step out of order. Pre-auth steps key off local
 * OnboardingProgressProvider state (no session exists yet to check);
 * MA-05/MA-06 key off `otpVerified`, which is only ever set true after a
 * real `verifyOtp` success (Task 7). Redirects, rather than blocking
 * render, so a stale/direct deep-navigation attempt always lands back on
 * the correct step instead of a blank/broken screen. */
function SequencingGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { language, phone, otpVerified, goal, experienceLevel } = useOnboardingProgress();

  useEffect(() => {
    if (pathname.startsWith('/onboarding/phone') && language === null) {
      router.replace('/onboarding/language');
      return;
    }
    if ((pathname.startsWith('/onboarding/otp') || pathname.startsWith('/onboarding/lockout')) && phone === null) {
      // Covers /onboarding/lockout too (Review finding, 2026-07-17) --
      // reaching it also requires a phone, same prerequisite as /otp.
      router.replace(language === null ? '/onboarding/language' : '/onboarding/phone');
      return;
    }
    if (
      (pathname.startsWith('/onboarding/profile') || pathname.startsWith('/onboarding/goal')) &&
      !otpVerified
    ) {
      // Redirect to the nearest missing prerequisite step, not always back
      // to the start -- previously this branch always sent an out-of-order
      // nav attempt all the way to /language, discarding any already-entered
      // phone, unlike every other branch here (Review finding, 2026-07-17).
      if (language === null) {
        router.replace('/onboarding/language');
      } else if (phone === null) {
        router.replace('/onboarding/phone');
      } else {
        router.replace('/onboarding/otp');
      }
      return;
    }
    // Story 2.7 Task 8: same "nearest missing prerequisite" discipline
    // extended one/two steps further -- /experience requires a goal
    // selection (MA-06) and /plan requires an experience-level selection
    // (MA-07), each falling back through every earlier prerequisite too.
    if (pathname.startsWith('/onboarding/experience') && goal === null) {
      if (language === null) {
        router.replace('/onboarding/language');
      } else if (phone === null) {
        router.replace('/onboarding/phone');
      } else if (!otpVerified) {
        router.replace('/onboarding/otp');
      } else {
        router.replace('/onboarding/goal');
      }
      return;
    }
    if (pathname.startsWith('/onboarding/plan') && experienceLevel === null) {
      if (language === null) {
        router.replace('/onboarding/language');
      } else if (phone === null) {
        router.replace('/onboarding/phone');
      } else if (!otpVerified) {
        router.replace('/onboarding/otp');
      } else if (goal === null) {
        router.replace('/onboarding/goal');
      } else {
        router.replace('/onboarding/experience');
      }
    }
  }, [pathname, language, phone, otpVerified, goal, experienceLevel, router]);

  return children;
}

export default function OnboardingLayout() {
  return (
    <OnboardingProgressProvider>
      <SequencingGuard>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="language" />
          <Stack.Screen name="phone" />
          <Stack.Screen name="otp" />
          {/* MA-04: back-navigation intercepted/disabled (EXPERIENCE.md) --
              gestureEnabled: false blocks the iOS swipe-back gesture; the
              screen itself (Task 8) has no back arrow to tap and also
              overrides the Android hardware-back gesture. */}
          <Stack.Screen name="lockout" options={{ gestureEnabled: false }} />
          <Stack.Screen name="profile" />
          <Stack.Screen name="goal" />
          <Stack.Screen name="experience" />
          <Stack.Screen name="plan" />
        </Stack>
      </SequencingGuard>
    </OnboardingProgressProvider>
  );
}
