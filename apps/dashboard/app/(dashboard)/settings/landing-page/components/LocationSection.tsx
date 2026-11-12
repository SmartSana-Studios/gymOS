"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { gymCategoryLabel, placeNorm, type CityOption, type CountryOption } from "@gymos/types";
import type { LandingPageData } from "@/services/landing-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PAGE_SECTION_IDS } from "@/lib/landingPage";
import type { EditorErrors, EditorFormState, FieldError } from "@/lib/pageEditorForm";
import { SectionHeader } from "../../SectionHeader";
import { loadCitiesAction, saveLocationAction } from "../actions";
import { fieldErrorText } from "./PageTextSection";

// Story 25.1 (AD-49). The Location card: the gym's country and city are CHOSEN from the controlled lists with their own Save button
// (set_gym_location); the address and the map position stay with the page's main form. A typed city is only ever a way to find a list entry,
// through its normalized spelling ("Yaounde" reaches Yaoundé); free text is never sent.

const MAX_SHOWN = 50;

const errId = (key: string) => `err-${key.replace(/[^a-z0-9]/gi, "-")}`;
const described = (errors: EditorErrors, key: string) => (errors[key] ? errId(key) : undefined);

function FieldMessage({ error, name }: { error: FieldError | undefined; name: string }) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <p id={errId(name)} role="alert" className="text-sm text-red-600">
      {fieldErrorText(t, error)}
    </p>
  );
}

/** The list entry a typed text reaches by its normalized spelling, exactly; null when it reaches none. */
export function cityForText(cities: readonly CityOption[], text: string): CityOption | null {
  const q = placeNorm(text);
  if (q === "") return null;
  return cities.find((c) => c.aliasNorms.includes(q)) ?? null;
}

/** The entries to offer for a typed text: those with a spelling that starts with it first, then those that contain it. Everything for empty text. */
export function citiesMatching(cities: readonly CityOption[], text: string): CityOption[] {
  const q = placeNorm(text);
  if (q === "") return cities.slice(0, MAX_SHOWN);
  const starts: CityOption[] = [];
  const contains: CityOption[] = [];
  for (const c of cities) {
    if (c.aliasNorms.some((a) => a.startsWith(q))) starts.push(c);
    else if (c.aliasNorms.some((a) => a.includes(q))) contains.push(c);
  }
  return [...starts, ...contains].slice(0, MAX_SHOWN);
}

function countryLabel(c: CountryOption, language: string): string {
  return language.toLowerCase().startsWith("fr") ? c.nameFr : c.nameEn;
}

// The editor gives this component a `key` made of the stored country and city, so a saved (or externally changed) location starts it afresh,
// while an ordinary refresh of the page data leaves a selection that is still being made alone.
interface LocationSectionProps {
  form: EditorFormState;
  setForm: (next: EditorFormState) => void;
  errors: EditorErrors;
  data: LandingPageData;
  /** The fresh page data after a location save. */
  onSaved: (fresh: LandingPageData) => void;
  /** The save committed but reading the page back failed. */
  onSavedReloadFailed: () => void;
  onToast: (message: string) => void;
}

export function LocationSection({ form, setForm, errors, data, onSaved, onSavedReloadFailed, onToast }: LocationSectionProps) {
  const { t, i18n } = useTranslation();
  const { country: storedCountry, cityId: storedCityId, category } = data.content;
  const { countries } = data.lists;
  const listId = useId();

  const [country, setCountry] = useState(storedCountry);
  const [cities, setCities] = useState<CityOption[]>(data.lists.cities);
  const [cityId, setCityId] = useState<string | null>(storedCityId);
  const [query, setQuery] = useState(() => data.lists.cities.find((c) => c.id === storedCityId)?.name ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loadingCities, setLoadingCities] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const loadSeq = useRef(0);

  const sortedCountries = useMemo(() => {
    const collator = new Intl.Collator(i18n.language);
    return [...countries].sort((a, b) => collator.compare(countryLabel(a, i18n.language), countryLabel(b, i18n.language)));
  }, [countries, i18n.language]);

  const countryKnown = countries.some((c) => c.code === country);
  const currentCountryName = countries.find((c) => c.code === country);
  const countryName = currentCountryName ? countryLabel(currentCountryName, i18n.language) : country;

  const matches = useMemo(() => citiesMatching(cities, query), [cities, query]);
  const hit = cityForText(cities, query);
  const chosen = cities.find((c) => c.id === cityId) ?? null;
  const unknownText = query.trim() !== "" && !hit && matches.length === 0;
  const changed = country !== storedCountry || cityId !== storedCityId;
  const canSave = !saving && !loadingCities && cityId !== null && chosen !== null && changed;

  function choose(c: CityOption) {
    setCityId(c.id);
    setQuery(c.name);
    setOpen(false);
    setMessage(null);
  }

  function onQueryChange(value: string) {
    setQuery(value);
    setOpen(true);
    setActive(0);
    setMessage(null);
    // only an exact spelling selects; everything else leaves no city chosen (free text is never saved)
    setCityId(cityForText(cities, value)?.id ?? null);
  }

  async function onCountryChange(next: string) {
    setCountry(next);
    setCityId(null);
    setQuery("");
    setCities([]);
    setOpen(false);
    setMessage(null);
    // every change of country retires any load still in flight, including a return to the stored country
    const seq = ++loadSeq.current;
    if (next === storedCountry) {
      setLoadingCities(false);
      setCities(data.lists.cities);
      return;
    }
    setLoadingCities(true);
    try {
      const { data: list, error } = await loadCitiesAction(next);
      if (seq !== loadSeq.current) return;
      if (error || !list) setMessage(error?.message ?? t("pageEditor.errors.load_failed"));
      else setCities(list);
    } catch {
      if (seq === loadSeq.current) setMessage(t("pageEditor.errors.load_failed"));
    } finally {
      if (seq === loadSeq.current) setLoadingCities(false);
    }
  }

  async function save() {
    if (!canSave || cityId === null) return;
    setSaving(true);
    setMessage(null);
    try {
      const { data: fresh, error, reloadFailed } = await saveLocationAction({ country, city_id: cityId });
      if (error) {
        setMessage(error.message);
        return;
      }
      if (fresh) {
        onSaved(fresh);
        onToast(t("pageEditor.location.saved"));
      } else if (reloadFailed) {
        onToast(t("pageEditor.savedReloadFailed"));
        onSavedReloadFailed();
      }
    } catch {
      setMessage(t("pageEditor.errors.load_failed"));
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && open && matches[active]) {
      e.preventDefault();
      choose(matches[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function onBlur() {
    setOpen(false);
    // an exact spelling that was typed becomes the list's own name
    if (hit && query !== hit.name) setQuery(hit.name);
  }

  const showResolved = hit !== null && query.trim() !== "" && query.trim() !== hit.name;

  return (
    <Card id={PAGE_SECTION_IDS.location} data-testid="section-location">
      <SectionHeader icon={MapPin} accent="rose" title={t("pageEditor.sections.location")} description={t("pageEditor.sections.locationDescription")} />
      <CardContent className="space-y-4">
        <p className="text-sm">
          <span className="font-medium">{t("pageEditor.location.category")}:</span> {gymCategoryLabel(category, i18n.language)}
        </p>

        <fieldset className="space-y-3 rounded-md border p-3" data-testid="location-picker">
          <legend className="px-1 text-sm font-medium">{t("pageEditor.location.placeLegend")}</legend>
          <div className="space-y-2">
            <Label htmlFor="pageCountry">{t("pageEditor.location.country")}</Label>
            <select
              id="pageCountry"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={countryKnown ? country : ""}
              onChange={(e) => void onCountryChange(e.target.value)}
              disabled={saving}
            >
              {!countryKnown && <option value="">{t("pageEditor.location.countryPick")}</option>}
              {sortedCountries.map((c) => (
                <option key={c.code} value={c.code}>
                  {countryLabel(c, i18n.language)}
                </option>
              ))}
            </select>
            {country !== storedCountry && <p className="text-xs text-muted-foreground">{t("pageEditor.location.countryChanged")}</p>}
          </div>

          <div className="relative space-y-2">
            <Label htmlFor="pageCity">{t("pageEditor.fields.city")}</Label>
            <Input
              id="pageCity"
              role="combobox"
              autoComplete="off"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
              aria-describedby={`${listId}-help`}
              placeholder={loadingCities ? t("pageEditor.location.citiesLoading") : t("pageEditor.location.cityPlaceholder")}
              value={query}
              disabled={saving || loadingCities || !countryKnown}
              onChange={(e) => onQueryChange(e.target.value)}
              onFocus={() => setOpen(true)}
              onBlur={onBlur}
              onKeyDown={onKeyDown}
            />
            {open && matches.length > 0 && (
              <ul id={listId} role="listbox" aria-label={t("pageEditor.fields.city")} className="absolute z-20 max-h-60 w-full overflow-auto rounded-md border bg-background py-1 text-sm shadow-md">
                {matches.map((c, i) => (
                  <li
                    key={c.id}
                    id={`${listId}-${c.id}`}
                    role="option"
                    aria-selected={c.id === cityId}
                    className={`cursor-pointer px-3 py-2 ${i === active ? "bg-accent" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(c);
                    }}
                  >
                    {c.name}
                  </li>
                ))}
              </ul>
            )}
            <p id={`${listId}-help`} className="text-xs text-muted-foreground">
              {t("pageEditor.location.cityHint")}
            </p>
            {showResolved && hit && (
              <p role="status" className="text-sm" data-testid="city-resolved">
                {t("pageEditor.location.cityResolved", { name: hit.name })}
              </p>
            )}
            {unknownText && (
              <p role="status" className="text-sm text-amber-700 dark:text-amber-300" data-testid="city-unknown">
                {t("pageEditor.location.cityUnknown", { name: query.trim(), country: countryName })}
              </p>
            )}
            {storedCityId === null && !changed && <p className="text-sm text-muted-foreground">{t("pageEditor.location.cityRequired")}</p>}
          </div>

          {message && (
            <p role="alert" className="text-sm text-red-600" data-testid="location-error">
              {message}
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button type="button" onClick={() => void save()} disabled={!canSave} data-testid="location-save">
              {saving ? t("common.saving") : t("pageEditor.location.save")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("pageEditor.location.saveHelper")}</p>
          </div>
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="pageAddress">{t("pageEditor.fields.address")}</Label>
          <Input id="pageAddress" value={form.address} aria-invalid={errors.address ? true : undefined} aria-describedby={described(errors, "address")} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <FieldMessage name="address" error={errors.address} />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("pageEditor.location.map")}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="pageLat">{t("pageEditor.location.lat")}</Label>
              <Input id="pageLat" inputMode="decimal" value={form.lat} aria-invalid={errors.latlng ? true : undefined} aria-describedby={described(errors, "latlng")} onChange={(e) => setForm({ ...form, lat: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pageLng">{t("pageEditor.location.lng")}</Label>
              <Input id="pageLng" inputMode="decimal" value={form.lng} aria-invalid={errors.latlng ? true : undefined} aria-describedby={described(errors, "latlng")} onChange={(e) => setForm({ ...form, lng: e.target.value })} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("pageEditor.location.mapHelper")}</p>
          <FieldMessage name="latlng" error={errors.latlng} />
        </fieldset>
      </CardContent>
    </Card>
  );
}
