import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

import { supabase } from '@/lib/supabase';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// A modern phone's camera sensor (30-100+MP) can produce an original whose
// JPEG quality alone can't bound file size under MAX_PHOTO_BYTES -- the
// `quality: 0.8` passed to the picker below only controls compression
// ratio, not pixel dimensions. Downscaling the longest edge to a size
// that's already ample for how these photos are actually displayed (a
// small avatar, a progress-photo thumbnail/lightbox -- never full-bleed)
// keeps file size bounded regardless of source resolution, instead of
// rejecting a legitimate high-res photo outright.
const MAX_PHOTO_DIMENSION = 1600;

// Bucket's allowed_mime_types (0019_member_onboarding_otp.sql) lists
// 'image/jpeg', never 'image/jpg' -- a bare extension-to-mime-type mapping
// would mislabel the most common real-world upload and get it rejected by
// Storage (Review finding, 2026-07-17).
const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export type PickPhotoResult =
  | { uri: string }
  | { error: 'permission_denied' | 'too_large' | 'read_failed' }
  | { canceled: true };

/** MA-05/MA-12 shared photo-picker logic (Story 2.8, Task 1), lifted
 * verbatim from onboarding/profile.tsx so both call sites share identical
 * permission/size-check behavior instead of drifting independently. */
export async function pickPhoto(source: 'camera' | 'library'): Promise<PickPhotoResult> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return { error: 'permission_denied' };
  }

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });

  if (result.canceled || !result.assets[0]) return { canceled: true };

  const asset = result.assets[0];

  // width/height are 0 when the system didn't report them -- in that case
  // longestEdge is 0, which never exceeds MAX_PHOTO_DIMENSION, so resizing
  // is safely skipped and the original falls through to the size check
  // below unchanged, same as before this fix.
  let uri = asset.uri;
  const longestEdge = Math.max(asset.width, asset.height);
  if (longestEdge > MAX_PHOTO_DIMENSION) {
    // Dynamic import + try/catch, deliberately not a static top-level
    // import: expo-image-manipulator is a native module, and this file is
    // transitively imported by nearly every screen (LogEntrySheet,
    // profile.tsx, onboarding/profile.tsx). A static import throws at
    // module-evaluation time if the native side isn't compiled into the
    // running binary yet (e.g. a dev client built before this dependency
    // was added) -- which would crash every one of those screens, not just
    // the photo picker. Falling back to the pre-resize behavior (skip
    // straight to the size check below) degrades gracefully instead.
    try {
      const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
      const isLandscape = asset.width >= asset.height;
      const context = ImageManipulator.manipulate(asset.uri).resize(
        isLandscape ? { width: MAX_PHOTO_DIMENSION } : { height: MAX_PHOTO_DIMENSION },
      );
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
      uri = saved.uri;
    } catch (err) {
      console.error('[photo-upload] resize failed, falling back to original', err);
    }
  }

  // Re-checked against the (possibly resized) `uri`, not the picker's own
  // stale `asset.fileSize`, which still reflects the pre-resize original.
  // Review finding: `new File(uri)` (expo-file-system) can throw for a
  // picked-but-unreadable URI -- unguarded, this was an unhandled rejection
  // at all 3 call sites, with no error ever shown to the user.
  let fileSize: number;
  try {
    fileSize = new File(uri).size ?? 0;
  } catch (err) {
    console.error('[photo-upload] file size check failed', err);
    return { error: 'read_failed' };
  }
  if (fileSize > MAX_PHOTO_BYTES) {
    return { error: 'too_large' };
  }
  return { uri };
}

/** Uploads to the member-photos bucket at {user_id}/photo.{ext} with
 * upsert: true (0019_member_onboarding_otp.sql) -- same bucket, same path
 * convention both call sites must share byte-for-byte. */
export async function uploadPhoto(userId: string, uri: string): Promise<string | null> {
  const extensionMatch = /\.(\w+)$/.exec(uri);
  const extension = (extensionMatch?.[1] ?? 'jpg').toLowerCase();
  const contentType = EXTENSION_TO_MIME[extension] ?? 'image/jpeg';
  const path = `${userId}/photo.${extension}`;

  // fetch(uri) against a local file:// or content:// URI is unreliable on
  // Android -- it can resolve without throwing while returning a near-empty
  // body, silently uploading a corrupt file (found via physical-device
  // testing, 2026-07-18). expo-file-system's File.arrayBuffer() reads the
  // actual bytes directly from the filesystem instead.
  const arrayBuffer = await new File(uri).arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from('member-photos')
    .upload(path, arrayBuffer, { contentType, upsert: true });

  if (uploadError) return null;

  const { data } = supabase.storage.from('member-photos').getPublicUrl(path);
  return data.publicUrl;
}

/** Story 10.1: uploads to the private progress-photos bucket at
 * {auth.uid()}/{clientEntryId}.{ext} -- ties each photo to the offline-safe
 * client-generated ID so a retried upload after a sync failure overwrites
 * (upsert: true) rather than orphaning a duplicate file. Same
 * File(uri).arrayBuffer() pattern as uploadPhoto() above (Android
 * fetch(uri) unreliability). Returns the object path itself, never a public
 * URL -- the bucket is private (public: false), so getPublicUrl would
 * return an unusable link. */
export async function uploadProgressPhoto(userId: string, clientEntryId: string, uri: string): Promise<string | null> {
  const extensionMatch = /\.(\w+)$/.exec(uri);
  const extension = (extensionMatch?.[1] ?? 'jpg').toLowerCase();
  const contentType = EXTENSION_TO_MIME[extension] ?? 'image/jpeg';
  const path = `${userId}/${clientEntryId}.${extension}`;

  const arrayBuffer = await new File(uri).arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from('progress-photos')
    .upload(path, arrayBuffer, { contentType, upsert: true });

  if (uploadError) return null;

  return path;
}

/** Resolves a short-lived signed URL for a progress photo at render time --
 * never persisted, since the bucket is private and photo_path is a
 * bucket-relative object path, not a URL. 1-hour TTL: the member viewing
 * their own photo has no revoke-sensitivity yet (Story 10.2 tightens this
 * once sharing exists). */
export async function getProgressPhotoSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('progress-photos').createSignedUrl(path, 3600);
  if (error || !data) return null;
  return data.signedUrl;
}

/** The Alert-as-action-sheet pattern (Take Photo / Choose from Library /
 * Cancel) -- `onPick` receives the chosen source; callers run `pickPhoto`
 * themselves so error-state handling (which i18n key, which local state)
 * stays screen-specific. */
export function openPhotoPicker(onPick: (source: 'camera' | 'library') => void, t: (key: string) => string) {
  Alert.alert(t('onboarding.profile.addPhoto'), undefined, [
    { text: t('onboarding.profile.photoSourceTakePhoto'), onPress: () => onPick('camera') },
    { text: t('onboarding.profile.photoSourceChooseFromLibrary'), onPress: () => onPick('library') },
    { text: t('common.close'), style: 'cancel' },
  ]);
}
