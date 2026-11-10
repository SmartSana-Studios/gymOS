import type { GymPageStatus, PageBadTextFieldEntry, PageContentLanguage } from "@gymos/types";

// Story 24.9. Words for the server's codes. The status function returns facts (codes, field names); the screens turn them into
// sentences here, in one place, so a new gate code is one entry in each locale and one test.

export type T = (key: string, options?: Record<string, unknown>) => string;

export function languageName(t: T, lang: PageContentLanguage): string {
  return t(`pageEditor.languages.${lang}`);
}

/** "About (English)", "Gym name", `Plan "Monthly", name`. */
export function badFieldLabel(t: T, e: PageBadTextFieldEntry): string {
  if (e.field === "plan_name") return t("pageEditor.fieldPlan", { name: e.plan_name ?? "" });
  const base = t(`pageEditor.fields.${e.field}`);
  return e.lang ? t("pageEditor.fieldWithLanguage", { field: base, language: languageName(t, e.lang) }) : base;
}

function badFields(t: T, status: Pick<GymPageStatus, "bad_text_fields">): string {
  const labels = status.bad_text_fields.map((f) => badFieldLabel(t, f));
  return labels.length > 0 ? labels.join(", ") : t("pageEditor.fieldsFallback");
}

/** The sentence after the colon of an "offline" banner: `gate.<code>` (and `gate.name_released`). */
export function reasonLine(t: T, code: string, status: Pick<GymPageStatus, "bad_text_fields">): string {
  return t(`pageEditor.gate.${code}`, { field: code === "bad_text" ? badFields(t, status) : "" });
}

/** One line of a "not ready" list (publish failure, in-progress checklist): `gateItem.<code>`. */
export function itemLine(t: T, code: string, status: Pick<GymPageStatus, "bad_text_fields">): string {
  return t(`pageEditor.gateItem.${code}`, { field: code === "bad_text" ? badFields(t, status) : "" });
}

/** Plan price with its own currency, never converted: "15,000 XAF". */
export function formatPrice(amount: number, currency: string, locale: string): string {
  return `${new Intl.NumberFormat(locale).format(amount)} ${currency}`;
}

export function pageMediaUrl(key: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/gym-page-media/${key}`;
}
