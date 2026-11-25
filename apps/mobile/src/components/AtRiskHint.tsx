import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, StyleSheet, View } from 'react-native';

import { WARNING_COLOR } from '@/components/GoalRing';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAtRiskPulse } from '@/hooks/use-at-risk-pulse';
import type { HintView } from '@/lib/weeklyRing';

/** The at-risk line: glyph `schedule`, the line, the hours left. It pulses three times on each focus, then stays still; with reduce-motion on it never
 * animates and a static 2pt warning outline carries the emphasis. It is announced once per focus through a polite live region (Android) or an
 * announcement (iOS), never as an alert, and the announced text is frozen at focus time so the minutes ticking do not announce again. Used by Home's
 * "This week" card (Story 30.4) and under the calendar grid (Story 30.5). */
export function AtRiskHint({ hint }: { hint: HintView }) {
  const { opacity, reduceMotion } = useAtRiskPulse();
  const [announcement, setAnnouncement] = useState('');
  const labelRef = useRef(hint.label);
  useEffect(() => {
    labelRef.current = hint.label;
  });

  // Announced once per focus: stable deps only, so the late answer of the reduce-motion query cannot announce it again.
  useFocusEffect(
    useCallback(() => {
      setAnnouncement(labelRef.current);
      if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(labelRef.current);
      return () => setAnnouncement('');
    }, []),
  );

  return (
    <View>
      <View accessibilityLiveRegion="polite" style={styles.liveRegion}>
        <ThemedText type="small">{announcement}</ThemedText>
      </View>
      <Animated.View
        accessible
        accessibilityLabel={hint.label}
        style={[styles.hint, { opacity, borderColor: reduceMotion ? WARNING_COLOR : 'transparent' }]}>
        <MaterialIcons name="schedule" size={20} color={WARNING_COLOR} />
        <View style={styles.hintText}>
          <ThemedText type="small" style={{ color: WARNING_COLOR }}>
            {hint.text} {hint.timeLeft}
          </ThemedText>
          {hint.shieldReady && (
            <ThemedText type="small" themeColor="textSecondary">
              {hint.shieldReady}
            </ThemedText>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 2,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  hintText: {
    flexShrink: 1,
  },
  liveRegion: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
});
