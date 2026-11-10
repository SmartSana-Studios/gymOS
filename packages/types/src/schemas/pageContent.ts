import { z } from "zod";
import { PAGE_CONTENT_LANGUAGES, PAGE_MEDIA_MAX_GALLERY, type PageContentLanguage, e164Phone, gymCategorySchema, gymPageHoursSchema, pageContentLanguageSchema, pageTemplateSchema } from "./gym";

// Story 24.10 (AD-48): PageContentV1, the one shape a public page template renders. The landing app parses the stored row with it on EVERY
// render and fails closed (the uniform not-found, logged without gym data) on any mismatch: an extra key, a wrong type, another
// schema_version, a template that is not registered. It is the snapshot the database builds (private.gym_page_snapshot, 0166) wrapped
// with `template` and `schema_version`, so a CI test renders ONE fixture snapshot with this schema and checks the same document against
// the pgTAP key list (packages/types/src/fixtures/pageSnapshotV1.json). A content change ships as a new version plus a migration of the
// stored snapshots, never an in-place edit; the reader accepts exactly version 1.

export const PAGE_CONTENT_SCHEMA_VERSION = 1 as const;

/** A derivative key as register_page_media() writes it (0162): 36 characters of [0-9a-f-] and `.webp`. It is appended to a media URL path. */
export const PAGE_MEDIA_KEY_PATTERN = /^[0-9a-f-]{36}\.webp$/;
const mediaKey = z.string().regex(PAGE_MEDIA_KEY_PATTERN);

export const PAGE_PLAN_TYPES = ["pay_per_session", "monthly", "coach_inclusive", "class_only"] as const;
export const PAGE_BILLING_INTERVALS = ["monthly", "annual"] as const;

export const pageContentPlanSchema = z.strictObject({
  /** The name as the Owner entered it: never translated, identical in every language. */
  name: z.string().min(1),
  label_en: z.string(),
  label_fr: z.string(),
  type: z.enum(PAGE_PLAN_TYPES),
  price: z.number().int().min(0),
  /** Printed as stored, never converted. */
  currency: z.string().min(1).max(10),
  interval: z.enum(PAGE_BILLING_INTERVALS),
  duration_days: z.number().int().positive().nullable().optional(),
});
export type PageContentPlan = z.infer<typeof pageContentPlanSchema>;

/** The snapshot document (private.gym_page_snapshot): the keys of pageSnapshotSchema with the types the templates rely on. Strict. */
export const pageContentSnapshotV1Schema = z.strictObject({
  name: z.string().min(1),
  default_language: pageContentLanguageSchema,
  about_en: z.string().min(1).optional(),
  about_fr: z.string().min(1).optional(),
  services_en: z.string().min(1).optional(),
  services_fr: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  category: gymCategorySchema.optional(),
  map: z
    .strictObject({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .optional(),
  contact: z.strictObject({ phone: e164Phone.optional(), whatsapp: e164Phone.optional() }).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logo: mediaKey.optional(),
  banner: mediaKey.optional(),
  gallery: z.array(mediaKey).max(PAGE_MEDIA_MAX_GALLERY).optional(),
  hours: gymPageHoursSchema.optional(),
  plans: z.array(pageContentPlanSchema).optional(),
});
export type PageContentSnapshotV1 = z.infer<typeof pageContentSnapshotV1Schema>;

export const pageContentV1Schema = z.strictObject({
  template: pageTemplateSchema,
  schema_version: z.literal(PAGE_CONTENT_SCHEMA_VERSION),
  content: pageContentSnapshotV1Schema,
});
export type PageContentV1 = z.infer<typeof pageContentV1Schema>;

/** The row the public site reads: `public_site.pages` minus what the page does not need (no id, no timestamps). */
export interface PageRowInput {
  template: unknown;
  schema_version: unknown;
  content: unknown;
}

export type ParsedPageContent = { ok: true; value: PageContentV1 } | { ok: false; issues: string[] };

/**
 * Parse a stored row. A failure carries only the PATHS of the issues (for the log), never a value: a mismatch must not copy gym text into
 * a log line. `issues` are like `content.plans.0.price: invalid_type`.
 */
export function parsePageContentV1(row: PageRowInput): ParsedPageContent {
  const parsed = pageContentV1Schema.safeParse({ template: row.template, schema_version: row.schema_version, content: row.content });
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.code}`) };
}

/** Complete languages = those whose About is present in the snapshot (owner decision 2026-11-08; the database omits an incomplete About). */
export function completePageLanguages(content: PageContentSnapshotV1): PageContentLanguage[] {
  return PAGE_CONTENT_LANGUAGES.filter((l) => {
    const about = (content as Record<string, unknown>)[`about_${l}`];
    return typeof about === "string" && about.trim().length > 0;
  });
}
