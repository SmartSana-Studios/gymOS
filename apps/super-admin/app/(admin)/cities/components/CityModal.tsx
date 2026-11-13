"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { CITY_ALIASES_MAX, cityFormSchema, parseCityCoordinate, placeSlug, type CityErrorCode } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addCity, updateCity, type CityRow, type CountryRow } from "../actions";

type FieldKey = "country" | "name" | "slug" | "aliases" | "coordinates";
type FieldErrors = Partial<Record<FieldKey, string>>;

const emptyForm = { country: "", name: "", slug: "", aliases: "", lat: "", lng: "" };

function formFromCity(city: CityRow | null, defaultCountry: string) {
  if (!city) return { ...emptyForm, country: defaultCountry };
  return {
    country: city.countryCode,
    name: city.name,
    slug: city.slug,
    aliases: city.aliases.join("\n"),
    lat: city.lat === null ? "" : String(city.lat),
    lng: city.lng === null ? "" : String(city.lng),
  };
}

/** Which field a typed refusal belongs to. */
const FIELD_OF: Record<CityErrorCode, FieldKey | null> = {
  slug_taken: "slug",
  slug_reserved: "slug",
  invalid_slug: "slug",
  alias_taken: "aliases",
  invalid_alias: "aliases",
  invalid_coordinates: "coordinates",
  unknown_country: "country",
  name_required: "name",
  not_found: null,
};

/** Aliases are typed one per line (a comma also separates); blank lines go. */
export function parseAliases(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((a) => a.trim())
    .filter((a) => a !== "");
}

/** Add / edit a city. Native <dialog>, as TierModal. The country is chosen when adding and fixed afterwards (a gym's city never moves with it). */
export function CityModal({
  open,
  onClose,
  onSaved,
  editing,
  countries,
  defaultCountry,
  language,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing: CityRow | null;
  countries: CountryRow[];
  defaultCountry: string;
  language: string;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setForm(formFromCity(editing, defaultCountry));
      setFieldErrors({});
      setFormError(null);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const countryName = (c: CountryRow) => (language.toLowerCase().startsWith("fr") ? c.nameFr : c.nameEn);
  const slugPreview = form.slug.trim() === "" ? placeSlug(form.name) : form.slug.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);

    const errors: FieldErrors = {};
    const lat = parseCityCoordinate(form.lat);
    const lng = parseCityCoordinate(form.lng);
    if (lat === "invalid" || lng === "invalid") errors.coordinates = t("cities.errors.invalid_coordinates");
    const aliases = parseAliases(form.aliases);
    if (aliases.length > CITY_ALIASES_MAX) errors.aliases = t("cities.errors.invalid_alias");
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const parsed = cityFormSchema.safeParse({
      country_code: form.country,
      name: form.name,
      slug: form.slug.trim(),
      aliases,
      lat: lat as number | null,
      lng: lng as number | null,
    });
    if (!parsed.success) {
      const found: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        const field: FieldKey = key === "country_code" ? "country" : key === "name" ? "name" : key === "slug" ? "slug" : key === "aliases" ? "aliases" : "coordinates";
        if (!found[field]) found[field] = field === "name" ? t("cities.errors.name_required") : field === "coordinates" ? t("cities.errors.invalid_coordinates") : field === "slug" ? t("cities.errors.invalid_slug") : field === "country" ? t("cities.errors.unknown_country") : issue.message;
      }
      setFieldErrors(found);
      return;
    }

    setSubmitting(true);
    try {
      const { error } = editing ? await updateCity(editing.id, parsed.data) : await addCity(parsed.data);
      if (error) {
        const field = FIELD_OF[error.code as CityErrorCode];
        if (field) setFieldErrors({ [field]: error.message });
        else setFormError(error.message);
        return;
      }
      onSaved();
    } catch {
      setFormError(t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={(e) => {
        if (submitting) e.preventDefault();
      }}
      className="w-full max-w-[520px] rounded-md border p-0 backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6" data-testid="city-form">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{editing ? t("cities.modal.editTitle", { name: editing.name }) : t("cities.modal.addTitle")}</h2>
          <button type="button" aria-label={t("cities.modal.close")} onClick={onClose} disabled={submitting} className="text-muted-foreground hover:text-foreground disabled:opacity-50">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="cityCountry">{t("cities.modal.country")}</Label>
          <select
            id="cityCountry"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-70"
            value={form.country}
            disabled={editing !== null || submitting}
            onChange={(e) => setForm({ ...form, country: e.target.value })}
          >
            <option value="">{t("cities.modal.countryPick")}</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {countryName(c)}
              </option>
            ))}
          </select>
          {editing && <p className="text-xs text-muted-foreground">{t("cities.modal.countryFixed")}</p>}
          {fieldErrors.country && <p role="alert" className="text-sm text-red-600">{fieldErrors.country}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="cityName">{t("cities.modal.name")}</Label>
          <Input id="cityName" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={fieldErrors.name ? true : undefined} />
          {fieldErrors.name && <p role="alert" className="text-sm text-red-600">{fieldErrors.name}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="citySlug">{t("cities.modal.slug")}</Label>
          <Input id="citySlug" value={form.slug} placeholder={placeSlug(form.name)} onChange={(e) => setForm({ ...form, slug: e.target.value })} aria-invalid={fieldErrors.slug ? true : undefined} />
          <p className="text-xs text-muted-foreground">{editing ? t("cities.modal.slugEditHelper") : t("cities.modal.slugHelper", { slug: slugPreview || "-" })}</p>
          {fieldErrors.slug && <p role="alert" className="text-sm text-red-600">{fieldErrors.slug}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="cityAliases">{t("cities.modal.aliases")}</Label>
          <textarea
            id="cityAliases"
            rows={3}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={form.aliases}
            onChange={(e) => setForm({ ...form, aliases: e.target.value })}
            aria-invalid={fieldErrors.aliases ? true : undefined}
          />
          <p className="text-xs text-muted-foreground">{t("cities.modal.aliasesHelper")}</p>
          {fieldErrors.aliases && <p role="alert" className="text-sm text-red-600">{fieldErrors.aliases}</p>}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("cities.modal.position")}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cityLat">{t("cities.modal.lat")}</Label>
              <Input id="cityLat" inputMode="decimal" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} aria-invalid={fieldErrors.coordinates ? true : undefined} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cityLng">{t("cities.modal.lng")}</Label>
              <Input id="cityLng" inputMode="decimal" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} aria-invalid={fieldErrors.coordinates ? true : undefined} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("cities.modal.positionHelper")}</p>
          {fieldErrors.coordinates && <p role="alert" className="text-sm text-red-600">{fieldErrors.coordinates}</p>}
        </fieldset>

        {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t("common.saving") : editing ? t("cities.modal.saveChanges") : t("cities.modal.addButton")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
