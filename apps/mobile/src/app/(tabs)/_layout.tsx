import AppTabs from '@/components/app-tabs';
import { GymAccentColorProvider } from '@/hooks/use-gym-accent-color';

// Review finding: OfflineSyncProvider moved to the root layout (_layout.tsx)
// -- it's needed by screens outside (tabs) too (workout-plan.tsx,
// LogEntrySheet reached from onboarding/body-profile.tsx), so a single
// instance at the root is correct, not one scoped here plus ad hoc fixes
// per call site.
export default function TabsLayout() {
  return (
    <GymAccentColorProvider>
      <AppTabs />
    </GymAccentColorProvider>
  );
}
