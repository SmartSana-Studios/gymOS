/** Story 31.3 (FR-231; AD-60; MA-20 "Share flow"): the share flow as one function over injected dependencies, so a test can fail every step. The image
 * is made on the device from local data and handed to the OS share sheet: no server, table, bucket or analytics event records it, and the flow asks
 * for no photo-library or storage permission (it writes only to the app's own cache directory and offers no save-to-gallery action).
 *
 * Result states (MA-20 step 4):
 *   - the sheet closed, with or without a target (the OS reports no difference): `done`, nothing is shown;
 *   - the image could not be made, written, or handed over: `error` (the screen shows `engage.share.error` with [Try again]);
 *   - sharing is not available on this phone: `unavailable` (the screen shows `engage.share.unavailable`; the button is gone the next time it is shown).
 * The temporary file is deleted after the sheet closes and on every failure, and any older leftover in the cache directory is removed first, so no
 * image of the member persists on the device. Building and sharing the image needs no network: a logo that cannot be loaded is simply left out. */

export interface ShareFlowDeps {
  /** `Sharing.isAvailableAsync()`. A rejection counts as unavailable. */
  isAvailable: () => Promise<boolean>;
  /** Resolves when the logo (if any) has loaded or failed to; may reject (no network): the image is then made without it. */
  logoReady: () => Promise<void>;
  /** Captures the composition at 1080 by 1920 px and returns the PNG as base64. */
  capture: () => Promise<string>;
  /** Writes the PNG into the app's cache directory and returns its URI. */
  writeFile: (base64: string) => Promise<string>;
  /** Removes older share images left in the cache directory. */
  cleanLeftovers: () => Promise<void>;
  /** Deletes one file. */
  deleteFile: (uri: string) => Promise<void>;
  /** Opens the OS share sheet for the file; resolves when it closes. */
  share: (uri: string) => Promise<void>;
}

export type ShareOutcome = { kind: 'done' } | { kind: 'error' } | { kind: 'unavailable' };

/** The prefix of every share image the app writes, so leftovers can be found and nothing else in the cache is touched. */
export const SHARE_FILE_PREFIX = 'gymos-share-';

export function shareFileName(nowMs: number): string {
  return `${SHARE_FILE_PREFIX}${Math.trunc(nowMs)}.png`;
}

export function isShareFileName(name: string): boolean {
  return name.startsWith(SHARE_FILE_PREFIX) && name.endsWith('.png');
}

async function quietly(step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch {
    // Best effort: cleaning up never changes the outcome the member sees.
  }
}

/** Runs the flow once. Never throws. */
export async function runShareFlow(deps: ShareFlowDeps): Promise<ShareOutcome> {
  let available = false;
  try {
    available = await deps.isAvailable();
  } catch {
    available = false;
  }
  if (!available) return { kind: 'unavailable' };

  await quietly(() => deps.cleanLeftovers());
  // A logo that cannot load (offline, a bad URL) is left out without an error.
  await quietly(() => deps.logoReady());

  let uri: string | null = null;
  try {
    const base64 = await deps.capture();
    uri = await deps.writeFile(base64);
    await deps.share(uri);
    return { kind: 'done' };
  } catch {
    return { kind: 'error' };
  } finally {
    if (uri) {
      const written = uri;
      await quietly(() => deps.deleteFile(written));
    } else {
      // A write that failed half way may have left a partial file: the same sweep that runs before the next share runs now.
      await quietly(() => deps.cleanLeftovers());
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// "Hidden on the next view": once the OS says sharing is unavailable, every later view of a screen that offers Share starts without the button.
// In memory for the app session: the answer is a property of the phone and the app build, and is asked again at the next launch.
// ---------------------------------------------------------------------------------------------------------------------------------------------

let knownUnavailable = false;

export function markShareUnavailable(): void {
  knownUnavailable = true;
}

export function isShareKnownUnavailable(): boolean {
  return knownUnavailable;
}

/** For tests. */
export function resetShareAvailability(): void {
  knownUnavailable = false;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// What the screens show (pure, so a test can run it: there is no renderer)
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type ShareStatus = 'idle' | 'sharing' | 'error' | 'unavailable';

/** The status after a run: `done` clears everything (no toast, no message: the OS shows its own), a failure shows its message. */
export function shareStatusAfter(outcome: ShareOutcome): ShareStatus {
  return outcome.kind === 'done' ? 'idle' : outcome.kind;
}

/** The catalog key of the inline message above the buttons, or null. */
export function shareMessageKey(status: ShareStatus): string | null {
  if (status === 'error') return 'engage.share.error';
  if (status === 'unavailable') return 'engage.share.unavailable';
  return null;
}

/** [Try again] is offered for a failure to make the image, not for an unavailable share sheet (nothing a retry can change). */
export function shareRetryKey(status: ShareStatus): string | null {
  return status === 'error' ? 'engage.share.retry' : null;
}
