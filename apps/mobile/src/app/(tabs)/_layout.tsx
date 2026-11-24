import { useEffect } from 'react';

import AppTabs from '@/components/app-tabs';
import { GymAccentColorProvider } from '@/hooks/use-gym-accent-color';
import { useSession } from '@/hooks/use-session';
import { bindEngagementGate, resetEngagementGate } from '@/lib/engagementGate';

// Review finding: OfflineSyncProvider moved to the root layout (_layout.tsx)
// -- it's needed by screens outside (tabs) too (workout-plan.tsx,
// LogEntrySheet reached from onboarding/body-profile.tsx), so a single
// instance at the root is correct, not one scoped here plus ad hoc fixes
// per call site.
export default function TabsLayout() {
  const { session, gymId } = useSession();
  const userId = session?.user.id ?? null;

  // Story 31.4: the engagement gate (lib/engagementGate.ts) is bound to the signed-in member here, above every tab, so the Home streak line and the Streak screen
  // can start from the device copy before any screen has read the row (the tab bar does not read it). Another member, or signing out, resets it to unknown.
  useEffect(() => {
    if (!userId || !gymId) {
      resetEngagementGate();
      return;
    }
    void bindEngagementGate(userId, gymId);
  }, [userId, gymId]);
  useEffect(() => resetEngagementGate, []);

  return (
    <GymAccentColorProvider>
      <AppTabs />
    </GymAccentColorProvider>
  );
}
