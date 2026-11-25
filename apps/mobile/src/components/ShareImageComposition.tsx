import { forwardRef, useCallback, useEffect, useState } from 'react';
import { Image, StyleSheet, View, type ViewInstance } from 'react-native';

import { CelebrationMiniMonth } from '@/components/CelebrationMiniMonth';
import { ThemedText } from '@/components/themed-text';
import { IconChip } from '@/components/ui/IconChip';
import { Spacing } from '@/constants/theme';
import type { ShareComposition, ShareNode } from '@/lib/shareImage';

const LOGO_SIZE = 48;

export interface ShareImageCompositionProps {
  composition: ShareComposition;
  /** Called once when the logo has loaded or failed (or at once when there is none): the capture waits for it. A failed logo is dropped silently. */
  onLogoSettled: () => void;
}

function renderNode(node: ShareNode, index: number, onLogo: { loaded: () => void; failed: () => void; dropped: boolean }) {
  // Every text of the image ignores the device's font scale: the picture is a fixed 360 by 640 pt composition, and a large text size must not make it overflow.
  switch (node.kind) {
    case 'logo':
      return onLogo.dropped ? null : (
        <Image key={index} source={{ uri: node.uri }} style={styles.logo} onLoad={onLogo.loaded} onError={onLogo.failed} />
      );
    case 'glyph':
      return <IconChip key={index} icon={node.icon} tint="accent" size="large" />;
    case 'calendar':
      return <CelebrationMiniMonth key={index} rows={node.rows} />;
    case 'text':
      switch (node.role) {
        case 'gymName':
          return (
            <ThemedText key={index} allowFontScaling={false} type="smallBold" numberOfLines={1} style={styles.centered}>
              {node.text}
            </ThemedText>
          );
        case 'numeral':
          return (
            <ThemedText key={index} allowFontScaling={false} style={styles.numeral}>
              {node.text}
            </ThemedText>
          );
        case 'unit':
          return (
            <ThemedText key={index} allowFontScaling={false} type="smallBold" themeColor="textSecondary">
              {node.text}
            </ThemedText>
          );
        case 'headline':
        case 'badgeName':
          return (
            <ThemedText key={index} allowFontScaling={false} type="subtitle" style={styles.centered}>
              {node.text}
            </ThemedText>
          );
        default:
          return (
            <ThemedText key={index} allowFontScaling={false} type="small" themeColor="textSecondary" style={styles.centered}>
              {node.text}
            </ThemedText>
          );
      }
  }
}

/** Story 31.3 (FR-231): the share image, drawn from `buildShareComposition` (lib/shareImage.ts), which decides every node. A fixed 360 by 640 pt box
 * on the card background, captured at 3x for the 1080 by 1920 PNG. It is mounted off screen next to the card and never shown to the member; no
 * layout choice depends on the screen it sits in, so the image does not change with the phone. Layout only. */
export const ShareImageComposition = forwardRef<ViewInstance, ShareImageCompositionProps>(function ShareImageComposition({ composition, onLogoSettled }, ref) {
  const hasLogo = composition.nodes.some((node) => node.kind === 'logo');
  // A logo that failed is dropped for THAT URL only: another logo URL is tried again.
  const logoUri = composition.nodes.find((node) => node.kind === 'logo');
  const currentLogo = logoUri && logoUri.kind === 'logo' ? logoUri.uri : null;
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const dropped = currentLogo !== null && failedUri === currentLogo;
  const settle = useCallback(() => onLogoSettled(), [onLogoSettled]);
  // With no logo there is nothing to wait for.
  useEffect(() => {
    if (!hasLogo) settle();
  }, [hasLogo, settle]);
  const onLogo = {
    dropped,
    loaded: settle,
    failed: () => {
      setFailedUri(currentLogo);
      settle();
    },
  };
  return (
    <View
      ref={ref}
      collapsable={false}
      style={[styles.canvas, { width: composition.width, height: composition.height, backgroundColor: composition.background }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <View style={styles.column}>{composition.nodes.map((node, index) => renderNode(node, index, onLogo))}</View>
    </View>
  );
});

const styles = StyleSheet.create({
  canvas: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  column: {
    width: '100%',
    alignItems: 'center',
    gap: Spacing.two,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: LOGO_SIZE / 2,
  },
  numeral: {
    fontFamily: 'Barlow_800ExtraBold',
    fontSize: 96,
    lineHeight: 104,
    fontVariant: ['tabular-nums'],
  },
  centered: {
    textAlign: 'center',
  },
});
