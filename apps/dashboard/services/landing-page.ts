import { createClient } from "@/lib/supabase/server";
import {
  PAGE_CONTENT_LANGUAGES,
  claimPageNameResultSchema,
  cleanPageText,
  gymPageNameSchema,
  gymPageStatusSchema,
  pageNameSchema,
  publishGymPageResultSchema,
  setGymPageContentSchema,
  submitPageAppealSchema,
  PAGE_APPEAL_ERROR_CODES,
  type AppError,
  type PageAppealErrorCode,
  type ClaimPageNameResult,
  type GymPageName,
  type GymPageStatus,
  type PageContentErrorCode,
  type PageContentLanguage,
  type PageNameErrorCode,
  type PagePublishErrorCode,
  type PublishGymPageResult,
} from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { isOfferedTemplate } from "@/lib/pageTemplates";
import { rebuildPurgedMedia, type RebuiltMedia } from "@/services/page-media";

// Story 24.9 (FR-197..FR-201). The dashboard's service for the landing-page editor and publish screens. Every call goes through the
// database functions of 24.5 to 24.9 as the signed-in user: the database admits the caller (Owner, Supervisor, live-assigned support)
// and re-judges every rule. The functions in this file read the gym id from the session claims and take none from the browser. (The
// image actions in page-media-actions.ts do receive a gym id from the browser; there the database checks it against the caller.)

/** The editor's view of the gym's own page fields (the content that `set_gym_page_content` writes). Strings are what the form edits. */
export interface LandingPageContent {
  about: Record<PageContentLanguage, string>;
  services: Record<PageContentLanguage, string>;
  address: string;
  city: string;
  lat: string;
  lng: string;
  /** Keys mon..sun, each null (closed) or {open, close}; null when never set. */
  hours: Record<string, { open: string; close: string } | null> | null;
  contactPhone: string;
  contactWhatsapp: string;
  country: string;
  category: string;
  defaultLanguage: PageContentLanguage;
}

export interface LandingPagePlan {
  id: string;
  name: string;
  planType: string;
  price: number;
  currency: string;
  billingInterval: string;
  durationDays: number | null;
  isPublic: boolean;
}

export type LandingPageRole = "owner" | "supervisor" | "support";

export interface LandingPageData {
  gymId: string;
  role: LandingPageRole;
  status: GymPageStatus;
  pageName: GymPageName;
  content: LandingPageContent;
  plans: LandingPagePlan[];
}

type ServiceResult<T> = Promise<{ data: T | null; error: AppError | null }>;

// -------------------------------------------------------------------------------------------------------------------------------
// Typed error mappers. The database raises bare `permission denied` and `<function>: gym <id> is not active`; both are exact-shape
// matches so a Postgres privilege fault (`permission denied for table ...`) is NOT reported as "you are not allowed".
// -------------------------------------------------------------------------------------------------------------------------------

const NOT_ADMITTED_MESSAGE = "permission denied";

function isNotActive(message: string, fn: string): boolean {
  return new RegExp(`^${fn}: gym \\S+ is not active$`).test(message);
}

/** claim_page_name (0163, 0167): invalid_name, reserved_name, name_taken, rename_limit, page_taken_down (24.11), `permission denied`, `gym <id> is not active`. */
export function pageNameCodeFromDbError(error: { message?: string } | null | undefined): PageNameErrorCode | null {
  const message = error?.message ?? "";
  if (message === NOT_ADMITTED_MESSAGE) return "not_admitted";
  if (isNotActive(message, "claim_page_name")) return "gym_not_active";
  for (const code of ["invalid_name", "reserved_name", "name_taken", "rename_limit", "page_taken_down"] as const) {
    if (message === `claim_page_name: ${code}`) return code;
  }
  return null;
}

/** publish_gym_page (0164): taken_down, template_required, invalid_template, `permission denied`, `gym <id> is not active`. */
export function pagePublishCodeFromDbError(error: { message?: string } | null | undefined): PagePublishErrorCode | null {
  const message = error?.message ?? "";
  if (message === NOT_ADMITTED_MESSAGE) return "not_admitted";
  if (isNotActive(message, "publish_gym_page")) return "gym_not_active";
  for (const code of ["taken_down", "template_required", "invalid_template"] as const) {
    if (message === `publish_gym_page: ${code}`) return code;
  }
  return null;
}

/** set_gym_page_content (0161): `invalid_<field>`, `unknown_key`, `plan_not_in_gym` ..., `permission denied`, `gym <id> is not active`. */
export function pageContentCodeFromDbError(error: { message?: string } | null | undefined): PageContentErrorCode | null {
  const message = error?.message ?? "";
  if (message === NOT_ADMITTED_MESSAGE) return "not_admitted";
  if (isNotActive(message, "set_gym_page_content")) return "gym_not_active";
  if (/^set_gym_page_content: (invalid_[a-z_]+|unknown_key .+|unknown_plan_key .+|duplicate_plan_id|plan_not_in_gym)$/.test(message)) return "invalid_content";
  return null;
}

/** submit_page_appeal (0167): reason_required, not_taken_down, appeal_open, appeal_decided, `permission denied` (not the Owner). */
export function pageAppealCodeFromDbError(error: { message?: string } | null | undefined): PageAppealErrorCode | null {
  const message = error?.message ?? "";
  if (message === NOT_ADMITTED_MESSAGE) return "not_admitted";
  for (const code of PAGE_APPEAL_ERROR_CODES) {
    if (code !== "not_admitted" && message === `submit_page_appeal: ${code}`) return code;
  }
  return null;
}

async function typedError(scope: "pageEditor" | "pageNames" | "pagePublish" | "pageAppeal", code: string): Promise<AppError> {
  const { t } = await getServerTranslation(await getRequestLocale());
  return { code, message: t(`${scope}.errors.${code}`) };
}

// -------------------------------------------------------------------------------------------------------------------------------

type UserClient = Awaited<ReturnType<typeof createClient>>;

async function callerContext(supabase: UserClient): Promise<{ gymId: string; role: LandingPageRole } | { error: AppError }> {
  const { data, error } = await supabase.auth.getClaims();
  if (error) return { error: await mapAndLog(error) };
  const claims = data?.claims as { gym_id?: string; app_role?: string } | undefined;
  if (!claims?.gym_id) return { error: await typedError("pageEditor", "not_admitted") };
  if (claims.app_role !== "owner" && claims.app_role !== "supervisor" && claims.app_role !== "support") {
    return { error: await typedError("pageEditor", "not_admitted") };
  }
  return { gymId: claims.gym_id, role: claims.app_role };
}

const GYM_COLUMNS =
  "category, country, default_language, page_about_en, page_about_fr, page_services_en, page_services_fr, page_address, page_city, page_lat, page_lng, page_hours, page_contact_phone, page_contact_whatsapp";

function readHours(value: unknown): LandingPageContent["hours"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, { open: string; close: string } | null> = {};
  for (const [day, v] of Object.entries(value as Record<string, unknown>)) {
    if (v && typeof v === "object") {
      const { open, close } = v as { open?: unknown; close?: unknown };
      out[day] = typeof open === "string" && typeof close === "string" ? { open, close } : null;
    } else {
      out[day] = null;
    }
  }
  return out;
}

function perLanguage(row: Record<string, unknown>, prefix: "page_about_" | "page_services_"): Record<PageContentLanguage, string> {
  const out = {} as Record<PageContentLanguage, string>;
  for (const l of PAGE_CONTENT_LANGUAGES) {
    const v = row[`${prefix}${l}`];
    out[l] = typeof v === "string" ? v : "";
  }
  return out;
}

function toContent(row: Record<string, unknown>): LandingPageContent {
  const lang = row.default_language === "fr" ? "fr" : "en";
  return {
    about: perLanguage(row, "page_about_"),
    services: perLanguage(row, "page_services_"),
    address: typeof row.page_address === "string" ? row.page_address : "",
    city: typeof row.page_city === "string" ? row.page_city : "",
    lat: row.page_lat === null || row.page_lat === undefined ? "" : String(row.page_lat),
    lng: row.page_lng === null || row.page_lng === undefined ? "" : String(row.page_lng),
    hours: readHours(row.page_hours),
    contactPhone: typeof row.page_contact_phone === "string" ? row.page_contact_phone : "",
    contactWhatsapp: typeof row.page_contact_whatsapp === "string" ? row.page_contact_whatsapp : "",
    country: typeof row.country === "string" ? row.country : "",
    category: typeof row.category === "string" ? row.category : "",
    defaultLanguage: lang,
  };
}

/** Everything the editor and the publish screen render, from one server round: the status function, the name state, the gym's page
 * fields and its plans. The status function is the admission: a caller it refuses gets nothing else. */
export async function getLandingPageData(): ServiceResult<LandingPageData> {
  const supabase = await createClient();
  const caller = await callerContext(supabase);
  if ("error" in caller) return { data: null, error: caller.error };
  const { gymId, role } = caller;

  const { data: statusRaw, error: statusError } = await supabase.rpc("get_gym_page_status", { p_gym_id: gymId });
  if (statusError) {
    if (statusError.message === NOT_ADMITTED_MESSAGE) return { data: null, error: await typedError("pageEditor", "not_admitted") };
    return { data: null, error: await mapAndLog(statusError) };
  }
  const status = gymPageStatusSchema.safeParse(statusRaw);
  if (!status.success) {
    console.error("[landing-page] get_gym_page_status returned an unexpected shape", status.error.issues);
    return { data: null, error: await typedError("pageEditor", "load_failed") };
  }

  const [nameRes, gymRes, plansRes] = await Promise.all([
    supabase.rpc("get_gym_page_name", { p_gym_id: gymId }),
    supabase.from("gyms").select(GYM_COLUMNS).eq("id", gymId).maybeSingle(),
    supabase
      .from("plans")
      .select("id, name, plan_type, price, currency, billing_interval, duration_days, is_public")
      .eq("gym_id", gymId)
      .order("created_at", { ascending: true }),
  ]);
  if (nameRes.error) return { data: null, error: await mapAndLog(nameRes.error) };
  if (gymRes.error) return { data: null, error: await mapAndLog(gymRes.error) };
  if (plansRes.error) return { data: null, error: await mapAndLog(plansRes.error) };
  if (!gymRes.data) return { data: null, error: await typedError("pageEditor", "load_failed") };
  const pageName = gymPageNameSchema.safeParse(nameRes.data);
  if (!pageName.success) {
    console.error("[landing-page] get_gym_page_name returned an unexpected shape", pageName.error.issues);
    return { data: null, error: await typedError("pageEditor", "load_failed") };
  }

  return {
    data: {
      gymId,
      role,
      status: status.data,
      pageName: pageName.data,
      content: toContent(gymRes.data as unknown as Record<string, unknown>),
      plans: (plansRes.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        planType: p.plan_type,
        price: p.price,
        currency: p.currency,
        billingInterval: p.billing_interval,
        durationDays: p.duration_days,
        isPublic: p.is_public,
      })),
    },
    error: null,
  };
}

/** The page state alone, for the Settings row. Null when the caller is not admitted or the read fails (the row then shows no badge). */
export async function getLandingPageState(): Promise<GymPageStatus["state"] | null> {
  try {
    const supabase = await createClient();
    const caller = await callerContext(supabase);
    if ("error" in caller) return null;
    const { data, error } = await supabase.rpc("get_gym_page_status", { p_gym_id: caller.gymId });
    if (error) return null;
    const parsed = gymPageStatusSchema.safeParse(data);
    return parsed.success ? parsed.data.state : null;
  } catch {
    return null;
  }
}

const CLEANED_CONTENT_KEYS = ["about_en", "about_fr", "services_en", "services_fr", "address", "city"] as const;

/** CRLF and a lone CR become LF and control characters other than LF and tab go, in the free-text fields, before Zod and the call. */
export function cleanSaveInput(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const body = input as { content?: unknown };
  if (!body.content || typeof body.content !== "object") return input;
  const content = { ...(body.content as Record<string, unknown>) };
  for (const key of CLEANED_CONTENT_KEYS) {
    if (typeof content[key] === "string") content[key] = cleanPageText(content[key]);
  }
  return { ...body, content };
}

/**
 * Saves the content patch and the plan switches in one `set_gym_page_content` call, then returns the fresh data. When the save
 * committed but the follow-up read failed, `reloadFailed` is true with no error: the save is stored, only the screen is stale.
 */
export async function saveLandingPageContent(
  input: unknown,
): Promise<{ data: LandingPageData | null; error: AppError | null; reloadFailed?: boolean }> {
  const parsed = setGymPageContentSchema.safeParse(cleanSaveInput(input));
  if (!parsed.success) return { data: null, error: await typedError("pageEditor", "invalid_content") };

  const supabase = await createClient();
  const caller = await callerContext(supabase);
  if ("error" in caller) return { data: null, error: caller.error };

  const { error } = await supabase.rpc("set_gym_page_content", {
    p_gym_id: caller.gymId,
    p_content: parsed.data.content,
    p_plans: parsed.data.plans ?? null,
  });
  if (error) {
    const code = pageContentCodeFromDbError(error);
    if (code) return { data: null, error: await typedError("pageEditor", code) };
    console.error("[landing-page] set_gym_page_content failed", error);
    return { data: null, error: await mapAndLog(error) };
  }
  const fresh = await getLandingPageData();
  if (fresh.error || !fresh.data) {
    console.error("[landing-page] saved, but reading the page back failed", fresh.error);
    return { data: null, error: null, reloadFailed: true };
  }
  return fresh;
}

/** Owner only (the database refuses everyone else). The name is trimmed and lowercased as the function does. */
export async function claimLandingPageName(name: unknown): ServiceResult<ClaimPageNameResult> {
  const parsed = pageNameSchema.safeParse(name);
  if (!parsed.success) return { data: null, error: await typedError("pageNames", "invalid_name") };

  const supabase = await createClient();
  const caller = await callerContext(supabase);
  if ("error" in caller) return { data: null, error: caller.error };

  const { data, error } = await supabase.rpc("claim_page_name", { p_gym_id: caller.gymId, p_name: parsed.data });
  if (error) {
    const code = pageNameCodeFromDbError(error);
    if (code) return { data: null, error: await typedError("pageNames", code) };
    console.error("[landing-page] claim_page_name failed", error);
    return { data: null, error: await mapAndLog(error) };
  }
  const result = claimPageNameResultSchema.safeParse(data);
  if (!result.success) {
    console.error("[landing-page] claim_page_name returned an unexpected shape", result.error.issues);
    return { data: null, error: await typedError("pageEditor", "load_failed") };
  }
  return { data: result.data, error: null };
}

/**
 * Publishes with the offered template (`null` keeps the stored one). A failed gate is NOT an error: the result says `published: false`
 * and lists the missing codes, and nothing was written. The server result is what the screen shows.
 */
export async function publishLandingPage(template: unknown): ServiceResult<PublishGymPageResult> {
  if (template !== null && template !== undefined && !isOfferedTemplate(template)) {
    return { data: null, error: await typedError("pagePublish", "invalid_template") };
  }
  const supabase = await createClient();
  const caller = await callerContext(supabase);
  if ("error" in caller) return { data: null, error: caller.error };

  // Story 24.11: images removed while the page was offline are rebuilt from their retained originals before the gate runs again. The status read is
  // the admission and decides whether there is anything to rebuild (not when the page is taken down or cannot pass the gate: then the database
  // answers). An unreadable status fails closed: nothing is published.
  const status = await supabase.rpc("get_gym_page_status", { p_gym_id: caller.gymId });
  const readable = status.error ? null : gymPageStatusSchema.safeParse(status.data);
  if (!readable?.success) {
    if (status.error) console.error("[landing-page] get_gym_page_status failed before publishing", status.error);
    return { data: null, error: await typedError("pagePublish", "rederive_failed") };
  }
  let rebuilt: RebuiltMedia | null = null;
  if (readable.data.state !== "taken_down" && readable.data.missing.length === 0) {
    const r = await rebuildPurgedMedia(caller.gymId);
    if (!r.ok) return { data: null, error: await typedError("pagePublish", "rederive_failed") };
    rebuilt = r;
  }

  let published: { data: unknown; error: { message?: string } | null };
  try {
    published = await supabase.rpc("publish_gym_page", { p_gym_id: caller.gymId, p_template: (template as string | null | undefined) ?? undefined });
  } catch (e) {
    await rebuilt?.discard();
    throw e;
  }
  const { data, error } = published;
  if (error) {
    await rebuilt?.discard();
    const code = pagePublishCodeFromDbError(error);
    if (code) return { data: null, error: await typedError("pagePublish", code) };
    console.error("[landing-page] publish_gym_page failed", error);
    return { data: null, error: await mapAndLog(error) };
  }
  const result = publishGymPageResultSchema.safeParse(data);
  if (!result.success) {
    await rebuilt?.discard();
    console.error("[landing-page] publish_gym_page returned an unexpected shape", result.error.issues);
    return { data: null, error: await typedError("pageEditor", "load_failed") };
  }
  if (!result.data.published) await rebuilt?.discard();
  else if (rebuilt && !(await rebuilt.commit())) console.error("[landing-page] the page is published but its purge marks could not be cleared");
  return { data: result.data, error: null };
}

/**
 * Owner only (the database refuses everyone else): appeals the takedown of the gym's page. One appeal per takedown; none after an upheld
 * decision. The reason is 1 to 500 characters, trimmed here and judged again by the database.
 */
export async function submitLandingPageAppeal(reason: unknown): ServiceResult<{ state: "open" }> {
  const parsed = submitPageAppealSchema.safeParse({ reason });
  if (!parsed.success) return { data: null, error: await typedError("pageAppeal", "reason_required") };
  const supabase = await createClient();
  const caller = await callerContext(supabase);
  if ("error" in caller) return { data: null, error: caller.error };
  if (caller.role !== "owner") return { data: null, error: await typedError("pageAppeal", "not_admitted") };

  const { error } = await supabase.rpc("submit_page_appeal", { p_reason: parsed.data.reason });
  if (error) {
    const code = pageAppealCodeFromDbError(error);
    if (code) return { data: null, error: await typedError("pageAppeal", code) };
    console.error("[landing-page] submit_page_appeal failed", error);
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: { state: "open" }, error: null };
}

/** Always allowed for an admitted role. Resolves to whether a live page went offline. */
export async function unpublishLandingPage(): ServiceResult<{ wasLive: boolean }> {
  const supabase = await createClient();
  const caller = await callerContext(supabase);
  if ("error" in caller) return { data: null, error: caller.error };

  const { data, error } = await supabase.rpc("unpublish_gym_page", { p_gym_id: caller.gymId });
  if (error) {
    if (error.message === NOT_ADMITTED_MESSAGE) return { data: null, error: await typedError("pagePublish", "not_admitted") };
    console.error("[landing-page] unpublish_gym_page failed", error);
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: { wasLive: data === true }, error: null };
}
