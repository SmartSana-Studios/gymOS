import type { RefObject } from 'react';
import { StyleSheet, View } from 'react-native';

import { ShareImageComposition } from '@/components/ShareImageComposition';
import type { ShareComposition } from '@/lib/shareImage';

export interface ShareImageHostProps {
  composition: ShareComposition | null;
  captureRef: RefObject<View | null>;
  onLogoSettled: () => void;
}

/** Story 31.3: where the share image is mounted so it can be captured: off screen (far to the left of the screen, not hidden by opacity, which a
 * capture would draw as empty), never focusable, never announced. Rendered by a screen only while sharing is possible. */
export function ShareImageHost({ composition, captureRef, onLogoSettled }: ShareImageHostProps) {
  if (!composition) return null;
  return (
    <View pointerEvents="none" style={styles.offscreen} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <ShareImageComposition ref={captureRef} composition={composition} onLogoSettled={onLogoSettled} />
    </View>
  );
}

const styles = StyleSheet.create({
  offscreen: {
    position: 'absolute',
    top: 0,
    left: -2000,
  },
});
