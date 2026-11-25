import AsyncStorage from '@react-native-async-storage/async-storage';

import { languageSyncKey, type LanguageSyncDeps, type SyncedLanguage } from '@/lib/languageSync';
import { supabase } from '@/lib/supabase';

/** The production wiring: AsyncStorage for the note, the member's own users row for the write. */
export const defaultLanguageSyncDeps: LanguageSyncDeps = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  updateLanguage: async (userId, language) => {
    const { error } = await supabase.from('users').update({ preferred_language: language }).eq('id', userId);
    return !error;
  },
};

/** The Profile language switcher already wrote the value; note it so the next start does not send it again. */
export async function noteLanguageSynced(userId: string, language: SyncedLanguage): Promise<void> {
  try {
    await AsyncStorage.setItem(languageSyncKey(userId), language);
  } catch {
    // Best effort: a missed note only costs one repeated update at the next start.
  }
}
