// Story 24.10 (AD-48, EXPERIENCE.md "Template contract"): what a template is. A template is a pure module: it exports `render` and nothing
// else (its registry entry adds metadata). It imports no database, network, fs or Supabase module (a test scans the imports), emits no
// script, and renders every string from the gym as a React text node. The server supplies everything that is not gym text through RenderEnv.
import type { ReactNode } from "react";
import type { GymCategory, PageContentLanguage, PageContentV1 } from "@gymos/types";

/** Colours the SERVER computes from the gym's `primary_color`; a template reads them and never computes one. */
export interface GymColors {
  /** The gym's own colour (the platform accent when the snapshot has none). */
  gym: string;
  /** The gym colour where it marks a non-text element (logo ring, map pin, focus): the gym colour when it reaches 3:1 on white and on the Classic page background, else ink. */
  ui: string;
  /** The gym colour where it paints TEXT or a mark on a dark template's surface (EXPERIENCE.md "Template contract", Color): the gym colour when it reaches 4.5:1 on the lightest dark surface (`DARK_SURFACE`), else the platform accent. Light templates ignore it. */
  accent: string;
  /** The fill of the main action: the gym colour when white or ink reaches 4.5:1 on it, else the platform accent. */
  fill: string;
  /** `--on-gym`: the text colour on `fill` (white or ink, whichever reaches 4.5:1; ink on the accent). */
  on: string;
}

export interface RenderEnv {
  /** `https://{name}.{root}`: the page's own origin, built from configuration and the validated label, never from the request Host. */
  origin: string;
  /** `https://www.{root}`. */
  wwwOrigin: string;
  /** Media URL prefix; a derivative key is appended. */
  mediaBase: string;
  colors: GymColors;
  /** The complete languages in fallback order: [0] is the language shown; the rest is the order block fallback uses. */
  languageOrder: PageContentLanguage[];
  /** `<link rel="alternate" hreflang>` and `x-default` are declared: at least two languages are complete and the request is not an incomplete `/{code}`. */
  alternates: boolean;
  /** The language link (a menu when more than two) is shown: at least two languages are complete. */
  languageLinks: boolean;
}

export type RenderFn = (content: PageContentV1, locale: PageContentLanguage, env: RenderEnv) => ReactNode;

export interface FontFace {
  family: string;
  weight: number;
  /** Same-origin path under /fonts (font-src 'self'). */
  path: string;
}

/** The self-hosted font allowlist (EXPERIENCE.md "Fonts"). A template declares the ids it uses. */
export const FONT_ALLOWLIST = {
  "barlow-700": { family: "Barlow", weight: 700, path: "/fonts/barlow-700.woff2" },
  "barlow-800": { family: "Barlow", weight: 800, path: "/fonts/barlow-800.woff2" },
} as const satisfies Record<string, FontFace>;
export type FontId = keyof typeof FONT_ALLOWLIST;

/** The ten sections of PS-01, in their fixed order. A template marks each it renders with `data-section="<id>"`. */
export const SECTION_ORDER = ["header", "banner", "contact", "about", "services", "plans", "hours", "location", "gallery", "footer"] as const;
export type SectionId = (typeof SECTION_ORDER)[number];

/** Contact actions are `<a data-action="call|whatsapp|directions">`, in that order. */
export const ACTION_ORDER = ["call", "whatsapp", "directions"] as const;
export type ActionId = (typeof ACTION_ORDER)[number];

/** Chrome strings of one language: headings, labels, buttons, days, the plan dictionary (EXPERIENCE.md "Plan dictionary"). */
export interface Chrome {
  /** The language's own name, written in that language ("Français"). */
  languageName: string;
  languageLabel: string;
  call: string;
  whatsapp: string;
  directions: string;
  openMap: string;
  about: string;
  services: string;
  plans: string;
  hours: string;
  location: string;
  gallery: string;
  closed: string;
  phone: string;
  reportPage: string;
  madeWith: string;
  days: Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", string>;
  categories: Record<GymCategory, string>;
  planType: Record<"pay_per_session" | "monthly" | "coach_inclusive" | "class_only", string>;
  planInterval: Record<"monthly" | "annual", string>;
  /** `duration_days` = N: "30 days", "1 day". */
  duration: (days: number) => string;
  /** Generic alternative text of a gallery image. */
  photo: (n: number, total: number) => string;
}

/** The strings of the public report form (PS-03, 24.11). Page-level, not template-level: every template links to the same /report. The reason labels come from @gymos/types. */
export interface ReportChrome {
  title: string;
  /** The page being reported is named by its address, shown under the title. */
  reasonLegend: string;
  detailsLabel: string;
  detailsHint: string;
  anonymousNote: string;
  submit: string;
  errorSummary: string;
  chooseReason: string;
  tellUsMore: string;
  detailsTooLong: string;
  /** A failure that is not the visitor's mistake (a database error): the form returns with this line. */
  failed: string;
  rateLimited: string;
  thanks: string;
  backToPage: string;
  /** The label of the hidden bot-catcher field. */
  honeypotLabel: string;
}

export interface TemplateEntry {
  id: string;
  render: RenderFn;
  /** Chrome dictionaries: one per language in PAGE_CONTENT_LANGUAGES, or the template is not registered. */
  chrome: Record<PageContentLanguage, Chrome>;
  fonts: readonly FontId[];
}
