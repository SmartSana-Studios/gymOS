import AppTabs from '@/components/app-tabs';
import { GymAccentColorProvider } from '@/hooks/use-gym-accent-color';
import { OfflineSyncProvider } from '@/lib/offline-sync-context';

export default function TabsLayout() {
  return (
    <GymAccentColorProvider>
      <OfflineSyncProvider>
        <AppTabs />
      </OfflineSyncProvider>
    </GymAccentColorProvider>
  );
}
