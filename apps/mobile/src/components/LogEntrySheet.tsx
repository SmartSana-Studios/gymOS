import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useOfflineSync } from '@/lib/offline-sync-context';
import { openPhotoPicker, pickPhoto } from '@/lib/photo-upload';
import { logProgressEntry, type ProgressEntryFields } from '@/services/progress';

type Theme = ReturnType<typeof useTheme>;

// Story 10.1 Scope Boundary: route-agnostic (props in, callback out) so
// Story 10.3 can mount this same component onto its new Progress screen
// without rework. No existing mobile screen in this codebase uses
// react-hook-form (every onboarding screen uses local useState + a Zod
// schema for validation only) -- this sheet follows that same established
// pattern rather than introducing a new form-library dependency this
// codebase has no other precedent for; flagged here as a deliberate choice,
// not an oversight of the story's own suggested alternative. Presented via
// React Native's built-in Modal (slide-up, pageSheet) -- no bottom-sheet
// library exists anywhere in this codebase either.

export interface LogEntrySheetProps {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function NumberField({
  label,
  value,
  onChangeText,
  theme,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  theme: Theme;
}) {
  return (
    <View style={styles.field}>
      <ThemedText type="small">{label}</ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { borderColor: theme.border, color: theme.text }]}
      />
    </View>
  );
}

export function LogEntrySheet({ visible, onClose, onSaved }: LogEntrySheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { isConnected, queueOfflineProgressEntry } = useOfflineSync();

  const [weightKg, setWeightKg] = useState('');
  const [waistCm, setWaistCm] = useState('');
  const [chestCm, setChestCm] = useState('');
  const [hipsCm, setHipsCm] = useState('');
  const [armsCm, setArmsCm] = useState('');
  const [thighsCm, setThighsCm] = useState('');
  const [note, setNote] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Stable across retries of the same submission (Review finding) -- only
  // regenerated after a successful save (reset()), so a retry after a
  // failed/timed-out attempt reuses the same id and collides with its own
  // earlier attempt server-side instead of inserting a duplicate row.
  const [clientEntryId, setClientEntryId] = useState(() => Crypto.randomUUID());

  function reset() {
    setWeightKg('');
    setWaistCm('');
    setChestCm('');
    setHipsCm('');
    setArmsCm('');
    setThighsCm('');
    setNote('');
    setPhotoUri(null);
    setError(null);
    setClientEntryId(Crypto.randomUUID());
  }

  function handleClose() {
    if (saving) return;
    reset();
    onClose();
  }

  async function handlePickPhoto(source: 'camera' | 'library') {
    const result = await pickPhoto(source);
    if ('error' in result) {
      setError(
        result.error === 'permission_denied'
          ? t('onboarding.profile.errorPhotoPermissionDenied')
          : t('onboarding.profile.errorPhotoTooLarge'),
      );
      return;
    }
    if ('canceled' in result) return;
    setError(null);
    setPhotoUri(result.uri);
  }

  const trimmedNote = note.trim();
  // Mirrors logProgressEntrySchema's own "at least one field" refine
  // (AC #3's "any subset" describes which fields, not zero fields).
  const hasAnyField =
    weightKg.trim() !== '' ||
    waistCm.trim() !== '' ||
    chestCm.trim() !== '' ||
    hipsCm.trim() !== '' ||
    armsCm.trim() !== '' ||
    thighsCm.trim() !== '' ||
    trimmedNote !== '' ||
    photoUri !== null;

  async function handleSave() {
    if (!hasAnyField || saving) return;
    setSaving(true);
    setError(null);
    try {
      const toNumberOrNull = (value: string) => (value.trim() === '' ? null : Number(value));
      const fields: ProgressEntryFields = {
        weightKg: toNumberOrNull(weightKg),
        waistCm: toNumberOrNull(waistCm),
        chestCm: toNumberOrNull(chestCm),
        hipsCm: toNumberOrNull(hipsCm),
        armsCm: toNumberOrNull(armsCm),
        thighsCm: toNumberOrNull(thighsCm),
        note: trimmedNote === '' ? null : trimmedNote,
        photoUri,
      };

      if (isConnected) {
        const result = await logProgressEntry(fields, clientEntryId);
        if (!result.success) {
          setError(t('progress.logEntry.errorSaveFailed'));
          return;
        }
      } else {
        const result = await queueOfflineProgressEntry(fields, clientEntryId);
        if (!result.success) {
          setError(t('progress.logEntry.errorInvalidInput'));
          return;
        }
      }

      reset();
      onSaved();
    } catch {
      setError(t('progress.logEntry.errorSaveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={styles.header}>
              <ThemedText type="subtitle">{t('progress.logEntry.title')}</ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
                onPress={handleClose}
                hitSlop={Spacing.two}
                style={styles.closeButton}>
                <MaterialIcons name="close" size={22} color={theme.textSecondary} />
              </Pressable>
            </View>

            <NumberField label={t('progress.logEntry.weightLabel')} value={weightKg} onChangeText={setWeightKg} theme={theme} />
            <NumberField label={t('progress.logEntry.waistLabel')} value={waistCm} onChangeText={setWaistCm} theme={theme} />
            <NumberField label={t('progress.logEntry.chestLabel')} value={chestCm} onChangeText={setChestCm} theme={theme} />
            <NumberField label={t('progress.logEntry.hipsLabel')} value={hipsCm} onChangeText={setHipsCm} theme={theme} />
            <NumberField label={t('progress.logEntry.armsLabel')} value={armsCm} onChangeText={setArmsCm} theme={theme} />
            <NumberField label={t('progress.logEntry.thighsLabel')} value={thighsCm} onChangeText={setThighsCm} theme={theme} />

            <View style={styles.field}>
              <ThemedText type="small">{t('progress.logEntry.noteLabel')}</ThemedText>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder={t('progress.logEntry.notePlaceholder')}
                placeholderTextColor={theme.textSecondary}
                multiline
                style={[styles.noteInput, { borderColor: theme.border, color: theme.text }]}
              />
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => openPhotoPicker(handlePickPhoto, t)}
              style={[styles.photoButton, { borderColor: theme.border }]}>
              <ThemedText type="default">
                {photoUri ? t('progress.logEntry.photoAdded') : t('progress.logEntry.addPhoto')}
              </ThemedText>
            </Pressable>

            {error && (
              <ThemedText type="small" style={styles.error}>
                {error}
              </ThemedText>
            )}

            <View style={styles.saveButton}>
              <Button label={t('progress.logEntry.save')} disabled={!hasAnyField} loading={saving} onPress={handleSave} />
            </View>
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  closeButton: {
    padding: Spacing.one,
  },
  field: {
    gap: Spacing.one,
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  noteInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  photoButton: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  error: {
    color: '#F87171',
  },
  saveButton: {
    marginTop: Spacing.two,
  },
});
