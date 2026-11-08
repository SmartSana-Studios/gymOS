"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Clock, MapPin, Phone } from "lucide-react";
import { PAGE_HOURS_DAYS } from "@gymos/types";
import { gymCategoryLabel } from "@gymos/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PAGE_SECTION_IDS } from "@/lib/landingPage";
import { copyMondayToAll, type EditorErrors, type EditorFormState, type FieldError } from "@/lib/pageEditorForm";
import { SectionHeader } from "../../SectionHeader";
import { fieldErrorText } from "./PageTextSection";

interface SectionProps {
  form: EditorFormState;
  setForm: (next: EditorFormState) => void;
  errors: EditorErrors;
}

/** The id a field's error paragraph carries, and that the input names in aria-describedby. */
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

export function LocationSection({ form, setForm, errors, country, category }: SectionProps & { country: string; category: string }) {
  const { t, i18n } = useTranslation();
  let countryName = country;
  try {
    countryName = new Intl.DisplayNames(i18n.language, { type: "region" }).of(country) ?? country;
  } catch {
    countryName = country;
  }
  return (
    <Card id={PAGE_SECTION_IDS.location} data-testid="section-location">
      <SectionHeader icon={MapPin} accent="rose" title={t("pageEditor.sections.location")} description={t("pageEditor.sections.locationDescription")} />
      <CardContent className="space-y-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <p>
            <span className="font-medium">{t("pageEditor.location.category")}:</span> {gymCategoryLabel(category, i18n.language)}
          </p>
          <p>
            <span className="font-medium">{t("pageEditor.location.country")}:</span> {countryName}
          </p>
        </div>
        <Link href="/settings" className="text-sm underline">
          {t("pageEditor.location.changeInSettings")}
        </Link>
        <div className="space-y-2">
          <Label htmlFor="pageCity">{t("pageEditor.fields.city")}</Label>
          <Input id="pageCity" value={form.city} aria-invalid={errors.city ? true : undefined} aria-describedby={described(errors, "city")} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <FieldMessage name="city" error={errors.city} />
        </div>
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

export function HoursSection({ form, setForm, errors }: SectionProps) {
  const { t } = useTranslation();
  return (
    <Card id={PAGE_SECTION_IDS.hours} data-testid="section-hours">
      <SectionHeader icon={Clock} accent="cyan" title={t("pageEditor.sections.hours")} description={t("pageEditor.sections.hoursDescription")} />
      <CardContent className="space-y-3">
        <ul className="space-y-2">
          {PAGE_HOURS_DAYS.map((d) => {
            const day = form.hours[d];
            const err = errors[`hours.${d}`];
            const setDay = (patch: Partial<typeof day>) => setForm({ ...form, hours: { ...form.hours, [d]: { ...day, ...patch } } });
            return (
              <li key={d} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-24 font-medium">{t(`pageEditor.days.${d}`)}</span>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={day.closed} onChange={(e) => setDay({ closed: e.target.checked })} />
                  {t("pageEditor.hours.closed")}
                </label>
                {!day.closed && (
                  <>
                    <Input type="time" aria-label={t("pageEditor.hours.open", { day: t(`pageEditor.days.${d}`) })} aria-invalid={err ? true : undefined} aria-describedby={described(errors, `hours.${d}`)} className="w-32" value={day.open} onChange={(e) => setDay({ open: e.target.value })} />
                    <Input type="time" aria-label={t("pageEditor.hours.close", { day: t(`pageEditor.days.${d}`) })} aria-invalid={err ? true : undefined} aria-describedby={described(errors, `hours.${d}`)} className="w-32" value={day.close} onChange={(e) => setDay({ close: e.target.value })} />
                  </>
                )}
                <FieldMessage name={`hours.${d}`} error={err} />
              </li>
            );
          })}
        </ul>
        <Button type="button" variant="outline" size="sm" onClick={() => setForm(copyMondayToAll(form))}>
          {t("pageEditor.hours.copyMonday")}
        </Button>
      </CardContent>
    </Card>
  );
}

export function ContactSection({ form, setForm, errors }: SectionProps) {
  const { t } = useTranslation();
  return (
    <Card id={PAGE_SECTION_IDS.contact} data-testid="section-contact">
      <SectionHeader icon={Phone} accent="violet" title={t("pageEditor.sections.contact")} description={t("pageEditor.sections.contactDescription")} />
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("pageEditor.contact.helper")}</p>
        <div className="space-y-2">
          <Label htmlFor="pagePhone">{t("pageEditor.contact.phone")}</Label>
          <Input id="pagePhone" inputMode="tel" placeholder="+237600000000" value={form.phone} aria-invalid={errors.contact_phone ? true : undefined} aria-describedby={described(errors, "contact_phone")} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <FieldMessage name="contact_phone" error={errors.contact_phone} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pageWhatsapp">{t("pageEditor.contact.whatsapp")}</Label>
          <Input id="pageWhatsapp" inputMode="tel" placeholder="+237600000000" value={form.whatsapp} aria-invalid={errors.contact_whatsapp ? true : undefined} aria-describedby={described(errors, "contact_whatsapp")} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
          <FieldMessage name="contact_whatsapp" error={errors.contact_whatsapp} />
        </div>
      </CardContent>
    </Card>
  );
}
