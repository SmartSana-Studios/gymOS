import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, Platform, type View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import {
  isShareFileName,
  isShareKnownUnavailable,
  markShareUnavailable,
  runShareFlow,
  shareFileName,
  shareStatusAfter,
  visibleShareStatus,
  type ShareFlowDeps,
  type ShareStatus,
} from '@/lib/shareFlow';
import { createLogoGate } from '@/lib/logoGate';
import { buildShareComposition, buildShareOptions, captureSize, shareSubjectKey, type ShareAnchor, type ShareComposition, type ShareImageInput } from '@/lib/shareImage';

/** How long the capture waits for the logo before making the image without it. */
const LOGO_WAIT_MS = 3000;
const ANCHOR_WAIT_MS = 500;

export interface ShareImage {
  /** The composition to mount off screen (ShareImageHost); null while there is no input. */
  composition: ShareComposition | null;
  /** The ref of the view that is captured (ShareImageHost's `captureRef`). */
  captureViewRef: React.RefObject<View | null>;
  /** Called by the composition when its logo has loaded or failed. */
  onLogoSettled: () => void;
  /** The ref of the Share button, so the iPad sheet is anchored to it. */
  buttonRef: React.RefObject<View | null>;
  status: ShareStatus;
  /** False when an earlier run found sharing unavailable on this phone (the button is hidden on this view). */
  canShare: boolean;
  /** Runs the flow once; ignored while one is running. Never throws. */
  share: () => Promise<void>;
}

function nextFrames(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function measureAnchor(node: View | null): Promise<ShareAnchor | undefined> {
  if (Platform.OS !== 'ios' || !node) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ANCHOR_WAIT_MS);
    node.measureInWindow((x, y, width, height) => {
      clearTimeout(timer);
      resolve({ x, y, width, height });
    });
  });
}

/** Story 31.3 (FR-231; AD-60): wires the share flow (lib/shareFlow.ts) to the real capture, file and share-sheet modules. The image is composed from
 * local data (lib/shareImage.ts), captured at 1080 by 1920 px by react-native-view-shot as base64, written to the app's cache directory, handed to
 * the OS share sheet by expo-sharing, and deleted afterwards. No network call, no server, no photo-library or storage permission. Nothing here throws. */
export function useShareImage(input: ShareImageInput | null): ShareImage {
  const captureViewRef = useRef<View | null>(null);
  const buttonRef = useRef<View | null>(null);
  // The result of a run belongs to the subject it was made for (a badge, a milestone): `status` below is idle for any other subject, so a message never
  // follows the member to the next badge, a reopened sheet or a sheet that closed while the run was going.
  const subjectKey = shareSubjectKey(input);
  const [entry, setEntry] = useState<{ key: string | null; status: ShareStatus } | null>(null);
  const status = visibleShareStatus(entry, subjectKey);
  // Decided once per view: an unavailable answer shows its message now and hides the button the next time the screen is shown.
  const [canShare] = useState(() => !isShareKnownUnavailable());
  const runningKeyRef = useRef<string | null>(null);

  const composition = useMemo(() => (input ? buildShareComposition(input) : null), [input]);
  const logoNode = composition?.nodes.find((node) => node.kind === 'logo');
  const logoKey = logoNode && logoNode.kind === 'logo' ? logoNode.uri : null;

  const [logoGate] = useState(() => createLogoGate(LOGO_WAIT_MS));
  useEffect(() => {
    // No logo: settled. A logo: re-armed until it loads or fails (or the wait gives up).
    logoGate.reset(logoKey);
  }, [logoGate, logoKey]);
  const onLogoSettled = useCallback(() => logoGate.settle(), [logoGate]);

  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const share = useCallback(async () => {
    const startKey = shareSubjectKey(inputRef.current);
    if (!inputRef.current || startKey === null || runningKeyRef.current === startKey) return;
    runningKeyRef.current = startKey;
    setEntry({ key: startKey, status: 'sharing' });
    try {
      const dialogTitle = inputRef.current.t('engage.share.dialogTitle');
      const anchor = await measureAnchor(buttonRef.current);
      const deps: ShareFlowDeps = {
        isAvailable: () => Sharing.isAvailableAsync(),
        logoReady: () => logoGate.ready(),
        capture: async () => {
          await nextFrames();
          const node = captureViewRef.current;
          if (!node) throw new Error('share-image-not-mounted');
          return captureRef(node, { format: 'png', result: 'base64', quality: 1, ...captureSize(PixelRatio.get()) });
        },
        writeFile: async (base64) => {
          const file = new File(Paths.cache, shareFileName(Date.now()));
          file.create({ overwrite: true });
          file.write(base64, { encoding: 'base64' });
          return file.uri;
        },
        cleanLeftovers: async () => {
          for (const entry of Paths.cache.list()) {
            if (entry instanceof File && isShareFileName(entry.name)) entry.delete();
          }
        },
        deleteFile: async (uri) => {
          const file = new File(uri);
          if (file.exists) file.delete();
        },
        share: (uri) => Sharing.shareAsync(uri, buildShareOptions(dialogTitle, anchor)),
      };
      const outcome = await runShareFlow(deps);
      if (outcome.kind === 'unavailable') markShareUnavailable();
      setEntry({ key: startKey, status: shareStatusAfter(outcome) });
    } catch {
      setEntry({ key: startKey, status: 'error' });
    } finally {
      runningKeyRef.current = null;
    }
  }, [logoGate, setEntry]);

  return { composition, captureViewRef, onLogoSettled, buttonRef, status, canShare, share };
}
