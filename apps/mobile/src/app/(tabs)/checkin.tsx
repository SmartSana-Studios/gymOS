import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Animated, AppState, Linking, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/brand';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useOfflineSync } from '@/lib/offline-sync-context';
import { recordCheckIn, validateGymToken } from '@/services/checkin';

// MA-10's own "scanning timeout" nudge (EXPERIENCE.md) -- purely
// informational, the viewfinder keeps scanning regardless.
const NUDGE_DELAY_MS = 15000;
// Brief acknowledgement for a *valid* scan (MA-10's "QR detected" flash),
// shown before the Success overlay takes over.
const FLASH_DURATION_MS = 300;
// Gentle idle pulse on the scan-target corner brackets (MA-10).
const PULSE_DURATION_MS = 900;
// MA-10's Success overlay auto-dismisses back to scanning after 2.5s.
const SUCCESS_AUTO_DISMISS_MS = 2500;

// Date-only formatting precedent: onboarding/plan.tsx's formatDateOnly
// builds a per-file-local, locale-aware string rather than adding a shared
// date-utils module -- this follows the same convention for a time string.
function formatCheckInTime(isoString: string, locale: string): string {
  return new Date(isoString).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/** MA-10. Story 3.3 built the camera shell and the Wrong QR result state;
 * Story 3.4 added the Success and Already Checked In states by recording a
 * real attendance event via recordCheckIn(). Story 3.8 adds the Denied -
 * Expired state (subscription-status branching, 0027's check_in() guard).
 * Story 3.9 adds the Success - Offline state (offline queueing, Scope Notes
 * #2/#4/#5). */
export default function CheckInScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const { isConnected, queueOfflineCheckIn } = useOfflineSync();

  const [wrongQr, setWrongQr] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const [alreadyCheckedIn, setAlreadyCheckedIn] = useState(false);
  const [deniedExpired, setDeniedExpired] = useState(false);
  const [success, setSuccess] = useState(false);
  const [successOffline, setSuccessOffline] = useState(false);
  const [successCheckedInAt, setSuccessCheckedInAt] = useState<string | null>(null);
  const [showNudge, setShowNudge] = useState(false);
  const [flash, setFlash] = useState(false);
  const [validating, setValidating] = useState(false);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);
  const isFocusedRef = useRef(isFocused);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);

  // The Denied - Expired overlay's own button deliberately does NOT call
  // resetScanning() -- it navigates to Home instead, without inviting an
  // immediate rescan (Scope Note #2/#4). Nothing else ever clears
  // deniedExpired, so without this, returning to this tab later (e.g. after
  // renewing at the front desk) would show the same frozen red overlay
  // forever. Only fires on an actual focus transition, not on every
  // deniedExpired change, so it never clears the overlay out from under the
  // member while it's still being shown.
  useEffect(() => {
    if (isFocused) {
      setDeniedExpired(false);
    }
  }, [isFocused]);

  useEffect(() => {
    return () => {
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (permission && permission.status === 'undetermined' && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  // Re-check permission when the app resumes -- covers "granted it in OS
  // Settings, then tapped back into GymOS," which the mount-time effect
  // above never revisits once status has settled to 'denied'.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && permission && !permission.granted) {
        void requestPermission();
      }
    });
    return () => subscription.remove();
  }, [permission, requestPermission]);

  const resultShowing = wrongQr || networkError || alreadyCheckedIn || deniedExpired || success;

  // 15s-with-no-scan nudge -- only counts down while actively scanning
  // (focused tab, permission granted, no result showing).
  useEffect(() => {
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    setShowNudge(false);
    if (!isFocused || resultShowing || !permission?.granted) return;
    nudgeTimerRef.current = setTimeout(() => setShowNudge(true), NUDGE_DELAY_MS);
    return () => {
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    };
  }, [isFocused, resultShowing, permission?.granted]);

  // Gentle pulsing idle animation on the scan-target corner brackets while
  // actively scanning (MA-10) -- paused during a result overlay or the
  // brief match flash.
  useEffect(() => {
    if (!isFocused || resultShowing || !permission?.granted) {
      pulseAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: PULSE_DURATION_MS, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: PULSE_DURATION_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulseAnim.setValue(1);
    };
  }, [isFocused, resultShowing, permission?.granted, pulseAnim]);

  const resetScanning = useCallback(() => {
    setWrongQr(false);
    setNetworkError(false);
    setAlreadyCheckedIn(false);
    setDeniedExpired(false);
    setSuccess(false);
    setSuccessOffline(false);
    setSuccessCheckedInAt(null);
    processingRef.current = false;
  }, []);

  // Shared by the online and offline success paths -- same
  // FLASH_DURATION_MS/SUCCESS_AUTO_DISMISS_MS timers, same
  // mountedRef/isFocusedRef guards (MA-10).
  const showSuccessOverlay = useCallback((checkedInAt: string | null, offline: boolean) => {
    setFlash(true);
    flashTimerRef.current = setTimeout(() => {
      if (!mountedRef.current || !isFocusedRef.current) {
        processingRef.current = false;
        return;
      }
      setFlash(false);
      setSuccessCheckedInAt(checkedInAt);
      setSuccessOffline(offline);
      setSuccess(true);
      successTimerRef.current = setTimeout(() => {
        if (!mountedRef.current || !isFocusedRef.current) {
          processingRef.current = false;
          return;
        }
        setSuccess(false);
        processingRef.current = false;
      }, SUCCESS_AUTO_DISMISS_MS);
    }, FLASH_DURATION_MS);
  }, []);

  // Story 3.9 AC #1: no QR-token comparison, no recordCheckIn() call -- both
  // are impossible offline anyway (Scope Note #5). Queues the scan locally
  // and shows the same flash -> success sequence as the online path.
  const handleOfflineScan = useCallback(async () => {
    try {
      const { scannedAt } = await queueOfflineCheckIn();

      if (!mountedRef.current || !isFocusedRef.current) {
        processingRef.current = false;
        return;
      }

      setValidating(false);
      showSuccessOverlay(scannedAt, true);
    } catch {
      if (!mountedRef.current || !isFocusedRef.current) {
        processingRef.current = false;
        return;
      }
      setValidating(false);
      setNetworkError(true);
    }
  }, [queueOfflineCheckIn, showSuccessOverlay]);

  async function handleBarcodeScanned(result: BarcodeScanningResult) {
    // Guards against expo-camera re-firing onBarcodeScanned repeatedly for
    // the same still-in-frame code -- the SDK gives no built-in debounce.
    if (processingRef.current) return;
    processingRef.current = true;
    setValidating(true);

    if (!isConnected) {
      await handleOfflineScan();
      return;
    }

    const { matched, error } = await validateGymToken(result.data);

    // The user may have left and returned to this tab while the request
    // was in flight -- don't surface a result for a scan they've already
    // abandoned, and reset processing so a fresh scan on return isn't
    // silently ignored.
    if (!mountedRef.current || !isFocusedRef.current) {
      processingRef.current = false;
      return;
    }

    if (error) {
      // The connectivity flag may not have caught up yet by the time this
      // request failed -- fall through to the offline path rather than
      // showing the generic network-error overlay.
      if (!isConnected) {
        await handleOfflineScan();
        return;
      }
      setValidating(false);
      setNetworkError(true);
      return;
    }
    if (!matched) {
      setValidating(false);
      setWrongQr(true);
      return;
    }

    // Token match: record the actual attendance event (Story 3.4). Same
    // mountedRef/isFocusedRef guard applied around this second await --
    // the user may leave the tab again during the RPC round-trip.
    const checkInResult = await recordCheckIn();

    if (!mountedRef.current || !isFocusedRef.current) {
      setValidating(false);
      processingRef.current = false;
      return;
    }

    if (checkInResult.status === 'error') {
      if (!isConnected) {
        await handleOfflineScan();
        return;
      }
      setValidating(false);
      setNetworkError(true);
      return;
    }

    setValidating(false);

    if (checkInResult.status === 'already_checked_in') {
      setAlreadyCheckedIn(true);
      return;
    }

    if (checkInResult.status === 'expired') {
      setDeniedExpired(true);
      return;
    }

    // Success: the existing "QR detected" flash first, then the Success
    // overlay, which auto-dismisses back to scanning on its own (MA-10).
    showSuccessOverlay(checkInResult.checkedInAt ?? null, false);
  }

  function handleClose() {
    router.navigate('/');
  }

  function handleOpenSettings() {
    void Linking.openSettings();
  }

  const permissionPending = !permission || permission.status === 'undetermined';
  const permissionDenied = !permissionPending && !permission.granted;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <ThemedText type="subtitle">{t('checkin.title')}</ThemedText>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={handleClose}>
            <ThemedText type="subtitle">✕</ThemedText>
          </Pressable>
        </View>

        {/* Body is its own positioning container so the result overlay below
            stretches only across this area, not the header -- keeping the
            close button reachable while an overlay is showing. */}
        <View style={styles.body}>
          {permissionPending ? (
            <View style={styles.centeredContent}>
              <ActivityIndicator color={Brand.primary} />
            </View>
          ) : permissionDenied ? (
            <View style={styles.centeredContent}>
              <ThemedText style={styles.lockIcon}>🔒</ThemedText>
              <ThemedText type="subtitle" style={styles.centeredText}>
                {t('checkin.permissionDeniedTitle')}
              </ThemedText>
              <ThemedText type="default" themeColor="textSecondary" style={styles.centeredText}>
                {t('checkin.permissionDeniedBody')}
              </ThemedText>
              <Pressable accessibilityRole="button" onPress={handleOpenSettings} style={styles.primaryButton}>
                <ThemedText style={styles.primaryButtonLabel}>{t('checkin.openSettings')}</ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.cameraContainer}>
              {isFocused && (
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={resultShowing ? undefined : handleBarcodeScanned}
                />
              )}
              <Animated.View style={[styles.scanTarget, { opacity: flash ? 1 : pulseAnim }]} pointerEvents="none">
                <View style={[styles.corner, styles.cornerTopLeft, flash && styles.cornerFlash]} />
                <View style={[styles.corner, styles.cornerTopRight, flash && styles.cornerFlash]} />
                <View style={[styles.corner, styles.cornerBottomLeft, flash && styles.cornerFlash]} />
                <View style={[styles.corner, styles.cornerBottomRight, flash && styles.cornerFlash]} />
              </Animated.View>
              {validating && <ActivityIndicator color="#ffffff" style={styles.validatingIndicator} />}
              <ThemedText type="small" style={[styles.instruction, { paddingBottom: BottomTabInset + Spacing.three }]}>
                {t(showNudge ? 'checkin.scanningTrouble' : 'checkin.instruction')}
              </ThemedText>
            </View>
          )}

          {success && (
            <View style={[styles.overlay, styles.overlaySuccess]}>
              <ThemedText style={styles.overlayIcon}>✓</ThemedText>
              <ThemedText type="subtitle" style={styles.centeredText}>
                {t('checkin.checkedIn')}
              </ThemedText>
              {successCheckedInAt && (
                <ThemedText type="default" style={styles.centeredText}>
                  {successOffline
                    ? t('checkin.checkedInSyncing', { time: formatCheckInTime(successCheckedInAt, i18n.language) })
                    : formatCheckInTime(successCheckedInAt, i18n.language)}
                </ThemedText>
              )}
            </View>
          )}

          {alreadyCheckedIn && (
            <View style={styles.overlay}>
              <ThemedText style={styles.overlayIcon}>⚠</ThemedText>
              <ThemedText type="subtitle" style={styles.centeredText}>
                {t('checkin.alreadyCheckedInTitle')}
              </ThemedText>
              <ThemedText type="default" style={styles.centeredText}>
                {t('checkin.alreadyCheckedInBody')}
              </ThemedText>
              <Pressable accessibilityRole="button" onPress={resetScanning} style={styles.overlayButton}>
                <ThemedText style={styles.overlayButtonLabel}>{t('common.ok')}</ThemedText>
              </Pressable>
            </View>
          )}

          {deniedExpired && (
            <View style={[styles.overlay, styles.overlayDenied]}>
              <ThemedText style={styles.overlayIcon}>✕</ThemedText>
              <ThemedText type="subtitle" style={styles.centeredText}>
                {t('checkin.deniedExpiredTitle')}
              </ThemedText>
              <ThemedText type="default" style={styles.centeredText}>
                {t('checkin.deniedExpiredBody')}
              </ThemedText>
              <Pressable accessibilityRole="button" onPress={handleClose} style={styles.overlayButton}>
                <ThemedText style={styles.overlayButtonLabel}>{t('checkin.seeFrontDesk')}</ThemedText>
              </Pressable>
            </View>
          )}

          {(wrongQr || networkError) && (
            <View style={styles.overlay}>
              <ThemedText style={styles.overlayIcon}>⚠</ThemedText>
              {wrongQr ? (
                <>
                  <ThemedText type="subtitle" style={styles.centeredText}>
                    {t('checkin.wrongQrTitle')}
                  </ThemedText>
                  <ThemedText type="default" style={styles.centeredText}>
                    {t('checkin.wrongQrBody')}
                  </ThemedText>
                </>
              ) : (
                <ThemedText type="default" style={styles.centeredText}>
                  {t('checkin.errorNetwork')}
                </ThemedText>
              )}
              <Pressable accessibilityRole="button" onPress={resetScanning} style={styles.overlayButton}>
                <ThemedText style={styles.overlayButtonLabel}>{t('common.tryAgain')}</ThemedText>
              </Pressable>
            </View>
          )}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const SCAN_TARGET_SIZE = 220;
const CORNER_SIZE = 32;
const CORNER_BORDER_WIDTH = 3;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  body: {
    flex: 1,
  },
  cameraContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  scanTarget: {
    width: SCAN_TARGET_SIZE,
    height: SCAN_TARGET_SIZE,
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: '#ffffff',
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_BORDER_WIDTH,
    borderLeftWidth: CORNER_BORDER_WIDTH,
    borderTopLeftRadius: Spacing.three,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_BORDER_WIDTH,
    borderRightWidth: CORNER_BORDER_WIDTH,
    borderTopRightRadius: Spacing.three,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_BORDER_WIDTH,
    borderLeftWidth: CORNER_BORDER_WIDTH,
    borderBottomLeftRadius: Spacing.three,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_BORDER_WIDTH,
    borderRightWidth: CORNER_BORDER_WIDTH,
    borderBottomRightRadius: Spacing.three,
  },
  cornerFlash: {
    borderColor: '#3BB273',
  },
  validatingIndicator: {
    marginTop: Spacing.three,
  },
  instruction: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#ffffff',
  },
  centeredContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
    gap: Spacing.two,
  },
  centeredText: {
    textAlign: 'center',
  },
  lockIcon: {
    fontSize: 40,
  },
  primaryButton: {
    marginTop: Spacing.three,
    backgroundColor: Brand.primary,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    alignItems: 'center',
  },
  primaryButtonLabel: {
    color: '#ffffff',
    fontWeight: '600',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.five,
    backgroundColor: '#B8860B',
  },
  overlaySuccess: {
    backgroundColor: '#3BB273',
  },
  overlayDenied: {
    backgroundColor: '#B3261E',
  },
  overlayIcon: {
    fontSize: 48,
  },
  overlayButton: {
    marginTop: Spacing.three,
    backgroundColor: '#ffffff',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    alignItems: 'center',
  },
  overlayButtonLabel: {
    color: Brand.primary,
    fontWeight: '600',
  },
});
