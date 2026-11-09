// Story 24.10: fixture gyms for the conformance suite (EXPERIENCE.md "Template contract": content stress and language fixtures).
// Every fixture is a valid PageContentV1: the point is the template, not the schema. Hostile text is written with entities (the gate refuses
// a literal angle bracket) AND, in one fixture, with literal angle brackets (a snapshot written by hand), because the template must be inert to both.
import { PAGE_CONTENT_LANGUAGES, type PageContentV1, type PageContentSnapshotV1 } from "@gymos/types";

const key = (n: number) => `${n.toString(16).padStart(8, "0")}-aaaa-4bbb-8ccc-${n.toString(16).padStart(12, "0")}.webp`;

export const ABOUT_EN =
  "Grace Fit is a neighbourhood gym in Douala with free weights, cardio machines and group classes six days a week. Coaches are on the floor every evening.\nNew members get a free first session.";
export const ABOUT_FR =
  "Grace Fit est une salle de sport de quartier à Douala avec des poids libres, des machines de cardio et des cours collectifs six jours par semaine. Des coachs sont présents chaque soir.\nLa première séance est offerte.";

export function baseContent(): PageContentSnapshotV1 {
  return {
    name: "GRACE FIT",
    default_language: "en",
    about_en: ABOUT_EN,
    about_fr: ABOUT_FR,
    services_en: "Free weights\nCardio\nGroup classes\nPersonal coaching",
    services_fr: "Poids libres\nCardio\nCours collectifs\nCoaching personnel",
    address: "Rue de la Joie 12, Bonanjo",
    city: "Douala",
    country: "CM",
    category: "gym",
    map: { lat: 4.0511, lng: 9.7679 },
    contact: { phone: "+237600555000", whatsapp: "+237670111222" },
    color: "#1A6B3C",
    logo: key(1),
    banner: key(2),
    gallery: [key(3), key(4), key(5)],
    hours: {
      mon: { open: "06:00", close: "22:00" },
      tue: { open: "06:00", close: "22:00" },
      wed: { open: "06:00", close: "22:00" },
      thu: { open: "06:00", close: "22:00" },
      fri: { open: "06:00", close: "22:00" },
      sat: { open: "08:00", close: "14:00" },
      sun: null,
    },
    plans: [
      { name: "Per session", label_en: "Per session", label_fr: "Per session", type: "pay_per_session", price: 2000, currency: "XAF", interval: "monthly" },
      { name: "Mensuel", label_en: "Mensuel", label_fr: "Mensuel", type: "monthly", price: 15000, currency: "XAF", interval: "monthly", duration_days: 30 },
      { name: "Annual pass", label_en: "Annual pass", label_fr: "Annual pass", type: "coach_inclusive", price: 150000, currency: "XAF", interval: "annual", duration_days: 365 },
    ],
  };
}

export function page(content: PageContentSnapshotV1, template = "classic"): PageContentV1 {
  return { template, schema_version: 1, content };
}

type Omittable = "banner" | "gallery" | "map" | "hours" | "logo" | "services_en" | "services_fr";
function without(c: PageContentSnapshotV1, ...keys: Omittable[]): PageContentSnapshotV1 {
  const copy: Record<string, unknown> = { ...c };
  for (const k of keys) delete copy[k];
  return copy as PageContentSnapshotV1;
}

const plan = (i: number, name: string): NonNullable<PageContentSnapshotV1["plans"]>[number] => ({
  name,
  label_en: name,
  label_fr: name,
  type: (["pay_per_session", "monthly", "coach_inclusive", "class_only"] as const)[i % 4]!,
  price: 1000 * (i + 1) * 12,
  currency: "XAF",
  interval: i % 4 === 0 || i % 2 === 0 ? "monthly" : "annual",
  duration_days: i % 4 === 0 ? null : 30 * (i + 1),
});

/** The hostile strings. `entity` forms are what the gate lets through; `literal` forms are what a hand-written snapshot could carry. */
export const HOSTILE = {
  entity: "&lt;script&gt;alert(1)&lt;/script&gt; &lt;img src=x onerror=alert(1)&gt; &amp;amp; &#60;b&#62; &lt;u data-pwn=1&gt;x&lt;/u&gt;",
  literal: '<script>alert(1)</script><img src=x onerror="alert(1)"><svg onload=alert(1)><a href="javascript:alert(1)">x</a><u data-pwn=1>x</u>',
  unbroken: "A".repeat(300),
  lookalike: "GYMаοօ ‮reversed",
} as const;

export interface Fixture {
  id: string;
  page: PageContentV1;
  /** Strings that must appear as text and never as elements. */
  hostile?: string[];
}

export interface RequestCase {
  id: string;
  pathname: string;
  acceptLanguage?: string;
}

export const STANDARD_REQUESTS: RequestCase[] = [
  { id: "home-en", pathname: "/", acceptLanguage: "en" },
  { id: "home-fr", pathname: "/", acceptLanguage: "fr-CM,fr;q=0.9,en;q=0.5" },
];

export function lang(code: string): string {
  return code;
}

export function fixtures(): Fixture[] {
  const c = baseContent();
  const longName = "GRACE FIT PREMIUM TRAINING AND WELLNESS CENTRE DOUALA 2";
  const about2000 = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}: ${"word ".repeat(9)}`.trim()).join("\n").padEnd(2000, " x").slice(0, 2000);
  return [
    { id: "full", page: page(c) },
    { id: "no-banner", page: page(without(c, "banner")) },
    { id: "no-logo", page: page(without(c, "logo")) },
    { id: "no-gallery", page: page(without(c, "gallery")) },
    { id: "no-services", page: page(without(c, "services_en", "services_fr")) },
    { id: "no-map", page: page(without(c, "map")) },
    { id: "no-hours", page: page(without(c, "hours")) },
    { id: "one-plan", page: page({ ...c, plans: [c.plans![1]!] }) },
    { id: "eight-long-plans", page: page({ ...c, plans: Array.from({ length: 8 }, (_, i) => plan(i, `PLAN ${i + 1} ${"Premium Unlimited ".repeat(4)}`.slice(0, 60).trimEnd())) }) },
    { id: "long-name-and-about", page: page({ ...c, name: longName.slice(0, 60), about_en: about2000, about_fr: about2000 }) },
    {
      id: "hostile-entity",
      page: page({
        ...c,
        name: HOSTILE.entity.slice(0, 60),
        about_en: `${HOSTILE.entity}\n${ABOUT_EN}`,
        about_fr: `${HOSTILE.entity}\n${ABOUT_FR}`,
        services_en: `${HOSTILE.entity}\n${HOSTILE.unbroken}`,
        services_fr: `${HOSTILE.entity}\n${HOSTILE.lookalike}`,
        address: HOSTILE.entity,
        city: HOSTILE.entity,
        plans: [{ ...c.plans![1]!, name: HOSTILE.entity }, { ...c.plans![0]!, name: HOSTILE.unbroken }],
      }),
      hostile: [HOSTILE.entity, HOSTILE.unbroken],
    },
    {
      id: "hostile-literal",
      page: page({
        ...c,
        name: HOSTILE.literal.slice(0, 60),
        about_en: `${HOSTILE.literal}\n${ABOUT_EN}`,
        about_fr: `${HOSTILE.literal}\n${ABOUT_FR}`,
        services_en: HOSTILE.literal,
        services_fr: HOSTILE.literal,
        address: HOSTILE.literal,
        city: HOSTILE.literal,
        plans: [{ ...c.plans![1]!, name: HOSTILE.literal }],
      }),
      hostile: [HOSTILE.literal],
    },
    {
      id: "currencies",
      page: page({
        ...c,
        plans: [
          { name: "Mensuel", label_en: "Mensuel", label_fr: "Mensuel", type: "monthly", price: 15000, currency: "EUR", interval: "monthly", duration_days: 30 },
          { name: "Local", label_en: "Local", label_fr: "Local", type: "monthly", price: 8000, currency: "XAF", interval: "monthly", duration_days: 30 },
        ],
      }),
    },
    { id: "color-light", page: page({ ...c, color: "#FFF200" }) },
    { id: "color-dark", page: page({ ...c, color: "#050505" }) },
    { id: "color-mid", page: page({ ...c, color: "#808080" }) },
    { id: "color-none", page: page((() => { const { color: _c, ...rest } = c; void _c; return rest as PageContentSnapshotV1; })()) },
    { id: "only-whatsapp", page: page({ ...c, contact: { whatsapp: "+237670111222" } }) },
    { id: "only-phone-no-map", page: page(without({ ...c, contact: { phone: "+237600555000" } }, "map")) },
  ];
}

/** Language cases (a) to (d) of the UX table, for each supported language X, built from the language list. */
export function languageFixtures(): { id: string; page: PageContentV1; expect: { complete: string[] } }[] {
  const base = baseContent() as unknown as Record<string, unknown>;
  const out: { id: string; page: PageContentV1; expect: { complete: string[] } }[] = [];
  const clear = (langs: readonly string[]) => {
    const copy = { ...base };
    for (const l of langs) {
      delete copy[`about_${l}`];
      delete copy[`services_${l}`];
    }
    return copy as unknown as PageContentSnapshotV1;
  };
  for (const x of PAGE_CONTENT_LANGUAGES) {
    const others = PAGE_CONTENT_LANGUAGES.filter((l) => l !== x);
    // (a) complete only in X
    out.push({ id: `only-${x}`, page: page({ ...clear(others), default_language: others[0] ?? x }), expect: { complete: [x] } });
    // (c) X incomplete, every other language complete
    out.push({ id: `${x}-incomplete`, page: page(clear([x])), expect: { complete: [...others] } });
  }
  // (b) complete in every language
  out.push({ id: "all-complete", page: page({ ...baseContent(), default_language: PAGE_CONTENT_LANGUAGES[PAGE_CONTENT_LANGUAGES.length - 1]! }), expect: { complete: [...PAGE_CONTENT_LANGUAGES] } });
  // half-filled second language on a live page: the services of the shown language are empty, so the next language's services fall back
  out.push({
    id: "services-fallback",
    page: page((() => { const c = baseContent(); delete c.services_fr; return c; })()),
    expect: { complete: [...PAGE_CONTENT_LANGUAGES] },
  });
  return out;
}
