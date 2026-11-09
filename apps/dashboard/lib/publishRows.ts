import { PAGE_CONTENT_LANGUAGES, type PageContentLanguage, type PageSnapshot } from "@gymos/types";

// Story 24.9 (FR-206). The rows of "what becomes public", generated from the would-be snapshot the status function returns, not from a
// second hand-written field list: every snapshot key belongs to exactly one row (a test compares them with the strict snapshot
// schema), and About and Services get one row per content language from the one language list.

export type PublishRowId =
  | "name"
  | "category"
  | "images"
  | "languages"
  | `about_${PageContentLanguage}`
  | `services_${PageContentLanguage}`
  | "plans"
  | "address"
  | "hours"
  | "contact"
  | "gallery"
  | "color";

export interface PublishRow {
  id: PublishRowId;
  /** Snapshot keys this row accounts for. `languages` lists `default_language` (the fallback language) only so that every snapshot key has a row (the test below); it is not shown as its own line. The languages offered are computed from the status. */
  keys: (keyof PageSnapshot)[];
  /** For the per-language rows. */
  lang?: PageContentLanguage;
}

export function publishRows(languages: readonly PageContentLanguage[] = PAGE_CONTENT_LANGUAGES): PublishRow[] {
  return [
    { id: "name", keys: ["name"] },
    { id: "category", keys: ["category"] },
    { id: "images", keys: ["logo", "banner"] },
    { id: "languages", keys: ["default_language"] },
    ...languages.flatMap((lang): PublishRow[] => [
      { id: `about_${lang}`, keys: [`about_${lang}` as keyof PageSnapshot], lang },
      { id: `services_${lang}`, keys: [`services_${lang}` as keyof PageSnapshot], lang },
    ]),
    { id: "plans", keys: ["plans"] },
    { id: "address", keys: ["address", "city", "country", "map"] },
    { id: "hours", keys: ["hours"] },
    { id: "contact", keys: ["contact"] },
    { id: "gallery", keys: ["gallery"] },
    { id: "color", keys: ["color"] },
  ];
}

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** The open days as ["mon 06:00-22:00", ...] in week order. Closed days are left out. */
export function openDays(hours: PageSnapshot["hours"]): { day: (typeof DAY_ORDER)[number]; open: string; close: string }[] {
  if (!hours) return [];
  return DAY_ORDER.flatMap((day) => {
    const v = hours[day];
    return v ? [{ day, open: v.open, close: v.close }] : [];
  });
}
