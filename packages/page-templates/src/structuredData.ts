// Story 25.4 (AD-44, AD-51): structured data and Open Graph tags for the public pages, in ONE place. The render pipeline (renderCore.ts) and the
// directory handler build plain objects here, serialize them to inert strings (`application/ld+json`, `<meta property>`) and splice the strings into
// the head AFTER renderToStaticMarkup. No template emits JSON-LD (AD-51: per-template copies would drift), no JSX, no dangerouslySetInnerHTML, and no
// string of gym text is ever concatenated into the JSON by hand: it only goes through JSON.stringify and the escape below.
//
// `schema-dts` is a devDependency used with `import type` only: it makes `tsc` reject an unknown property or a wrong value type in the objects built
// here. It adds nothing to the bundle and nothing is fetched at run time.
import type { DayOfWeek, GeoCoordinates, HealthClub, ItemList, OpeningHoursSpecification, PostalAddress, WithContext } from "schema-dts";
import type { PageContentLanguage, PageContentSnapshotV1, PageContentV1 } from "@gymos/types";
import { PAGE_HOURS_DAYS } from "@gymos/types";
import { CHROME } from "./chrome";
import type { RenderEnv } from "./contract";
import { metaDescription, pageTitle } from "./format";

export { metaDescription, pageTitle } from "./format";

// ---- serialization ----

const JSON_LD_ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/**
 * `JSON.stringify` with `<`, `>`, `&`, U+2028 and U+2029 written as `\uXXXX` escapes. Inside a JSON string these are the same characters to
 * `JSON.parse`, and the output can no longer contain `</script>`, `<!--` or an entity, whatever the gym typed.
 */
export function serializeJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/[<>&\u2028\u2029]/g, (c) => JSON_LD_ESCAPES[c]!);
}

/** The inert `application/ld+json` block (the browser never runs it; script-src 'none' is untouched). */
export function jsonLdScript(obj: unknown): string {
  return `<script type="application/ld+json">${serializeJsonLd(obj)}</script>`;
}

const htmlEscape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

export interface OpenGraph {
  /** Always `website` (a gym page and a listing are both pages of a site). */
  type: "website";
  /** The same string as `<title>`. */
  title: string;
  description: string;
  /** Absolute, built from the configured origin, never the request Host. */
  url: string;
  /** Absolute media URL; omitted when the page has no published image. */
  image?: string;
}

/** `<meta property="og:..." content="...">` strings: every value is escaped for an attribute (`& < > " '`). */
export function openGraphTags(og: OpenGraph): string[] {
  const pairs: [string, string][] = [
    ["og:type", og.type],
    ["og:title", og.title],
    ["og:description", og.description],
    ["og:url", og.url],
  ];
  if (og.image) pairs.push(["og:image", og.image]);
  return pairs.map(([property, content]) => `<meta property="${property}" content="${htmlEscape(content)}">`);
}

/**
 * Inserts the strings before the FIRST `</head>`. Gym text reaches the document only as escaped text (`&lt;/head&gt;`), so the first literal
 * `</head>` is the real one. Throws when there is none (a document without a head cannot carry the tags; the caller answers the uniform not-found).
 */
export function injectHead(html: string, extras: readonly string[]): string {
  const at = html.indexOf("</head>");
  if (at === -1) throw new Error("no </head> to inject into");
  return `${html.slice(0, at)}${extras.join("")}${html.slice(at)}`;
}

// ---- the gym page ----

const DAY_NAMES: Record<(typeof PAGE_HOURS_DAYS)[number], DayOfWeek> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

function openingHours(content: PageContentSnapshotV1): OpeningHoursSpecification[] {
  const groups = new Map<string, { opens: string; closes: string; days: DayOfWeek[] }>();
  for (const d of PAGE_HOURS_DAYS) {
    const day = content.hours?.[d];
    if (!day) continue; // closed (null) or absent: omitted
    const key = `${day.open}-${day.close}`;
    const group = groups.get(key) ?? { opens: day.open, closes: day.close, days: [] };
    group.days.push(DAY_NAMES[d]);
    groups.set(key, group);
  }
  return [...groups.values()].map((g) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: g.days, opens: g.opens, closes: g.closes }));
}

/** The `HealthClub` of a gym page, from the published snapshot only, in the language shown. */
export function gymStructuredData(page: PageContentV1, lang: PageContentLanguage, env: RenderEnv): WithContext<HealthClub> {
  const c = page.content;
  const category = c.category ? CHROME[lang].categories[c.category] : undefined;
  const excerptText = metaDescription(c, lang);
  const description = category ? (excerptText ? `${category}. ${excerptText}` : category) : excerptText;
  const media = (key: string) => `${env.mediaBase}/${key}`;
  const images = [...new Set([c.banner, ...(c.gallery ?? []), c.logo].filter((k): k is string => Boolean(k)))].map(media);

  const address: PostalAddress | undefined =
    c.address || c.city || c.country
      ? {
          "@type": "PostalAddress",
          ...(c.address ? { streetAddress: c.address } : {}),
          ...(c.city ? { addressLocality: c.city } : {}),
          ...(c.country ? { addressCountry: c.country } : {}),
        }
      : undefined;
  const geo: GeoCoordinates | undefined = c.map ? { "@type": "GeoCoordinates", latitude: c.map.lat, longitude: c.map.lng } : undefined;
  const hours = openingHours(c);

  return {
    "@context": "https://schema.org",
    "@type": "HealthClub",
    name: c.name,
    url: `${env.origin}/`,
    ...(description ? { description } : {}),
    ...(category ? { keywords: category } : {}),
    ...(images.length > 0 ? { image: images } : {}),
    ...(c.logo ? { logo: media(c.logo) } : {}),
    ...(c.contact?.phone ? { telephone: c.contact.phone } : {}),
    ...(address ? { address } : {}),
    ...(geo ? { geo } : {}),
    ...(hours.length > 0 ? { openingHoursSpecification: hours } : {}),
  };
}

/** Open Graph of a gym page: the `<title>` string, the meta description (else category and city), the constant-origin URL, the first image of banner, logo, gallery. */
export function gymOpenGraph(page: PageContentV1, lang: PageContentLanguage, env: RenderEnv): OpenGraph {
  const c = page.content;
  const category = c.category ? CHROME[lang].categories[c.category] : undefined;
  const fallback = [category, c.city].filter(Boolean).join(", ");
  const imageKey = c.banner ?? c.logo ?? c.gallery?.[0];
  return {
    type: "website",
    title: pageTitle(c, lang),
    description: metaDescription(c, lang) ?? (fallback || c.name),
    url: `${env.origin}/`,
    ...(imageKey ? { image: `${env.mediaBase}/${imageKey}` } : {}),
  };
}

/** Everything a gym page adds to its head, as strings (og tags, then the JSON-LD block). */
export function gymHeadExtras(page: PageContentV1, lang: PageContentLanguage, env: RenderEnv): string[] {
  return [...openGraphTags(gymOpenGraph(page, lang, env)), jsonLdScript(gymStructuredData(page, lang, env))];
}

// ---- the directory ----

export interface ListedGym {
  /** The gym's canonical subdomain URL. */
  url: string;
  name: string;
}

/** The `ItemList` of the gyms a listing page shows; `offset` is the number of gyms on earlier pages. Undefined when the page shows no gym. */
export function directoryItemList(gyms: readonly ListedGym[], offset: number): WithContext<ItemList> | undefined {
  if (gyms.length === 0) return undefined;
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: gyms.map((g, i) => ({ "@type": "ListItem", position: offset + i + 1, url: g.url, name: g.name })),
  };
}
