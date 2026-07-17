import { profileSetupSchema } from '@gymos/types';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

const TOTAL_STEPS = 4;
const CURRENT_STEP = 1;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

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

/** MA-05. Writes users.display_name / users.photo_url -- never
 * members.name / members.photo_url (Story 2.6 Scope Note #2: those stay
 * admin-controlled gym-roster fields). Photo pick uses a native Alert as
 * the "action sheet" (Take Photo | Choose from Library | Cancel) -- a
 * simplification versus a true bottom-sheet component, no extra dependency
 * needed for it. */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [name, setName] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function openPhotoPicker() {
    Alert.alert(t('onboarding.profile.addPhoto'), undefined, [
      { text: t('onboarding.profile.photoSourceTakePhoto'), onPress: () => pickPhoto('camera') },
      { text: t('onboarding.profile.photoSourceChooseFromLibrary'), onPress: () => pickPhoto('library') },
      { text: t('common.close'), style: 'cancel' },
    ]);
  }

  async function pickPhoto(source: 'camera' | 'library') {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(t('onboarding.profile.errorPhotoPermissionDenied'));
      return;
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > MAX_PHOTO_BYTES) {
      setError(t('onboarding.profile.errorPhotoTooLarge'));
      return;
    }
    setError(null);
    setPhotoUri(asset.uri);
  }

  async function uploadPhoto(userId: string, uri: string): Promise<string | null> {
    const extensionMatch = /\.(\w+)$/.exec(uri);
    const extension = (extensionMatch?.[1] ?? 'jpg').toLowerCase();
    const contentType = EXTENSION_TO_MIME[extension] ?? 'image/jpeg';
    const path = `${userId}/photo.${extension}`;

    const response = await fetch(uri);
    const arrayBuffer = await response.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from('member-photos')
      .upload(path, arrayBuffer, { contentType, upsert: true });

    if (uploadError) return null;

    const { data } = supabase.storage.from('member-photos').getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleContinue() {
    const trimmedName = name.trim();
    if (trimmedName.length > 100) {
      setError(t('onboarding.profile.errorNameTooLong'));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        setError(t('onboarding.profile.errorSaveFailed'));
        return;
      }

      let photoUrl: string | null = null;
      if (photoUri) {
        photoUrl = await uploadPhoto(userId, photoUri);
        if (!photoUrl) {
          setError(t('onboarding.profile.errorPhotoUploadFailed'));
          return;
        }
      }

      // Validates the real payload about to be written -- previously ran
      // against a hardcoded `photoUrl: null`, so the schema's photoUrl
      // checks never validated anything real (Review finding, 2026-07-17).
      const parsed = profileSetupSchema.safeParse({ displayName: trimmedName, photoUrl });
      if (!parsed.success) {
        setError(t('onboarding.profile.errorSaveFailed'));
        return;
      }

      const { error: updateError } = await supabase
        .from('users')
        .update({ display_name: parsed.data.displayName, photo_url: parsed.data.photoUrl ?? null })
        .eq('id', userId);

      if (updateError) {
        setError(t('onboarding.profile.errorSaveFailed'));
        return;
      }

      router.replace('/onboarding/goal');
    } catch {
      setError(t('onboarding.profile.errorSaveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  const canContinue = name.trim().length > 0 && !submitting;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={() => router.back()}
          style={styles.backButton}>
          <ThemedText type="default">←</ThemedText>
        </Pressable>

        <ThemedText type="small">
          {t('onboarding.profile.stepIndicator', { step: CURRENT_STEP })}
        </ThemedText>
        <View style={styles.progressTrack}>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <View key={i} style={[styles.progressSegment, i < CURRENT_STEP && styles.progressSegmentFilled]} />
          ))}
        </View>

        <ThemedText type="subtitle">{t('onboarding.profile.title')}</ThemedText>

        <Pressable accessibilityRole="button" onPress={openPhotoPicker} style={styles.photoCircle}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photoImage} />
          ) : (
            <ThemedText type="small" style={styles.photoPlaceholderText}>
              {t('onboarding.profile.addPhoto')}
            </ThemedText>
          )}
        </Pressable>
        {photoUri && (
          <Pressable onPress={() => setPhotoUri(null)}>
            <ThemedText type="link">{t('onboarding.profile.removePhoto')}</ThemedText>
          </Pressable>
        )}

        <ThemedText type="small">{t('onboarding.profile.nameLabel')}</ThemedText>
        <TextInput
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          style={styles.nameInput}
        />

        {error && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}

        <Pressable
          accessibilityRole="button"
          disabled={!canContinue}
          onPress={handleContinue}
          style={[styles.continueButton, !canContinue && styles.continueButtonDisabled]}>
          {submitting ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.continueLabel}>{t('common.continue')}</ThemedText>}
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Brand.background,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  backButton: {
    paddingVertical: Spacing.two,
  },
  progressTrack: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E0E1E6',
  },
  progressSegmentFilled: {
    backgroundColor: Brand.accent,
  },
  photoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#E0E1E6',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    overflow: 'hidden',
  },
  photoImage: {
    width: 80,
    height: 80,
  },
  photoPlaceholderText: {
    textAlign: 'center',
    paddingHorizontal: Spacing.one,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: Brand.primary,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  error: {
    color: '#B3261E',
  },
  continueButton: {
    marginTop: Spacing.three,
    backgroundColor: Brand.primary,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  continueButtonDisabled: {
    opacity: 0.5,
  },
  continueLabel: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
