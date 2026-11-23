import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';

const PULSE_CYCLES = 3;
const PULSE_HALF_MS = 800;
const PULSE_LOW = 0.45;

/** True while the device's reduce-motion setting is on, following the setting live. Shared by every at-risk surface (Home's hint, the calendar's cell
 * and line): none of them animates when it is on. */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled) setReduceMotion(enabled);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
  return reduceMotion;
}

/** Story 30.4 / 30.5 (`atRiskPulse`): an opacity that pulses three times on each focus, then stays still. With reduce-motion on it never animates
 * (the caller draws a static 2pt warning outline instead). Extracted from the Home hint so the calendar's at-risk cell and line share one behaviour. */
export function useAtRiskPulse(): { opacity: Animated.Value; reduceMotion: boolean } {
  const reduceMotion = useReduceMotion();
  const [opacity] = useState(() => new Animated.Value(1));

  useFocusEffect(
    useCallback(() => {
      if (reduceMotion) {
        opacity.setValue(1);
        return;
      }
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: PULSE_LOW, duration: PULSE_HALF_MS, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: PULSE_HALF_MS, useNativeDriver: true }),
        ]),
        { iterations: PULSE_CYCLES },
      );
      pulse.start();
      return () => {
        pulse.stop();
        opacity.setValue(1);
      };
    }, [reduceMotion, opacity]),
  );

  return { opacity, reduceMotion };
}
