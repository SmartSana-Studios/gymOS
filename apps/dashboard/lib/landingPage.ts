import {
  PAGE_PUBLISH_GATE_CODES,
  type GymPageStatus,
  type PageBadTextField,
  type PageContentLanguage,
  type PagePublishGateCode,
  type PageStatusState,
} from "@gymos/types";

// Story 24.9 (FR-197, FR-199). Pure helpers for the landing-page editor and publish screens: the checklist, the anchors, the
// banners and the "would this save take the page offline" prediction. The client maps the SERVER's codes to words and anchors here;
// it never re-implements the gate (the database is the authority at publish and on every change).

/** The public domain a page lives under: `{name}.gymosapps.com`. */
export const PAGE_PUBLIC_DOMAIN = "gymosapps.com";

export function pagePublicHost(name: string): string {
  return `${name}.${PAGE_PUBLIC_DOMAIN}`;
}

/** Element ids of the editor's sections. A gate code links to one of them. */
export const PAGE_SECTION_IDS = {
  name: "page-name",
  text: "page-text",
  images: "page-images",
  location: "page-location",
  hours: "page-hours",
  contact: "page-contact",
  plans: "page-plans",
  template: "page-template",
} as const;
export type PageSectionKey = keyof typeof PAGE_SECTION_IDS;

/** The editor route and the publish route. */
export const LANDING_PAGE_PATH = "/settings/landing-page";
export const LANDING_PAGE_PUBLISH_PATH = "/settings/landing-page/publish";

/** Which section fixes each gate code. A code with no entry here fails the test that walks PAGE_PUBLISH_GATE_CODES. */
export const GATE_CODE_SECTION: Record<PagePublishGateCode, PageSectionKey> = {
  no_name: "name",
  no_category: "location",
  no_logo: "images",
  no_banner: "images",
  about_short: "text",
  no_country: "location",
  no_city: "location",
  no_contact: "contact",
  no_hours: "hours",
  no_public_plan: "plans",
  map_incomplete: "location",
  bad_text: "text",
  too_large: "text",
};

/** The nine required checklist items, in the order the Owner sees them. Each is ready when none of its codes is missing. */
export const CHECKLIST_ITEMS = [
  { id: "name", codes: ["no_name"], section: "name" },
  { id: "category", codes: ["no_category"], section: "location" },
  { id: "logo", codes: ["no_logo"], section: "images" },
  { id: "banner", codes: ["no_banner"], section: "images" },
  { id: "about", codes: ["about_short"], section: "text" },
  { id: "location", codes: ["no_country", "no_city"], section: "location" },
  { id: "contact", codes: ["no_contact"], section: "contact" },
  { id: "hours", codes: ["no_hours"], section: "hours" },
  { id: "plan", codes: ["no_public_plan"], section: "plans" },
] as const satisfies readonly { id: string; codes: readonly PagePublishGateCode[]; section: PageSectionKey }[];
export type ChecklistItemId = (typeof CHECKLIST_ITEMS)[number]["id"];

/** Checklist order, then the three codes that are about the content rather than a missing item. */
export const GATE_CODE_ORDER: readonly PagePublishGateCode[] = [
  ...CHECKLIST_ITEMS.flatMap((i) => i.codes as readonly PagePublishGateCode[]),
  "map_incomplete",
  "bad_text",
  "too_large",
];

export function sortGateCodes<T extends string>(codes: readonly T[]): T[] {
  const rank = (c: string) => {
    const i = (GATE_CODE_ORDER as readonly string[]).indexOf(c);
    return i === -1 ? GATE_CODE_ORDER.length : i;
  };
  return [...new Set(codes)].sort((a, b) => rank(a) - rank(b));
}

export function sectionAnchor(section: PageSectionKey): string {
  return `#${PAGE_SECTION_IDS[section]}`;
}

export function gateCodeAnchor(code: PagePublishGateCode): string {
  return sectionAnchor(GATE_CODE_SECTION[code]);
}

/** A name or plan text is edited elsewhere in the dashboard: a link to Settings or to the Plans page, not an anchor. */
export function badTextTarget(field: PageBadTextField): { kind: "anchor"; href: string } | { kind: "settings"; href: string } | { kind: "plans"; href: string } {
  switch (field) {
    case "gym_name":
      return { kind: "settings", href: "/settings" };
    case "plan_name":
      return { kind: "plans", href: "/plans" };
    case "address":
    case "city":
      return { kind: "anchor", href: sectionAnchor("location") };
    default:
      return { kind: "anchor", href: sectionAnchor("text") };
  }
}

export interface ChecklistRow {
  id: ChecklistItemId;
  ready: boolean;
  /** The codes of this item that are currently missing. */
  missing: PagePublishGateCode[];
  section: PageSectionKey;
}

export function buildChecklist(status: Pick<GymPageStatus, "missing">): { rows: ChecklistRow[]; readyCount: number; total: number } {
  const missing = new Set<string>(status.missing);
  const rows = CHECKLIST_ITEMS.map((item) => {
    const m = (item.codes as readonly PagePublishGateCode[]).filter((c) => missing.has(c));
    return { id: item.id, ready: m.length === 0, missing: m, section: item.section } satisfies ChecklistRow;
  });
  return { rows, readyCount: rows.filter((r) => r.ready).length, total: rows.length };
}

/**
 * The codes the status banner lists, in checklist order. offline_gate: the recorded reasons that STILL hold. offline_name_released:
 * the one non-gate reason. Anything else shows no banner.
 */
export function statusBannerCodes(status: Pick<GymPageStatus, "state" | "unpublished_reasons" | "missing">): string[] {
  if (status.state === "offline_name_released") return ["name_released"];
  if (status.state !== "offline_gate") return [];
  const still = status.unpublished_reasons.filter((r) => (status.missing as readonly string[]).includes(r));
  return sortGateCodes(still);
}

export function isGateCode(value: string): value is PagePublishGateCode {
  return (PAGE_PUBLISH_GATE_CODES as readonly string[]).includes(value);
}

export type LanguageTabStatus = "complete" | "needs" | "empty";

export interface LanguageProgress {
  code: PageContentLanguage;
  /** Characters of About after trim. */
  characters: number;
  /** Any text in About or Services (so "Empty" means neither has any). */
  hasText: boolean;
}

export function languageTabStatus(p: LanguageProgress, minChars: number): { status: LanguageTabStatus; needed: number } {
  if (p.characters >= minChars) return { status: "complete", needed: 0 };
  if (!p.hasText && p.characters === 0) return { status: "empty", needed: minChars };
  return { status: "needs", needed: Math.max(0, minChars - p.characters) };
}

/**
 * The tab a link into "Page text" selects: the default language's; the first incomplete shown tab when the default is complete;
 * the default again when every shown tab is complete. A link never adds a tab.
 */
export function pickTextTab(
  shown: readonly PageContentLanguage[],
  progress: ReadonlyMap<PageContentLanguage, LanguageProgress>,
  defaultLanguage: PageContentLanguage,
  minChars: number,
): PageContentLanguage {
  const complete = (l: PageContentLanguage) => (progress.get(l)?.characters ?? 0) >= minChars;
  if (!complete(defaultLanguage)) return defaultLanguage;
  const firstIncomplete = shown.find((l) => !complete(l));
  return firstIncomplete ?? defaultLanguage;
}

/** Languages whose tab is shown on a fresh load: the default language and every language with saved text. */
export function initialShownLanguages(
  all: readonly PageContentLanguage[],
  defaultLanguage: PageContentLanguage,
  saved: ReadonlyMap<PageContentLanguage, { about: string; services: string }>,
): PageContentLanguage[] {
  return all.filter((l) => l === defaultLanguage || (saved.get(l)?.about ?? "").trim() !== "" || (saved.get(l)?.services ?? "").trim() !== "");
}

export interface SaveImpact {
  /** Codes the saved page would miss, among those this editor can cause. Empty: the save cannot take a live page offline. */
  codes: PagePublishGateCode[];
}

/**
 * Would saving this form take a LIVE page offline? A client-side prediction used only to warn first (the database re-judges the
 * gate at commit, and unpublishes by itself): the plans switched on, the longest About, the contact and the hours. (The city is saved by its
 * own Location button, which only sets a city of the chosen country, so it never leaves a page without one and is not predicted here. A
 * country change in Settings DOES clear the city and unpublish the page, but that save is not made from this form.)
 */
export function predictedBreaks(args: {
  state: PageStatusState;
  publicPlanCount: number;
  longestAbout: number;
  minAbout: number;
  hasContact: boolean;
  hasOpenDay: boolean;
}): SaveImpact {
  if (args.state !== "published") return { codes: [] };
  const codes: PagePublishGateCode[] = [];
  if (args.publicPlanCount === 0) codes.push("no_public_plan");
  if (args.longestAbout < args.minAbout) codes.push("about_short");
  if (!args.hasContact) codes.push("no_contact");
  if (!args.hasOpenDay) codes.push("no_hours");
  return { codes: sortGateCodes(codes) };
}
