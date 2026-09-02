import { profileSetupSchema } from '@gymos/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { ProgressSteps } from '@/components/ui/ProgressSteps';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { openPhotoPicker, pickPhoto, uploadPhoto } from '@/lib/photo-upload';
import { supabase } from '@/lib/supabase';

const TOTAL_STEPS = 4;
const CURRENT_STEP = 1;

/** MA-05. Writes users.display_name / users.photo_url -- never
 * members.name / members.photo_url (Story 2.6 Scope Note #2: those stay
 * admin-controlled gym-roster fields). Photo pick uses a native Alert as
 * the "action sheet" (Take Photo | Choose from Library | Cancel) -- a
 * simplification versus a true bottom-sheet component, no extra dependency
 * needed for it. */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const [name, setName] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleOpenPhotoPicker() {
    openPhotoPicker(handlePickPhoto, t);
  }

  async function handlePickPhoto(source: 'camera' | 'library') {
    const result = await pickPhoto(source);
    if ('error' in result) {
      if (result.error === 'permission_denied') {
        setError(t('onboarding.profile.errorPhotoPermissionDenied'));
      } else if (result.error === 'too_large') {
        setError(t('onboarding.profile.errorPhotoTooLarge'));
      } else {
        setError(t('onboarding.profile.errorPhotoUploadFailed'));
      }
      return;
    }
    if ('canceled' in result) return;
    setError(null);
    setPhotoUri(result.uri);
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
        <ProgressSteps totalSteps={TOTAL_STEPS} currentStep={CURRENT_STEP} />

        <ThemedText type="subtitle">{t('onboarding.profile.title')}</ThemedText>

        <Pressable
          accessibilityRole="button"
          onPress={handleOpenPhotoPicker}
          style={[styles.photoCircle, { backgroundColor: theme.surfaceElevated }]}>
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
          placeholderTextColor={theme.textSecondary}
          style={[styles.nameInput, { borderColor: theme.border, color: theme.text }]}
        />

        {error && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}

        <View style={styles.continueButton}>
          <Button label={t('common.continue')} disabled={!canContinue} loading={submitting} onPress={handleContinue} />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  backButton: {
    paddingVertical: Spacing.two,
  },
  photoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
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
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  error: {
    color: '#F87171',
  },
  continueButton: {
    marginTop: Spacing.three,
  },
});
