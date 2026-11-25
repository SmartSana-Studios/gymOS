import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/hooks/use-theme';
import { useGymAccentColor } from '@/hooks/use-gym-accent-color';

// Story 8.5: recolored to the dark+gym-accent palette only -- NativeTabs is
// the real OS-native tab bar (iOS UITabBar/Android equivalent), which can't
// be reshaped into a custom pill like the reference design's tab bar
// (explicit user direction: keep the app's existing native tab bar
// mechanism, don't replicate that shape).
export default function AppTabs() {
  const theme = useTheme();
  const accent = useGymAccentColor();
  const { t } = useTranslation();
  // Story 31.4: five tabs in every state. There is no Progress tab (Progress is a Profile row and a stack route) and the Streak tab is never hidden: it is for
  // member engagement, not for gyms, so the bar does not read the engagement gate (a hidden native tab also cannot be navigated to and remounts the navigator).

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

      <NativeTabs.Trigger name="streak">
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
