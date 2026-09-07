import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@react-native-vector-icons/material-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface PickerCountry {
  code: string;
  name: string;
  callingCode: string;
}

export interface CountryPickerModalProps {
  visible: boolean;
  onClose: () => void;
  countries: PickerCountry[];
  selectedCode?: string;
  onSelect: (code: string) => void;
}

// Strips accents/diacritics and normalizes curly apostrophes to straight ones
// so a plain-ASCII search (no accents, straight apostrophe -- what a phone
// keyboard produces by default) still matches French country names like
// "Côte d'Ivoire" / "Bénin" / "Sénégal".
function foldForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .toLowerCase();
}

// Unicode regional-indicator flag from an ISO 3166-1 alpha-2 code -- same
// technique as Story 16.1's web PhoneInput (zero new dependency). Decorative
// only: Android's flag-glyph rendering is device/OS-version dependent (some
// render the raw two-letter code instead of a flag), but the calling code +
// name text next to it stay fully legible either way.
function flagEmoji(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

// No popover/bottom-sheet library exists anywhere in this codebase
// (LogEntrySheet.tsx's own comment states this explicitly) -- this mirrors
// that component's established RN Modal (slide-up, pageSheet) precedent
// rather than introducing one, with a FlatList (not ScrollView) since the
// global country list can be 200+ rows.
export function CountryPickerModal({ visible, onClose, countries, selectedCode, onSelect }: CountryPickerModalProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const normalized = foldForSearch(query.trim());
    if (!normalized) return countries;
    return countries.filter(
      (country) => foldForSearch(country.name).includes(normalized) || country.callingCode.includes(normalized),
    );
  }, [countries, query]);

  function handleClose() {
    setQuery('');
    onClose();
  }

  function handleSelect(code: string) {
    setQuery('');
    onSelect(code);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
          <View style={styles.header}>
            <ThemedText type="subtitle">{t('phoneInput.selectCountry')}</ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={handleClose}
              hitSlop={Spacing.two}
              style={styles.closeButton}>
              <MaterialIcons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>

          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('phoneInput.searchCountry')}
            placeholderTextColor={theme.textSecondary}
            autoFocus
            style={[styles.searchInput, { borderColor: theme.border, color: theme.text }]}
          />

          <FlatList
            data={filtered}
            keyExtractor={(item) => item.code}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                {t('phoneInput.noCountryFound')}
              </ThemedText>
            }
            renderItem={({ item }) => {
              const isSelected = item.code === selectedCode;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name} +${item.callingCode}`}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => handleSelect(item.code)}
                  style={[styles.row, { borderBottomColor: theme.border }]}>
                  <ThemedText type="default" style={styles.flag} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    {flagEmoji(item.code)}
                  </ThemedText>
                  <ThemedText type="default" style={styles.rowName} numberOfLines={1}>
                    {item.name}
                  </ThemedText>
                  <ThemedText type="default" themeColor="textSecondary">
                    +{item.callingCode}
                  </ThemedText>
                  {isSelected && (
                    <MaterialIcons
                      name="check"
                      size={18}
                      color={theme.text}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    />
                  )}
                </Pressable>
              );
            }}
          />
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
    paddingHorizontal: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  closeButton: {
    padding: Spacing.one,
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    marginBottom: Spacing.two,
  },
  listContent: {
    paddingBottom: Spacing.four,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
  },
  flag: {
    fontSize: 20,
  },
  rowName: {
    flex: 1,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: Spacing.four,
  },
});
