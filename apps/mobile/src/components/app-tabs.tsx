import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/hooks/use-theme';
import { useGymAccentColor } from '@/hooks/use-gym-accent-color';
import { useEngagementGate } from '@/lib/engagementGate';

// Story 8.5: recolored to the dark+gym-accent palette only -- NativeTabs is
// the real OS-native tab bar (iOS UITabBar/Android equivalent), which can't
// be reshaped into a custom pill like the reference design's tab bar
// (explicit user direction: keep the app's existing native tab bar
// mechanism, don't replicate that shape).
export default function AppTabs() {
  const theme = useTheme();
  const accent = useGymAccentColor();
  const { t } = useTranslation();
  // Story 31.4: there is no Progress tab in any state (Progress is a Profile row and a stack route). With the engagement area on the Streak tab sits in
  // the fourth place; off or unknown the bar has four tabs and the Streak trigger is hidden (it is never navigated to in that state).
  const streakOn = useEngagementGate() === 'on';

  return (
    <NativeTabs
      backgroundColor={theme.surface}
      indicatorColor={accent}
      labelStyle={{ selected: { color: theme.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="checkin">
        <NativeTabs.Trigger.Label>Check In</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="qrcode.viewfinder" md="qr_code_scanner" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="classes">
        <NativeTabs.Trigger.Label>Classes</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" md="event" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="streak" hidden={!streakOn}>
        <NativeTabs.Trigger.Label>{t('engage.streak.tab')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="flame" md="local_fire_department" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/explore.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
