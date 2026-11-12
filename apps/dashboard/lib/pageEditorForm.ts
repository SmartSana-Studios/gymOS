import {
  PAGE_CONTENT_LANGUAGES,
  PAGE_HOURS_DAYS,
  cleanPageText,
  cleanServicesText,
  setGymPageContentSchema,
  type PageContentLanguage,
} from "@gymos/types";

// Story 24.9. The editor form as plain data: building it from the stored page, cleaning it, validating it inline and turning it into the
// `set_gym_page_content` call. Pure (no React, no network) so the rules are tested without a browser.

export type HoursDay = (typeof PAGE_HOURS_DAYS)[number];

export interface DayForm {
  closed: boolean;
  open: string;
  close: string;
}

export interface EditorFormState {
  about: Record<PageContentLanguage, string>;
  services: Record<PageContentLanguage, string>;
  address: string;
  lat: string;
  lng: string;
  hours: Record<HoursDay, DayForm>;
  phone: string;
  whatsapp: string;
  /** plan id -> "Show on my page". */
  plans: Record<string, boolean>;
}

export interface StoredPageFields {
  about: Record<PageContentLanguage, string>;
  services: Record<PageContentLanguage, string>;
  address: string;
  lat: string;
  lng: string;
  hours: Record<string, { open: string; close: string } | null> | null;
  contactPhone: string;
  contactWhatsapp: string;
}

export const DEFAULT_OPEN = "06:00";
export const DEFAULT_CLOSE = "22:00";

export function initialForm(stored: StoredPageFields, plans: readonly { id: string; isPublic: boolean }[]): EditorFormState {
  const hours = {} as Record<HoursDay, DayForm>;
  for (const d of PAGE_HOURS_DAYS) {
    const v = stored.hours?.[d];
    hours[d] = v ? { closed: false, open: v.open, close: v.close } : { closed: true, open: DEFAULT_OPEN, close: DEFAULT_CLOSE };
  }
  return {
    about: { ...stored.about },
    services: { ...stored.services },
    address: stored.address,
    lat: stored.lat,
    lng: stored.lng,
    hours,
    phone: stored.contactPhone,
    whatsapp: stored.contactWhatsapp,
    plans: Object.fromEntries(plans.map((p) => [p.id, p.isPublic])),
  };
}

/** Line breaks and control characters cleaned in every free-text field, and bullet markers dropped from Services lines; the field then shows the cleaned text. */
export function cleanForm(form: EditorFormState): EditorFormState {
  const about = {} as Record<PageContentLanguage, string>;
  const services = {} as Record<PageContentLanguage, string>;
  for (const l of PAGE_CONTENT_LANGUAGES) {
    about[l] = cleanPageText(form.about[l] ?? "");
    services[l] = cleanServicesText(form.services[l] ?? "");
  }
  return { ...form, about, services, address: cleanPageText(form.address) };
}

/** Copy Monday's hours (or its closed state) to every other day. */
export function copyMondayToAll(form: EditorFormState): EditorFormState {
  const hours = { ...form.hours };
  for (const d of PAGE_HOURS_DAYS) hours[d] = { ...form.hours.mon };
  return { ...form, hours };
}

export type FieldErrorCode = "angle" | "tooLong" | "phone" | "latlngPair" | "latlngRange" | "latlngNumber" | "hoursEqual" | "hoursTime";
export interface FieldError {
  code: FieldErrorCode;
  /** For `angle` and `tooLong`: the field, and the language when it has one. */
  field?: "about" | "services" | "address";
  lang?: PageContentLanguage;
}
export type EditorErrors = Record<string, FieldError>;

const COORD_RE = /^-?\d+(\.\d+)?$/;

/** A typed coordinate: a decimal comma is accepted as a point; anything but plain decimal digits (1e1, 0x10, +4) is refused (null). */
export function parseCoordinate(value: string): number | null {
  const v = value.trim().replace(",", ".");
  return COORD_RE.test(v) ? Number(v) : null;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const E164_RE = /^\+[1-9]\d{7,14}$/;
export const LIMITS = { about: 2000, services: 2000, address: 300 } as const;

function codePoints(s: string): number {
  return Array.from(s).length;
}

/** Inline validation: the same rules as the database, stated per field. Keys: about.en, services.fr, address, latlng, contact_phone, contact_whatsapp, hours.mon. */
export function validateForm(form: EditorFormState): EditorErrors {
  const errors: EditorErrors = {};
  const text = (key: string, value: string, field: keyof typeof LIMITS, lang?: PageContentLanguage) => {
    if (/[<>]/.test(value)) errors[key] = { code: "angle", field, lang };
    else if (codePoints(value.trim()) > LIMITS[field]) errors[key] = { code: "tooLong", field, lang };
  };
  for (const l of PAGE_CONTENT_LANGUAGES) {
    text(`about.${l}`, form.about[l] ?? "", "about", l);
    text(`services.${l}`, form.services[l] ?? "", "services", l);
  }
  text("address", form.address, "address");

  const lat = form.lat.trim();
  const lng = form.lng.trim();
  if ((lat === "") !== (lng === "")) {
    errors.latlng = { code: "latlngPair" };
  } else if (lat !== "") {
    const a = parseCoordinate(lat);
    const b = parseCoordinate(lng);
    if (a === null || b === null) errors.latlng = { code: "latlngNumber" };
    else if (a < -90 || a > 90 || b < -180 || b > 180) errors.latlng = { code: "latlngRange" };
  }

  if (form.phone.trim() !== "" && !E164_RE.test(form.phone.trim())) errors.contact_phone = { code: "phone" };
  if (form.whatsapp.trim() !== "" && !E164_RE.test(form.whatsapp.trim())) errors.contact_whatsapp = { code: "phone" };

  for (const d of PAGE_HOURS_DAYS) {
    const day = form.hours[d];
    if (day.closed) continue;
    if (!TIME_RE.test(day.open) || !TIME_RE.test(day.close)) errors[`hours.${d}`] = { code: "hoursTime" };
    else if (day.open === day.close) errors[`hours.${d}`] = { code: "hoursEqual" };
  }
  return errors;
}

/** Which language tab holds the first error (about/services), so a refused save can select it. */
export function firstErrorLanguage(errors: EditorErrors): PageContentLanguage | null {
  for (const l of PAGE_CONTENT_LANGUAGES) {
    if (errors[`about.${l}`] || errors[`services.${l}`]) return l;
  }
  return null;
}

/** Languages whose tab holds an error (for "Needs attention"). */
export function languagesWithErrors(errors: EditorErrors): Set<PageContentLanguage> {
  const out = new Set<PageContentLanguage>();
  for (const l of PAGE_CONTENT_LANGUAGES) if (errors[`about.${l}`] || errors[`services.${l}`]) out.add(l);
  return out;
}

export function hasOpenDay(form: EditorFormState): boolean {
  return PAGE_HOURS_DAYS.some((d) => !form.hours[d].closed);
}

/** The `set_gym_page_content` input. Every field is sent (a patch whose unchanged fields the database ignores); text is cleaned first. */
export function toSaveInput(raw: EditorFormState): unknown {
  const form = cleanForm(raw);
  const content: Record<string, unknown> = {};
  for (const l of PAGE_CONTENT_LANGUAGES) {
    content[`about_${l}`] = form.about[l];
    content[`services_${l}`] = form.services[l];
  }
  content.address = form.address;
  const lat = form.lat.trim();
  const lng = form.lng.trim();
  content.lat = lat === "" ? null : parseCoordinate(lat);
  content.lng = lng === "" ? null : parseCoordinate(lng);
  content.contact_phone = form.phone.trim();
  content.contact_whatsapp = form.whatsapp.trim();
  if (hasOpenDay(form)) {
    const hours: Record<string, { open: string; close: string } | null> = {};
    for (const d of PAGE_HOURS_DAYS) hours[d] = form.hours[d].closed ? null : { open: form.hours[d].open, close: form.hours[d].close };
    content.hours = hours;
  } else {
    content.hours = null;
  }
  return { content, plans: Object.entries(form.plans).map(([plan_id, is_public]) => ({ plan_id, is_public })) };
}

/** Removing a language clears its two fields and nothing else. */
export function removeLanguageInput(lang: PageContentLanguage): unknown {
  return { content: { [`about_${lang}`]: null, [`services_${lang}`]: null } };
}

/** True when the input passes the same Zod schema the service re-checks. */
export function isSaveInputValid(input: unknown): boolean {
  return setGymPageContentSchema.safeParse(input).success;
}

/** About counter: characters after trim, in code points. */
export function aboutCharacters(value: string): number {
  return codePoints(value.trim());
}
