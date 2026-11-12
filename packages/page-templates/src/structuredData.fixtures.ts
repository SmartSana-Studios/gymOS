// Story 25.4: the fixtures and the network-free validator behind the structured-data checks. No Rich Results Test, no schema.org validator service, no
// request: the validator is a required-property check plus an allowlist of schema.org type and property names (the compile-time half is `schema-dts`
// typing the serializer's output, see structuredData.ts). It is shown failing in structuredData.test.ts and as known-bad flaws in the conformance suite.
import type { PageContentLanguage, PageContentSnapshotV1, PageContentV1 } from "@gymos/types";
import { HOSTILE, baseContent, page } from "./conformance/fixtures";

/** The only `@type` names a page of ours may carry (the Never list of the story: no BreadcrumbList, Organization, WebSite, Offer, plan or price markup). */
export const ALLOWED_TYPES = ["HealthClub", "PostalAddress", "GeoCoordinates", "OpeningHoursSpecification", "ItemList", "ListItem"] as const;
export type AllowedType = (typeof ALLOWED_TYPES)[number];

/** The property names each type may carry. A key outside the list is an unknown property and fails the validator. */
export const ALLOWED_KEYS: Record<AllowedType, readonly string[]> = {
  HealthClub: ["@context", "@type", "name", "url", "description", "keywords", "image", "logo", "telephone", "address", "geo", "openingHoursSpecification"],
  PostalAddress: ["@type", "streetAddress", "addressLocality", "addressCountry"],
  GeoCoordinates: ["@type", "latitude", "longitude"],
  OpeningHoursSpecification: ["@type", "dayOfWeek", "opens", "closes"],
  ItemList: ["@context", "@type", "itemListElement"],
  ListItem: ["@type", "position", "url", "name"],
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string" && v !== "";

/** An absolute `https` or `http` URL. */
export function isAbsoluteUrl(v: unknown): boolean {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname !== "";
  } catch {
    return false;
  }
}

/** Every nested object has an allowed `@type` and only the keys that type allows. */
function checkTypes(node: unknown, path: string, out: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((n, i) => checkTypes(n, `${path}[${i}]`, out));
    return;
  }
  if (!isObject(node)) return;
  const type = node["@type"];
  if (typeof type !== "string" || !(ALLOWED_TYPES as readonly string[]).includes(type)) {
    out.push(`${path}: @type ${JSON.stringify(type)} is not one of ${ALLOWED_TYPES.join(", ")}`);
    return;
  }
  const allowed = ALLOWED_KEYS[type as AllowedType];
  for (const key of Object.keys(node)) if (!allowed.includes(key)) out.push(`${path}: unknown property "${key}" on ${type}`);
  for (const [key, value] of Object.entries(node)) if (key !== "@type") checkTypes(value, `${path}.${key}`, out);
}

export interface ValidateOptions {
  /** The `position` of the first ListItem (offset + 1). Default 1. */
  firstPosition?: number;
}

/** The problems of one parsed JSON-LD block, as readable strings; an empty list is a pass. `expected` is the one `@type` the page should carry. */
export function validateJsonLd(node: unknown, expected: "HealthClub" | "ItemList", options: ValidateOptions = {}): string[] {
  const out: string[] = [];
  if (!isObject(node)) return ["the block is not a JSON object"];
  if (node["@context"] !== "https://schema.org") out.push(`@context is ${JSON.stringify(node["@context"])}, expected "https://schema.org"`);
  if (node["@type"] !== expected) out.push(`@type is ${JSON.stringify(node["@type"])}, expected "${expected}"`);
  checkTypes(node, "$", out);

  if (expected === "HealthClub") {
    if (!isString(node["name"])) out.push("name is missing");
    if (!isAbsoluteUrl(node["url"])) out.push(`url ${JSON.stringify(node["url"])} is not an absolute https or http URL`);
    const address = node["address"];
    if (!isObject(address) || address["@type"] !== "PostalAddress") out.push("address is missing or not a PostalAddress");
    else if (!isString(address["addressCountry"])) out.push("address.addressCountry is missing");
    if ("telephone" in node && !(typeof node["telephone"] === "string" && /^\+[1-9]\d{7,14}$/.test(node["telephone"]))) out.push("telephone is not E.164");
    for (const key of ["image"] as const) {
      if (!(key in node)) continue;
      const urls = node[key];
      if (!Array.isArray(urls) || urls.length === 0 || !urls.every(isAbsoluteUrl)) out.push(`${key} must be a non-empty array of absolute URLs`);
      else if (new Set(urls).size !== urls.length) out.push(`${key} holds a duplicate`);
    }
    if ("logo" in node && !isAbsoluteUrl(node["logo"])) out.push("logo is not an absolute URL");
    if ("geo" in node) {
      const geo = node["geo"];
      if (!isObject(geo) || typeof geo["latitude"] !== "number" || typeof geo["longitude"] !== "number") out.push("geo needs numeric latitude and longitude");
    }
    if ("openingHoursSpecification" in node) {
      const specs = node["openingHoursSpecification"];
      if (!Array.isArray(specs) || specs.length === 0) out.push("openingHoursSpecification is present but empty");
      else
        specs.forEach((s, i) => {
          if (!isObject(s)) return out.push(`openingHoursSpecification[${i}] is not an object`);
          const days = s["dayOfWeek"];
          if (!Array.isArray(days) || days.length === 0 || !days.every((d) => DAYS.includes(d as string))) out.push(`openingHoursSpecification[${i}].dayOfWeek must be full English day names`);
          for (const key of ["opens", "closes"]) if (!(typeof s[key] === "string" && /^\d{2}:\d{2}$/.test(s[key] as string))) out.push(`openingHoursSpecification[${i}].${key} is not HH:MM`);
        });
    }
  } else {
    const items = node["itemListElement"];
    if (!Array.isArray(items) || items.length === 0) out.push("itemListElement is missing or empty");
    else
      items.forEach((item, i) => {
        if (!isObject(item) || item["@type"] !== "ListItem") return out.push(`itemListElement[${i}] is not a ListItem`);
        const want = (options.firstPosition ?? 1) + i;
        if (item["position"] !== want) out.push(`itemListElement[${i}].position is ${JSON.stringify(item["position"])}, expected ${want}`);
        if (!isAbsoluteUrl(item["url"])) out.push(`itemListElement[${i}].url is not an absolute URL`);
        if (!isString(item["name"])) out.push(`itemListElement[${i}].name is missing`);
      });
  }
  return out;
}

// ---- the fixtures ----

export interface StructuredFixture {
  id: string;
  page: PageContentV1;
  /** The request that shows the page (default: the home path asking for English). */
  request?: { pathname: string; acceptLanguage?: string };
  /** The language that request shows. */
  lang: PageContentLanguage;
  /** Strings the gym wrote that must survive `JSON.parse` of the block unchanged. */
  hostile?: string[];
}

const withoutKeys = (c: PageContentSnapshotV1, ...keys: (keyof PageContentSnapshotV1)[]): PageContentSnapshotV1 => {
  const copy: Record<string, unknown> = { ...c };
  for (const k of keys) delete copy[k];
  return copy as PageContentSnapshotV1;
};

/** Full gym, no map, no hours, all days closed, overnight, no image, WhatsApp only, French and hostile text (story 25.4). */
export function structuredDataFixtures(): StructuredFixture[] {
  const c = baseContent();
  const quote = 'Gym "Quote" </script><img src=x onerror=alert(1)> & <b>';
  const hostileText = `${HOSTILE.literal}`;
  return [
    { id: "full", page: page(c), lang: "en" },
    { id: "no-map", page: page(withoutKeys(c, "map")), lang: "en" },
    { id: "no-hours", page: page(withoutKeys(c, "hours")), lang: "en" },
    { id: "all-days-closed", page: page({ ...c, hours: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } }), lang: "en" },
    { id: "overnight", page: page({ ...c, hours: { mon: { open: "22:00", close: "02:00" }, fri: { open: "22:00", close: "02:00" }, sat: { open: "20:00", close: "03:00" } } }), lang: "en" },
    { id: "no-image", page: page(withoutKeys(c, "banner", "logo", "gallery")), lang: "en" },
    { id: "whatsapp-only", page: page({ ...c, contact: { whatsapp: "+237670111222" } }), lang: "en" },
    { id: "french", page: page(c), request: { pathname: "/fr" }, lang: "fr" },
    {
      id: "hostile",
      page: page({
        ...c,
        name: quote.slice(0, 60),
        about_en: `${quote}\n${hostileText}`,
        about_fr: `${quote}\n${hostileText}`,
        address: quote,
        city: quote,
        plans: [{ ...c.plans![1]!, name: quote }, { ...c.plans![0]!, name: hostileText }],
      }),
      lang: "en",
      hostile: [quote, quote.slice(0, 60)],
    },
  ];
}
