import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

import { supabase } from '@/lib/supabase';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

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
  | { error: 'permission_denied' | 'too_large' }
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
  if (asset.fileSize && asset.fileSize > MAX_PHOTO_BYTES) {
    return { error: 'too_large' };
  }
  return { uri: asset.uri };
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
