import * as Sentry from '@sentry/react-native';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

/** Records where the photo flow got to, so a WatchdogTermination arrives in
 * Sentry with the last completed step attached. A watchdog kill produces no JS
 * stack and no catchable error -- without breadcrumbs the report cannot say
 * which call never returned, which is exactly what made this bug expensive to
 * chase. Never throws: instrumentation must not be able to break the flow it
 * measures, and Sentry may not be initialised at all (no DSN in local dev). */
function breadcrumb(message: string) {
  try {
    Sentry.addBreadcrumb({ category: 'photo-upload', message, level: 'info' });
  } catch {
    // deliberately ignored -- see above
  }
}

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// A modern phone's camera sensor (30-100+MP) can produce an original whose
// JPEG compression ratio alone can't bound file size under MAX_PHOTO_BYTES --
// compression quality does not change pixel dimensions. Downscaling the
// longest edge to a size that's already ample for how these photos are
// actually displayed (a small avatar, a progress-photo thumbnail/lightbox --
// never full-bleed) keeps file size bounded regardless of source resolution,
// instead of rejecting a legitimate high-res photo outright. It is also the
// only place compression happens now: the picker is no longer asked to
// re-encode (see pickPhoto), so this save is the single encode in the path.
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
  breadcrumb(`requesting ${source} permission`);
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return { error: 'permission_denied' };
  }

  breadcrumb(`permission granted (${source})`);

  // Neither `quality` nor `preferredAssetRepresentationMode` is passed, and
  // both omissions are deliberate memory decisions on a device that has been
  // reporting WatchdogTermination -- the OS killing the app for hanging or
  // overusing RAM.
  //
  // `quality` < 1 makes the picker decode the original at full sensor
  // resolution and re-encode it (a ~190MB bitmap for a 48MP photo), which the
  // resize below then decodes a second time and discards.
  //
  // `preferredAssetRepresentationMode: Compatible` was added earlier the same
  // day to guarantee a non-HEIC asset, and is removed again here: Compatible
  // asks iOS to *transcode* the asset in-process, at full resolution, before
  // handing it over -- precisely the kind of work that gets an app watchdogged.
  // JPEG output is now guaranteed the cheap way instead: the manipulator below
  // always runs and always saves as JPEG, so the picker is never relied on to
  // convert anything.
  const pickerOptions: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'] };

  breadcrumb(`launching picker (${source})`);
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(pickerOptions)
      : await ImagePicker.launchImageLibraryAsync(pickerOptions);
  breadcrumb(`picker returned (canceled=${result.canceled})`);

  if (result.canceled || !result.assets[0]) return { canceled: true };

  const asset = result.assets[0];

  // width/height are 0 when the system didn't report them. That case used to
  // skip resizing entirely, described as "safely skipped" -- safe for the
  // *size check* below, which still ran, but not for memory: an unreported
  // full-resolution original went on to be read whole into a JS ArrayBuffer by
  // uploadPhoto(). Unknown dimensions now take the resize path too, since
  // bounding an image that might already be small costs far less than not
  // bounding one that isn't.
  let uri = asset.uri;
  const longestEdge = Math.max(asset.width, asset.height);
  const dimensionsUnknown = longestEdge === 0;
  const needsDownscale = longestEdge > MAX_PHOTO_DIMENSION || dimensionsUnknown;
  breadcrumb(`asset ${asset.width}x${asset.height}`);
  // This block now runs unconditionally, where it used to be gated on
  // needsDownscale. Since the picker is no longer asked to transcode (see
  // above), this save is the only thing guaranteeing the file is a JPEG -- and
  // an .heic reaching uploadPhoto() would be mislabelled by EXTENSION_TO_MIME
  // and rejected by the member-photos bucket's allowed_mime_types. The resize
  // itself is still conditional: applying it to an already-small image would
  // upscale it.
  {
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
      // With dimensions unknown we cannot tell portrait from landscape, so
      // constrain the width: that bounds the longest edge for a landscape
      // source and still meaningfully bounds a portrait one, without needing
      // an orientation we do not have.
      const isLandscape = asset.width >= asset.height;
      breadcrumb(`manipulate start (downscale=${needsDownscale})`);
      let context = ImageManipulator.manipulate(asset.uri);
      if (needsDownscale) {
        context = context.resize(
          dimensionsUnknown || isLandscape ? { width: MAX_PHOTO_DIMENSION } : { height: MAX_PHOTO_DIMENSION },
        );
      }
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
      uri = saved.uri;
      breadcrumb('manipulate done');
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
    breadcrumb(`size ${fileSize}`);
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

/** Source chooser (Take Photo / Choose from Library / Cancel) -- `onPick`
 * receives the chosen source; callers run `pickPhoto` themselves so
 * error-state handling (which i18n key, which local state) stays
 * screen-specific.
 *
 * iOS uses ActionSheetIOS rather than Alert, and that is a bug fix, not a
 * cosmetic preference. On iOS `Alert.alert` is a UIAlertController, and its
 * button handler fires while that alert is still running its dismissal
 * transition. Presenting the image picker from inside that handler means
 * asking UIKit to present a view controller from one that is mid-transition,
 * which iOS does not do promptly -- on device this showed up as tapping
 * either option and then waiting minutes for the picker to appear, sometimes
 * taking the app down with it. It reproduced on both Take Photo and Choose
 * from Library and not at all on Android, which is the signature of a
 * presentation problem rather than anything to do with the image itself:
 * Android's Alert is a Dialog and has no equivalent constraint.
 *
 * ActionSheetIOS invokes its callback from the sheet's own completion
 * handler, i.e. after dismissal has finished, so the picker is presented
 * from a settled view controller. Android keeps Alert, which works correctly
 * there and matches the platform's own convention. */
export function openPhotoPicker(onPick: (source: 'camera' | 'library') => void, t: (key: string) => string) {
  const takePhoto = t('onboarding.profile.photoSourceTakePhoto');
  const chooseFromLibrary = t('onboarding.profile.photoSourceChooseFromLibrary');
  const cancel = t('common.close');

  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: t('onboarding.profile.addPhoto'),
        options: [takePhoto, chooseFromLibrary, cancel],
        cancelButtonIndex: 2,
      },
      (buttonIndex) => {
        if (buttonIndex === 0) onPick('camera');
        else if (buttonIndex === 1) onPick('library');
      },
    );
    return;
  }

  Alert.alert(t('onboarding.profile.addPhoto'), undefined, [
    { text: takePhoto, onPress: () => onPick('camera') },
    { text: chooseFromLibrary, onPress: () => onPick('library') },
    { text: cancel, style: 'cancel' },
  ]);
}
