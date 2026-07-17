import * as Localization from 'expo-localization';
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '@/locales/en.json';
import fr from '@/locales/fr.json';

// Mobile locales are deliberately separate from packages/types/src/locales
// (different vocabulary/onboarding flow, architecture.md line 388/398) --
// no deepMerge with the dashboard's shared resources, unlike
// apps/dashboard/lib/i18n/get-server-translation.ts.
const RESOURCES = {
  en: { translation: en },
  fr: { translation: fr },
} as const;

export type MobileLocale = keyof typeof RESOURCES;

/** MA-01's pre-highlight rule (EXPERIENCE.md): pre-highlight the card
 * matching device locale if it's EN or FR, otherwise no highlight -- also
 * doubles as the app's initial `lng` before the member has made a choice. */
export function detectDeviceLocale(): MobileLocale {
  const code = Localization.getLocales()[0]?.languageCode;
  return code === 'fr' ? 'fr' : 'en';
}

// Single module-scope instance -- mobile has no server-rendered "locale
// prop" to seed from (unlike apps/dashboard's per-request instance), so a
// singleton initialized once at app start is the natural fit; language
// changes go through i18n.changeLanguage() (MA-01's tap-to-select), which
// re-renders every `useTranslation()` consumer app-wide.
export const i18n = createInstance();
void i18n.use(initReactI18next).init({
  lng: detectDeviceLocale(),
  fallbackLng: 'en',
  resources: RESOURCES,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});
