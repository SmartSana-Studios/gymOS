import { z } from "zod";

// Matches the `gym_status` Postgres enum (0001_extensions_and_enums.sql) exactly.
export const gymStatusSchema = z.enum(["active", "suspended", "deactivated"]);

// Gym category (gyms.category, 0123, FR-171). Stable codes are stored; labels
// are never stored and live here so both apps and the audit trail agree. The
// column is descriptive only (FR-172): nothing branches on it. "Other" has no
// free-text companion in V1.6.
export const GYM_CATEGORIES = [
  "gym",
  "pilates_studio",
  "yoga_studio",
  "fitness_center",
  "other",
] as const;

export type GymCategory = (typeof GYM_CATEGORIES)[number];

export const DEFAULT_GYM_CATEGORY: GymCategory = "gym";

export const gymCategorySchema = z.enum(GYM_CATEGORIES, {
  error: "Select a category",
});

export const GYM_CATEGORY_LABELS: Record<GymCategory, { en: string; fr: string }> = {
  gym: { en: "Gym", fr: "Salle de sport" },
  pilates_studio: { en: "Pilates Studio", fr: "Studio Pilates" },
  yoga_studio: { en: "Yoga Studio", fr: "Studio Yoga" },
  fitness_center: { en: "Fitness Center", fr: "Centre de fitness" },
  other: { en: "Other", fr: "Autre" },
};

/** Label for a stored code in the given language; an unknown code is shown as-is. */
export function gymCategoryLabel(code: string, locale: string): string {
  if (!Object.hasOwn(GYM_CATEGORY_LABELS, code)) return code;
  const entry = GYM_CATEGORY_LABELS[code as GymCategory];
  return locale.toLowerCase().startsWith("fr") ? entry.fr : entry.en;
}

// E.164: leading '+', country code, up to 15 digits total, no spaces/punctuation.
export const e164Phone = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Enter a valid phone number");

// Single source of truth for the Create Gym form (SA-04), consumed client-side
// (submit-time feedback) and server-side (createGym Server Action, which never
// trusts client input) per architecture's Process Patterns.
//
// `ownerEmail` is not part of SA-04's literal mockup (Gym Name / Owner Name /
// Owner Phone / Tier / Status only) — added because the owner's account is
// authenticated via Supabase email+password (matching the already-scaffolded
// AD-01/SA-01 login forms), which has no email-less path. See story 1-5's Dev
// Notes → Open Question 2.
export const createGymSchema = z.object({
  // Names are saved and shown in capitals (0159); upper-casing here makes the welcome message and the audit entry
  // carry the same text the database will store.
  gymName: z.string().trim().min(1, "Gym name is required").transform((v) => v.toUpperCase()),
  ownerName: z.string().trim().min(1, "Owner name is required").transform((v) => v.toUpperCase()),
  ownerPhone: e164Phone,
  ownerEmail: z.email("Enter a valid email address"),
  tierId: z.uuid("Select a subscription tier"),
  // ISO 3166-1 alpha-2 country of the gym (gyms.country, 0105): the default
  // region for phone numbers entered without a country code. Defaulted so a
  // caller that predates the field keeps working; membership in the real
  // country list is re-checked server-side in createGym.
  country: z.string().regex(/^[A-Z]{2}$/, "Select a country").default("CM"),
  // Stable category code (gyms.category, 0123). Defaulted like country so a
  // caller that predates the field keeps working. createGym parses this schema
  // before its first write and the DB CHECK is the backstop.
  category: gymCategorySchema.default("gym"),
  status: gymStatusSchema.default("active"),
  /**
   * Story 1.17 code review. Proof the Super Admin was shown WHICH existing
   * account the gym would be assigned to, and accepted it. `createGym`
   * refuses to link without this, because linking cannot be undone through
   * the UI: `super_admin_delete_orphaned_gyms` (0010) only permits deleting
   * gyms with no members, and linking creates one. Absent/false on the
   * ordinary new-owner path, which needs no confirmation.
   */
  confirmLinkExistingOwner: z.boolean().optional().default(false),
});

export type CreateGymInput = z.infer<typeof createGymSchema>;

// Shared minimum length for every free-text audit "reason" field in this
// schema file (gymStatusChangeSchema, escalateGymAccessSchema,
// applyCreditSchema below) -- factored into one constant so the length
// policy can't drift between them while each still keeps its own
// action-specific error copy. Exported for Story 11.5's applyCreditSchema.
export const REASON_MIN_LENGTH = 5;

// Ceiling for the two escalation-lifecycle reasons (Story 1.15 code review).
// Neither had a maximum at any layer, so unbounded text could be stored in
// gym_data_escalations.reason/revoke_reason and in audit_log metadata, then
// rendered raw in the trail. Mirrored in 0086's RPCs, because both are
// reachable directly over PostgREST by any authenticated Super Admin session
// and not only through the app's forms. Deliberately NOT applied to the other
// reason fields in this file: those predate the rule and widening it is a
// separate change with its own copy decisions.
export const REASON_MAX_LENGTH = 500;

// Story 1.6: suspend/deactivate/reinstate all require a reason (AC #3,
// audit-logged). The target status isn't part of this schema -- it's implied
// by which Server Action is called (suspendGym/deactivateGym/reinstateGym),
// closing off an invalid-transition class entirely rather than validating a
// free-form target-status field.
export const gymStatusChangeSchema = z.object({
  reason: z.string().trim().min(REASON_MIN_LENGTH, "Add a reason describing this change"),
});

export type GymStatusChangeInput = z.infer<typeof gymStatusChangeSchema>;

// SA-03: Super Admin can move a gym to a different tier (existing members
// are not automatically reclassified, AC #1) or override its effective
// member cap (null clears the override, reverting to the tier's own cap).
export const changeGymTierSchema = z.object({
  tierId: z.uuid("Select a subscription tier"),
});

export type ChangeGymTierInput = z.infer<typeof changeGymTierSchema>;

export const overrideGymCapSchema = z.object({
  capOverride: z
    .number()
    .int()
    .positive("Enter a positive number")
    .max(2147483647, "Value is too large")
    .nullable(),
});

export type OverrideGymCapInput = z.infer<typeof overrideGymCapSchema>;

export const renameGymSchema = z.object({
  name: z.string().trim().min(2, "Gym name is required").max(120, "Gym name is too long"),
});

export type RenameGymInput = z.infer<typeof renameGymSchema>;

// Validates the `gymId` positional argument on the lifecycle/tier/cap
// Server Actions below -- the payload schemas above only cover the request
// body, not the id itself.
export const gymIdSchema = z.uuid("Invalid gym id");

// Story 1.7 (FR-072): "Access gym data" escalation requires a mandatory
// reason, audit-logged with the Super Admin's identity/reason/timestamp.
// Shares gymStatusChangeSchema's REASON_MIN_LENGTH policy (one constant, so
// the two can't silently drift) but keeps its own name/error copy -- this
// action-intent (why you're viewing a gym's private data) reads differently
// from a lifecycle status change at every call site.
export const escalateGymAccessSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(REASON_MIN_LENGTH, "Add a reason describing why you need access")
    .max(REASON_MAX_LENGTH, "Reason is too long"),
});

// SA-03 "Edit owner contact": the owner account's sign-in email and/or phone. A blank field means "keep it"; at least
// one must be given. The reason is audited, like every other Super Admin write on a gym.
export const changeOwnerContactSchema = z
  .object({
    email: z.union([z.literal(""), z.email("Enter a valid email address")]).optional(),
    phone: z.union([z.literal(""), e164Phone]).optional(),
    reason: z
      .string()
      .trim()
      .min(REASON_MIN_LENGTH, "Add a reason for this change")
      .max(REASON_MAX_LENGTH, "Reason is too long"),
  })
  .refine((v) => Boolean(v.email) || Boolean(v.phone), { message: "Enter a new email or a new phone", path: ["email"] });

// SA-03 "Resend invitation": a new temporary password for the owner account, with the reason audited.
export const resendOwnerInvitationSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(REASON_MIN_LENGTH, "Add a reason for this change")
    .max(REASON_MAX_LENGTH, "Reason is too long"),
});

export type ResendOwnerInvitationInput = z.infer<typeof resendOwnerInvitationSchema>;

export type ChangeOwnerContactInput = z.infer<typeof changeOwnerContactSchema>;

export type EscalateGymAccessInput = z.infer<typeof escalateGymAccessSchema>;

// Story 1.15: revoking another Super Admin's active escalation grant also
// requires a mandatory reason, audit-logged with the revoking admin's
// identity and the target admin as the subject. Deliberately its own schema
// rather than reusing escalateGymAccessSchema, following this file's
// one-schema-per-action-intent convention (see the note above): "why you
// need access" and "why you are taking someone else's access away" are
// different questions, read at different call sites, and their error copy
// should be free to diverge. The REASON_MIN_LENGTH policy stays shared so
// the length rule cannot drift between them.
export const revokeGymAccessSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(REASON_MIN_LENGTH, "Add a reason describing why you are revoking this access")
    .max(REASON_MAX_LENGTH, "Reason is too long"),
});

export type RevokeGymAccessInput = z.infer<typeof revokeGymAccessSchema>;

// Story 1.9 (FR-069): Settings page field validation, copy taken
// character-for-character from EXPERIENCE.md's AD-13 field table. `capacity`
// here is `gyms.capacity` (FR-046 occupancy denominator) -- NOT
// `gyms.member_cap_override` (Story 1.6, tier-based member ceiling); the two
// columns are unrelated despite the similar naming. The `gyms.capacity`
// column itself stays nullable (existing gyms provisioned before this story
// may have capacity = null) -- this is form-level "required" only, no DB
// constraint added.
export const gymSettingsSchema = z.object({
  gymName: z.string().trim().min(2, "Gym name is required").max(120, "Gym name is too long"),
  // Only null (no logo) or a URL under this bucket's own public object path
  // is accepted -- `uploadGymLogo` is the only legitimate producer of this
  // value, so this rejects an arbitrary/data:/blob: string submitted by
  // calling this schema directly, bypassing the upload flow.
  logoUrl: z
    .url()
    .refine((url) => url.includes("/storage/v1/object/public/gym-logos/"), {
      message: "Logo URL must come from the gym-logos upload flow",
    })
    .nullable(),
  // `gyms.primary_color` is nullable with no default -- gyms provisioned
  // before this story (or that simply haven't set a color yet) must still be
  // able to save every other field without being forced to pick a color.
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Enter a valid hex colour (e.g. #E0971F)")
    .nullable(),
  timezone: z.enum(["Africa/Douala", "Africa/Lagos", "Africa/Bangui", "Africa/Kinshasa", "UTC"]),
  defaultLanguage: z.enum(["en", "fr"]),
  // ISO 3166-1 alpha-2, the default region for reading phone numbers written
  // without a country code (CSV import). Membership in the real country list
  // is re-checked server-side in saveGymSettings.
  country: z.string().regex(/^[A-Z]{2}$/, "Select a country"),
  gracePeriodDays: z.number().int().min(1, "Grace period must be between 1 and 30 days").max(30, "Grace period must be between 1 and 30 days"),
  capacity: z.number().int().positive("Enter the gym's member capacity").max(2147483647, "Value is too large"),
  alertAutoDismissMinutes: z.number().int().min(1, "Auto-dismiss must be between 1 and 120 minutes").max(120, "Auto-dismiss must be between 1 and 120 minutes"),
  checkinTimeoutHours: z.number().int().min(1, "Check-in timeout must be between 1 and 24 hours").max(24, "Check-in timeout must be between 1 and 24 hours"),
  // Opening hours ("HH:MM", gym-local). null = not set (quiet-gym alerts then use 06:00-22:00). An overnight window
  // (opening later than closing) is allowed, so no ordering rule.
  openingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid time").nullable(),
  closingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid time").nullable(),
});

export type GymSettingsInput = z.infer<typeof gymSettingsSchema>;

// Story 24.5 (FR-197, FR-200): public page content and per-plan visibility. Mirrors set_gym_page_content() (0161), which
// validates the same rules again. Both are patches: a key left out is not touched, null clears it. Text is trimmed and an
// empty string becomes null; '<' and '>' are rejected so no markup is stored. Unknown keys are rejected (strict).
const pageText = (max: number) =>
  z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().max(max, "Too long").regex(/^[^<>]*$/, "Remove < and >"))
    .transform((v) => (v === "" ? null : v))
    .nullable();

const pageTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid time");

const pageDayHours = z
  .strictObject({ open: pageTime, close: pageTime })
  .refine((d) => d.open !== d.close, "Opening and closing time must differ")
  .nullable();

export const PAGE_HOURS_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export const gymPageHoursSchema = z.strictObject({
  mon: pageDayHours.optional(),
  tue: pageDayHours.optional(),
  wed: pageDayHours.optional(),
  thu: pageDayHours.optional(),
  fri: pageDayHours.optional(),
  sat: pageDayHours.optional(),
  sun: pageDayHours.optional(),
})
  .refine((h) => Object.keys(h).length > 0, "Add at least one day, or clear the hours with null");

// Public contact numbers are separate from the Owner's login phone; an empty string clears the field.
const pagePhone = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.union([z.literal(""), e164Phone]))
  .transform((v) => (v === "" ? null : v))
  .nullable();

export const gymPageContentSchema = z.strictObject({
  about_en: pageText(2000).optional(),
  about_fr: pageText(2000).optional(),
  services_en: pageText(2000).optional(),
  services_fr: pageText(2000).optional(),
  address: pageText(300).optional(),
  city: pageText(100).optional(),
  lat: z.number().min(-90, "Latitude must be between -90 and 90").max(90, "Latitude must be between -90 and 90").nullable().optional(),
  lng: z.number().min(-180, "Longitude must be between -180 and 180").max(180, "Longitude must be between -180 and 180").nullable().optional(),
  hours: gymPageHoursSchema.nullable().optional(),
  contact_phone: pagePhone.optional(),
  contact_whatsapp: pagePhone.optional(),
});

export type GymPageContentInput = z.infer<typeof gymPageContentSchema>;

export const publicPlanSchema = z.strictObject({
  plan_id: z.uuid(),
  is_public: z.boolean().optional(),
  public_label_en: pageText(80).optional(),
  public_label_fr: pageText(80).optional(),
});

export type PublicPlanInput = z.infer<typeof publicPlanSchema>;

export const setGymPageContentSchema = z.strictObject({
  content: gymPageContentSchema,
  plans: z
    .array(publicPlanSchema)
    .refine((plans) => new Set(plans.map((p) => p.plan_id)).size === plans.length, "A plan appears twice")
    .optional(),
});

export type SetGymPageContentInput = z.infer<typeof setGymPageContentSchema>;

// Story 24.6 (FR-205, AD-47): page media. Mirrors register_page_media() (0162) and the dashboard server function in
// apps/dashboard/services/page-media.ts. Content is judged by decoded bytes there, never by these client-sent fields.
export const PAGE_MEDIA_KINDS = ["logo", "banner", "gallery"] as const;
export const pageMediaKindSchema = z.enum(PAGE_MEDIA_KINDS);
export type PageMediaKind = z.infer<typeof pageMediaKindSchema>;

/** Typed refusals of the page media upload. Copy lives in apps/dashboard/locales under `pageMedia.errors.<code>`. */
export const PAGE_MEDIA_ERROR_CODES = [
  "unsupported_type",
  "too_large",
  "too_many_pixels",
  "limit_reached",
  "attestation_required",
  "not_admitted",
] as const;
export type PageMediaErrorCode = (typeof PAGE_MEDIA_ERROR_CODES)[number];

export const PAGE_MEDIA_MAX_BYTES = 4 * 1024 * 1024;
export const PAGE_MEDIA_MAX_INPUT_PIXELS_SIDE = 4096;
export const PAGE_MEDIA_MAX_GALLERY = 12;
/** Longest side of the derivative: 1600 px for banner and gallery, 512 px for the logo. */
export const PAGE_MEDIA_DERIVATIVE_SIDE: Record<PageMediaKind, number> = { logo: 512, banner: 1600, gallery: 1600 };
/** Version of the attestation text the uploader agreed to; stored with every row. */
export const PAGE_MEDIA_ATTESTATION_VERSION = "2026-11-v1";

export const uploadPageMediaFieldsSchema = z.strictObject({
  gymId: z.uuid(),
  kind: pageMediaKindSchema,
  attested: z.literal(true),
});
export type UploadPageMediaFields = z.infer<typeof uploadPageMediaFieldsSchema>;

export const pageMediaRowSchema = z.object({
  id: z.uuid(),
  gym_id: z.uuid(),
  kind: pageMediaKindSchema,
  derivative_key: z.string(),
  sort_order: z.number().int(),
  deleted_at: z.string().nullable(),
});
export type PageMediaRow = z.infer<typeof pageMediaRowSchema>;

// Story 18.1: one-time registration fee, whole XAF, 0 = off. Validated
// separately from gymSettingsSchema on purpose -- the fee is saved through its
// own set_registration_fee() RPC (owner/supervisor, audited), never through the
// owner_update_own_gym path saveGymSettings uses. The database enforces
// `check (registration_fee >= 0)`; the integer ceiling matches the column type.
export const registrationFeeSchema = z
  .number()
  .int("Enter a whole amount of 0 or more")
  .min(0, "Enter a whole amount of 0 or more")
  .max(2147483647, "Value is too large");

export type RegistrationFeeInput = z.infer<typeof registrationFeeSchema>;

// Story 11.5 (FR-134/FR-136): Super Admin grants a gym a credit / free
// period. `days` is always a resolved day count by the time this schema
// validates it -- SA-07's "grants N days or one billing cycle free" is
// resolved to a concrete number by the UI/Server Action layer before this
// schema ever sees it (e.g. "one cycle" -> 30/365 or the gym's own
// saas_billing_interval); `apply_saas_billing_credit()` itself has no
// notion of "one cycle", only a day count. Reason is mandatory, matching
// SA-07's confirm-dialog copy ("Reason: [________]") and
// gymStatusChangeSchema's identical reason-required pattern.
// Review fix: 90 days (one quarter) is the ceiling a Super Admin can grant in
// a single credit -- user decision at code review, closing an unbounded
// "typed 3000 instead of 30" risk the original schema left open. A repeat
// grant beyond a quarter is a deliberate, visible action rather than one
// unbounded confirm click.
export const APPLY_CREDIT_MAX_DAYS = 90;

export const applyCreditSchema = z.object({
  days: z.number().int().positive().max(APPLY_CREDIT_MAX_DAYS, "Enter a positive number of days"),
  reason: z.string().trim().min(REASON_MIN_LENGTH, "Add a reason describing this credit"),
});

export type ApplyCreditInput = z.infer<typeof applyCreditSchema>;

// SA-03 Category change and 21.2's Settings field: the payload of
// set_gym_category() minus the gym id (taken from the route / session).
export const setGymCategorySchema = z.object({ category: gymCategorySchema });
export type SetGymCategoryInput = z.infer<typeof setGymCategorySchema>;

// Story 24.7 (FR-202/203, AD-45): page names. Mirrors claim_page_name() and decide_held_page_name() (0163). The Owner screen is 24.9;
// the held-names screen for Super Admin is apps/super-admin/app/(admin)/page-names. The database re-validates every rule.
export const PAGE_NAME_MIN_LENGTH = 3;
export const PAGE_NAME_MAX_LENGTH = 30;

/** FR-202 grammar: 3-30 of a-z0-9-, no leading/trailing hyphen, no `--` (so no `xn--`), not digits only. */
export function isValidPageName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(name) && !name.includes("--") && !/^[0-9]+$/.test(name);
}

/** Trimmed and lowercased as claim_page_name() does, then checked against the grammar. */
export const pageNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(isValidPageName, "Use 3 to 30 lowercase letters, digits or hyphens, with no leading, trailing or double hyphen, and not digits only");

export const claimPageNameSchema = z.strictObject({ gymId: z.uuid(), name: pageNameSchema });
export type ClaimPageNameInput = z.infer<typeof claimPageNameSchema>;

/** Typed refusals of the claim. Copy lives in apps/dashboard/locales under `pageNames.errors.<code>`. */
export const PAGE_NAME_ERROR_CODES = ["invalid_name", "reserved_name", "name_taken", "rename_limit", "not_admitted", "gym_not_active"] as const;
export type PageNameErrorCode = (typeof PAGE_NAME_ERROR_CODES)[number];

/** Typed refusals of a Super Admin decision. Copy lives in apps/super-admin/locales under `pageNames.errors.<code>`. */
export const PAGE_NAME_DECISION_ERROR_CODES = ["reason_required", "not_held", "reserved_name", "name_taken"] as const;
export type PageNameDecisionErrorCode = (typeof PAGE_NAME_DECISION_ERROR_CODES)[number];

export const PAGE_NAME_DECISION_REASON_MIN = 3;
export const PAGE_NAME_DECISION_REASON_MAX = 500;

export const decideHeldPageNameSchema = z.strictObject({
  id: z.uuid(),
  approve: z.boolean(),
  reason: z.string().trim().min(PAGE_NAME_DECISION_REASON_MIN).max(PAGE_NAME_DECISION_REASON_MAX),
});
export type DecideHeldPageNameInput = z.infer<typeof decideHeldPageNameSchema>;

export const PAGE_NAME_STATES = ["held", "active", "reserved", "redirect", "released"] as const;
export type PageNameState = (typeof PAGE_NAME_STATES)[number];

/** claim_page_name() result. A held name is not an error: the Owner sees "under review". */
export const claimPageNameResultSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  state: z.enum(["held", "active"]),
  origin: z.enum(["claim", "rename", "forced_rename"]),
  previous_name: z.string().nullable(),
});
export type ClaimPageNameResult = z.infer<typeof claimPageNameResultSchema>;

/** get_gym_page_name() result. Carries no held_reason and no other gym's name. */
export const gymPageNameSchema = z.object({
  name: z.string().nullable(),
  state: z.enum(["none", "active", "reserved", "held"]),
  pending_name: z.string().nullable(),
  completed_renames: z.number().int(),
  redirects: z.array(z.object({ name: z.string(), expires_at: z.string() })),
});
export type GymPageName = z.infer<typeof gymPageNameSchema>;
