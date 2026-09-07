import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { TARAMONEY_SUPPORTED_COUNTRIES } from '@gymos/types';

import { CountryPickerModal, type PickerCountry } from '@/components/ui/CountryPickerModal';
import { ThemedText } from '@/components/themed-text';
import { COUNTRY_NAMES } from '@/constants/countryNames';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { i18n as mobileI18n } from '@/lib/i18n';

// Story 16.2 (mirrors Story 16.1's web PhoneInput AC #8): every phone field
// defaults to Cameroon -- matches every existing call site's own
// `+237`-prefix default (`onboarding/phone.tsx`'s `COUNTRY_PREFIX`,
// `renew.tsx`'s `DEFAULT_PHONE_PREFIX`), so switching to `PhoneInput`
// doesn't change default behavior.
const DEFAULT_COUNTRY: CountryCode = 'CM';

interface CountryOption extends PickerCountry {
  code: CountryCode;
}

function buildGlobalCountries(locale: 'en' | 'fr'): CountryOption[] {
  return getCountries()
    .filter((code) => Boolean(COUNTRY_NAMES[code]))
    .map((code) => ({
      code,
      name: COUNTRY_NAMES[code][locale],
      callingCode: getCountryCallingCode(code),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

function buildTaraMoneyCountries(): CountryOption[] {
  return TARAMONEY_SUPPORTED_COUNTRIES.map((country) => ({
    code: country.code as CountryCode,
    name: country.name,
    callingCode: country.callingCode,
  }));
}

export interface PhoneInputProps {
  value: string | null;
  onChange: (value: string | null) => void;
  /** @default "global" */
  countries?: 'global' | 'tara-money';
  disabled?: boolean;
  autoFocus?: boolean;
}

/**
 * Story 16.2: mobile country-picker phone field, mirroring the web
 * `PhoneInput` Story 16.1 built (`apps/dashboard`/`apps/super-admin`'s
 * `components/ui/phone-input.tsx`) -- same controlled `value`/`onChange`
 * contract, same default-country-fallback and external-reset handling, but
 * built on React Native's `Modal`+`FlatList` instead of shadcn
 * `Popover`+`Command`, and a static `COUNTRY_NAMES` table instead of runtime
 * `Intl.DisplayNames` (see that file's own header comment for why). `onChange`
 * always emits a valid E.164 string or `null` -- never a partial/invalid one.
 */
export function PhoneInput({ value, onChange, countries = 'global', disabled, autoFocus }: PhoneInputProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [pickerVisible, setPickerVisible] = useState(false);

  const options = useMemo(
    () => (countries === 'tara-money' ? buildTaraMoneyCountries() : buildGlobalCountries(mobileI18n.language === 'fr' ? 'fr' : 'en')),
    // mobileI18n.language changes trigger a re-render app-wide on language
    // switch (every useTranslation() consumer), but isn't itself a React
    // dependency this hook can list -- re-reading it in the memo body on
    // every render this component takes is intentional here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [countries, mobileI18n.language],
  );

  function deriveFromValue(nextValue: string | null): { country: CountryCode; nationalNumber: string } {
    const parsed = nextValue ? parsePhoneNumberFromString(nextValue) : undefined;
    if (parsed?.country && options.some((option) => option.code === parsed.country)) {
      return { country: parsed.country as CountryCode, nationalNumber: parsed.nationalNumber };
    }
    // A value that doesn't parse as valid E.164 (a legacy pre-convention
    // record, or no value at all) falls back to the default Cameroon
    // selection with an empty national number, rather than rendering
    // broken/unparseable state -- same fallback Story 16.1 built for the
    // identical scenario on web.
    return { country: DEFAULT_COUNTRY, nationalNumber: '' };
  }

  const [{ country, nationalNumber }, setFieldState] = useState(() => deriveFromValue(value));

  // Every call site coerces the `null` this component emits for an
  // invalid/empty number into `""` before storing it in its own form state
  // and passing it back down (`onChange={(v) => setPhone(v ?? '')}` /
  // `onChange={(v) => setPayerPhone(v ?? DEFAULT_PHONE_PREFIX)}`) -- `null`
  // and `""` must be treated as the same "empty" value on both sides of this
  // comparison, or an external round-trip reads as a real reset and snaps a
  // just-picked country back to the default before the user ever sees it
  // stick. This is the exact bug Story 16.1 found and fixed in manual QA for
  // the identical web component -- replicated here up front rather than
  // reintroducing it.
  function normalizeEmpty(v: string | null): string | null {
    return v === '' ? null : v;
  }

  const lastEmitted = useRef<string | null>(normalizeEmpty(value));
  useEffect(() => {
    const normalizedValue = normalizeEmpty(value);
    if (normalizedValue === lastEmitted.current) return;
    lastEmitted.current = normalizedValue;
    setFieldState(deriveFromValue(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const selectedOption = options.find((option) => option.code === country);

  function emit(nextCountry: CountryCode, nextNationalNumber: string) {
    const parsed = nextNationalNumber ? parsePhoneNumberFromString(nextNationalNumber, nextCountry) : undefined;
    const next = parsed?.isValid() ? parsed.number : null;
    lastEmitted.current = normalizeEmpty(next);
    onChange(next);
  }

  function handleSelectCountry(code: string) {
    const nextCountry = code as CountryCode;
    setFieldState({ country: nextCountry, nationalNumber });
    setPickerVisible(false);
    emit(nextCountry, nationalNumber);
  }

  function handleNationalNumberChange(text: string) {
    const digits = text.replace(/[^0-9]/g, '');
    setFieldState({ country, nationalNumber: digits });
    emit(country, digits);
  }

  return (
    <>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('phoneInput.selectCountry')}
          disabled={disabled}
          onPress={() => setPickerVisible(true)}
          style={[styles.countryButton, { borderColor: theme.border }, disabled && styles.disabled]}>
          <ThemedText type="default">+{selectedOption?.callingCode ?? getCountryCallingCode(DEFAULT_COUNTRY)}</ThemedText>
        </Pressable>
        <TextInput
          value={nationalNumber}
          onChangeText={handleNationalNumberChange}
          keyboardType="number-pad"
          editable={!disabled}
          autoFocus={autoFocus}
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { borderColor: theme.border, color: theme.text }, disabled && styles.disabled]}
        />
      </View>
      <CountryPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        countries={options}
        selectedCode={country}
        onSelect={handleSelectCountry}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  countryButton: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  disabled: {
    opacity: 0.5,
  },
});
