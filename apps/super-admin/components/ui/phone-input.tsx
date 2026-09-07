"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import { TARAMONEY_SUPPORTED_COUNTRIES } from "@gymos/types";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Story 16.1 (AC #8): every phone field defaults to Cameroon -- the only
// country in TARAMONEY_SUPPORTED_COUNTRIES that also matches MemberModal's
// pre-existing DEFAULT_PHONE_PREFIX ("+237") convention, so switching that
// field to PhoneInput doesn't change its default behavior.
const DEFAULT_COUNTRY: CountryCode = "CM";

interface CountryOption {
  code: CountryCode;
  name: string;
  callingCode: string;
}

// Unicode regional-indicator flag from an ISO 3166-1 alpha-2 code (AC #2 --
// no image asset, no new dependency).
function flagEmoji(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

function buildGlobalCountries(locale: string): CountryOption[] {
  const displayNames = new Intl.DisplayNames([locale], { type: "region" });
  return getCountries()
    .map((code) => ({
      code,
      name: displayNames.of(code) ?? code,
      callingCode: getCountryCallingCode(code),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
  countries?: "global" | "tara-money";
  disabled?: boolean;
  id?: string;
  placeholder?: string;
}

/**
 * Story 16.1: shared, per-app-duplicated (see input.tsx's own convention)
 * country-picker phone field. Plain controlled `value`/`onChange`, no
 * internal form-library binding (MemberModal.tsx:156-158's documented
 * convention). `onChange` always emits a valid E.164 string or `null` --
 * never a partial/invalid one (AC #1).
 */
export function PhoneInput({
  value,
  onChange,
  countries = "global",
  disabled,
  id,
  placeholder,
}: PhoneInputProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = React.useState(false);

  const options = React.useMemo(
    () => (countries === "tara-money" ? buildTaraMoneyCountries() : buildGlobalCountries(i18n.language)),
    [countries, i18n.language],
  );

  function deriveFromValue(nextValue: string | null): { country: CountryCode; nationalNumber: string } {
    const parsed = nextValue ? parsePhoneNumberFromString(nextValue) : undefined;
    if (parsed?.country && options.some((option) => option.code === parsed.country)) {
      return { country: parsed.country, nationalNumber: parsed.nationalNumber };
    }
    // AC #8: a value that doesn't parse as valid E.164 (a legacy
    // pre-convention record, or no value at all) falls back to the default
    // Cameroon selection with an empty national number, rather than
    // rendering broken/unparseable state.
    return { country: DEFAULT_COUNTRY, nationalNumber: "" };
  }

  const [{ country, nationalNumber }, setFieldState] = React.useState(() => deriveFromValue(value));

  // Bug fix (manual QA): every call site coerces the `null` this component
  // emits for an invalid/empty number into `""` before storing it in its
  // own form state and passing it back down as `value` (`onChange={(v) =>
  // setForm({..., phone: v ?? ""})}`, this codebase's established
  // convention). `null` and `""` must therefore be treated as the same
  // "empty" value on both sides of this comparison -- otherwise, whenever
  // the field's starting `value` is a non-empty placeholder (e.g.
  // MemberModal's `DEFAULT_PHONE_PREFIX = "+237"`), selecting a country
  // before typing any digits emits `null`, the caller round-trips it back
  // as `""`, and `"" !== null` reads as an external reset -- snapping the
  // just-picked country straight back to the default before the user ever
  // sees it stick. Confirmed live: reproduced in MemberModal, fixed and
  // reverified with a real Playwright session.
  function normalizeEmpty(v: string | null): string | null {
    return v === "" ? null : v;
  }

  // Tracks the last value this component itself emitted via onChange, so an
  // external reset of the `value` prop (parent clearing/re-seeding form
  // state, e.g. on modal close/reopen) re-derives country + national number,
  // without this component's own onChange round-trip clobbering what the
  // user is still mid-typing.
  const lastEmitted = React.useRef<string | null>(normalizeEmpty(value));
  React.useEffect(() => {
    const normalizedValue = normalizeEmpty(value);
    if (normalizedValue === lastEmitted.current) return;
    lastEmitted.current = normalizedValue;
    setFieldState(deriveFromValue(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const selectedOption = options.find((option) => option.code === country);

  function emit(nextCountry: CountryCode, nextNationalNumber: string) {
    const parsed = nextNationalNumber
      ? parsePhoneNumberFromString(nextNationalNumber, nextCountry)
      : undefined;
    const next = parsed?.isValid() ? parsed.number : null;
    lastEmitted.current = normalizeEmpty(next);
    onChange(next);
  }

  function handleCountrySelect(nextCountry: CountryCode) {
    setFieldState({ country: nextCountry, nationalNumber });
    setOpen(false);
    emit(nextCountry, nationalNumber);
  }

  function handleNationalNumberChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setFieldState({ country, nationalNumber: next });
    emit(country, next);
  }

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={t("phoneInput.selectCountry")}
            disabled={disabled}
            className="w-[6.5rem] shrink-0 justify-between px-2 font-normal"
          >
            <span className="flex items-center gap-1.5 truncate">
              <span aria-hidden="true">{flagEmoji(selectedOption?.code ?? DEFAULT_COUNTRY)}</span>
              <span>+{selectedOption?.callingCode}</span>
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[16rem] p-0" align="start">
          <Command>
            <CommandInput placeholder={t("phoneInput.searchCountry")} />
            <CommandList>
              <CommandEmpty>{t("phoneInput.noCountryFound")}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.code}
                    value={`${option.name} ${option.code} +${option.callingCode}`}
                    onSelect={() => handleCountrySelect(option.code)}
                  >
                    <Check
                      className={cn("mr-2 size-4", option.code === country ? "opacity-100" : "opacity-0")}
                    />
                    <span aria-hidden="true" className="mr-2">
                      {flagEmoji(option.code)}
                    </span>
                    <span className="flex-1 truncate">{option.name}</span>
                    <span className="text-muted-foreground">+{option.callingCode}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        value={nationalNumber}
        onChange={handleNationalNumberChange}
        disabled={disabled}
        placeholder={placeholder}
        className="flex-1"
      />
    </div>
  );
}
