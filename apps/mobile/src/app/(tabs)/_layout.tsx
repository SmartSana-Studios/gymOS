import AppTabs from '@/components/app-tabs';
import { OfflineSyncProvider } from '@/lib/offline-sync-context';

export default function TabsLayout() {
  return (
    <OfflineSyncProvider>
      <AppTabs />
    </OfflineSyncProvider>
  );
}
