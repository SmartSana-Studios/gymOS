// Story 25.4: the serializer, the head injection, the Open Graph tags, the network-free validator (shown failing), and the gate reach: every registered
// template x every fixture x `/` and `/{code}` carries exactly one valid block and the tags.
import { describe, expect, it } from "vitest";
import type { HealthClub, WithContext } from "schema-dts";
import { PAGE_CONTENT_LANGUAGES, type PageContentV1 } from "@gymos/types";
import type { RenderEnv } from "./contract";
import { fixtures, languageFixtures, page } from "./conformance/fixtures";
import { TEST_CONFIG, MEDIA_BASE, PAGE_ORIGIN } from "./conformance/subject";
import { REGISTERED_TEMPLATES } from "./registry";
import { renderPage } from "./renderPage";
import { renderPageWith } from "./renderCore";
import { directoryItemList, gymOpenGraph, gymStructuredData, injectHead, jsonLdScript, openGraphTags, pageTitle, serializeJsonLd } from "./index";
import { ALLOWED_TYPES, structuredDataFixtures, validateJsonLd, type StructuredFixture } from "./structuredData.fixtures";

function show(p: PageContentV1, request: { pathname: string; acceptLanguage?: string } = { pathname: "/", acceptLanguage: "en" }, template = "classic") {
  const r = renderPage({ page: { ...p, template }, pathname: request.pathname, acceptLanguage: request.acceptLanguage, ...TEST_CONFIG });
  if (!r.ok) throw new Error(`not rendered: ${r.reason}`);
  return r;
}
const ENV = { origin: PAGE_ORIGIN, mediaBase: MEDIA_BASE } as unknown as RenderEnv;
const BLOCK = /<script type="application\/ld\+json">([^]*?)<\/script>/g;
const blocksOf = (html: string): string[] => [...html.matchAll(BLOCK)].map((m) => m[1]!);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed test JSON, navigated by property
type Json = Record<string, any>;
const jsonOf = (html: string): Json => JSON.parse(blocksOf(html)[0]!);
const metaOf = (html: string): Record<string, string> => {
  const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return Object.fromEntries([...html.matchAll(/<meta property="(og:[a-z:]+)" content="([^"]*)">/g)].map((m) => [m[1]!, unescape(m[2]!)]));
};
const fx = (id: string): StructuredFixture => structuredDataFixtures().find((f) => f.id === id)!;
const requestOf = (f: StructuredFixture) => ({ pathname: "/", acceptLanguage: "en", ...f.request });

describe("serializeJsonLd and jsonLdScript", () => {
  it("escapes < > & U+2028 U+2029 as \\u escapes and JSON.parse returns the original", () => {
    const value = { a: "</script><img src=x onerror=alert(1)> & <!-- \u2028 \u2029 \"q\" 'x'" };
    const out = serializeJsonLd(value);
    expect(out).not.toMatch(/[<>&\u2028\u2029]/);
    expect(out).toContain("\\u003c/script\\u003e");
    expect(out).toContain("\\u0026");
    expect(out).toContain("\\u2028");
    expect(JSON.parse(out)).toEqual(value);
  });
  it("wraps the text in one inert application/ld+json block", () => {
    expect(jsonLdScript({ a: 1 })).toBe('<script type="application/ld+json">{"a":1}</script>');
  });
});

describe("openGraphTags", () => {
  it("returns property/content meta strings with & < > \" ' escaped, og:image only when there is one", () => {
    const tags = openGraphTags({ type: "website", title: `A "b" <c> & 'd'`, description: "x", url: "https://a.example/" });
    expect(tags).toEqual([
      '<meta property="og:type" content="website">',
      '<meta property="og:title" content="A &quot;b&quot; &lt;c&gt; &amp; &#x27;d&#x27;">',
      '<meta property="og:description" content="x">',
      '<meta property="og:url" content="https://a.example/">',
    ]);
    expect(openGraphTags({ type: "website", title: "t", description: "d", url: "u", image: "https://m/x.webp" }).at(-1)).toBe('<meta property="og:image" content="https://m/x.webp">');
  });
});

describe("injectHead", () => {
  it("inserts before the FIRST </head> and leaves the rest untouched", () => {
    const html = "<html><head><title>t</title></head><body>&lt;/head&gt; and </head> later</body></html>";
    expect(injectHead(html, ["<meta a>", "<meta b>"])).toBe("<html><head><title>t</title><meta a><meta b></head><body>&lt;/head&gt; and </head> later</body></html>");
    expect(injectHead(html, [])).toBe(html);
  });
  it("throws without a </head>", () => {
    expect(() => injectHead("<html><body></body></html>", ["x"])).toThrow(/no <\/head>/);
  });
});

describe("the HealthClub of a gym page (I/O matrix)", () => {
  it("full gym: one block with every property; og:image is the banner", () => {
    const f = fx("full");
    const r = show(f.page);
    expect(blocksOf(r.body)).toHaveLength(1);
    const j = jsonOf(r.body);
    expect(validateJsonLd(j, "HealthClub")).toEqual([]);
    expect(j).toEqual({
      "@context": "https://schema.org",
      "@type": "HealthClub",
      name: "GRACE FIT",
      url: `${PAGE_ORIGIN}/`,
      description: expect.stringMatching(/^Gym\. Grace Fit is a neighbourhood gym/),
      keywords: "Gym",
      image: [2, 3, 4, 5, 1].map((n) => `${MEDIA_BASE}/0000000${n}-aaaa-4bbb-8ccc-00000000000${n}.webp`),
      logo: `${MEDIA_BASE}/00000001-aaaa-4bbb-8ccc-000000000001.webp`,
      telephone: "+237600555000",
      address: { "@type": "PostalAddress", streetAddress: "Rue de la Joie 12, Bonanjo", addressLocality: "Douala", addressCountry: "CM" },
      geo: { "@type": "GeoCoordinates", latitude: 4.0511, longitude: 9.7679 },
      openingHoursSpecification: [
        { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "06:00", closes: "22:00" },
        { "@type": "OpeningHoursSpecification", dayOfWeek: ["Saturday"], opens: "08:00", closes: "14:00" },
      ],
    });
    const og = metaOf(r.body);
    expect(og["og:type"]).toBe("website");
    expect(og["og:title"]).toBe("GRACE FIT - Gym, Douala");
    expect(og["og:url"]).toBe(`${PAGE_ORIGIN}/`);
    expect(og["og:image"]).toBe(`${MEDIA_BASE}/00000002-aaaa-4bbb-8ccc-000000000002.webp`);
    expect(og["og:description"]).toBe(/<meta name="description" content="([^"]*)"/.exec(r.body)![1]);
    expect(r.body).toContain("<title>GRACE FIT - Gym, Douala</title>");
  });

  it("no map position: no geo; no hours: no openingHoursSpecification (no empty array)", () => {
    expect(jsonOf(show(fx("no-map").page).body)).not.toHaveProperty("geo");
    const hours = jsonOf(show(fx("no-hours").page).body);
    expect(hours).not.toHaveProperty("openingHoursSpecification");
    expect(validateJsonLd(hours, "HealthClub")).toEqual([]);
  });

  it("all days closed: no openingHoursSpecification", () => {
    expect(jsonOf(show(fx("all-days-closed").page).body)).not.toHaveProperty("openingHoursSpecification");
  });

  it("mixed hours: two specs, Sunday omitted", () => {
    const specs = jsonOf(show(fx("full").page).body).openingHoursSpecification as { dayOfWeek: string[] }[];
    expect(specs).toHaveLength(2);
    expect(specs.flatMap((s) => s.dayOfWeek)).not.toContain("Sunday");
  });

  it("overnight hours are emitted as stored, grouped by identical times", () => {
    const specs = jsonOf(show(fx("overnight").page).body).openingHoursSpecification;
    expect(specs).toEqual([
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Friday"], opens: "22:00", closes: "02:00" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Saturday"], opens: "20:00", closes: "03:00" },
    ]);
  });

  it("no image: no image, logo or og:image; the page still has its tags", () => {
    const r = show(fx("no-image").page);
    const j = jsonOf(r.body);
    expect(j).not.toHaveProperty("image");
    expect(j).not.toHaveProperty("logo");
    expect(metaOf(r.body)).not.toHaveProperty("og:image");
    expect(metaOf(r.body)["og:title"]).toBeTruthy();
  });

  it("WhatsApp only: no telephone (WhatsApp is not emitted)", () => {
    const r = show(fx("whatsapp-only").page);
    expect(jsonOf(r.body)).not.toHaveProperty("telephone");
    expect(blocksOf(r.body)[0]).not.toContain("670111222");
  });

  it("og:image falls back to the logo, then the first gallery image; the JSON-LD image list has no duplicates", () => {
    const c = fx("full").page.content;
    const noBanner = show(page({ ...c, banner: undefined }));
    expect(metaOf(noBanner.body)["og:image"]).toBe(`${MEDIA_BASE}/${c.logo}`);
    const onlyGallery = show(page({ ...c, banner: undefined, logo: undefined }));
    expect(metaOf(onlyGallery.body)["og:image"]).toBe(`${MEDIA_BASE}/${c.gallery![0]}`);
    const dup = show(page({ ...c, gallery: [c.banner!, c.logo!] }));
    expect(jsonOf(dup.body).image).toEqual([`${MEDIA_BASE}/${c.banner}`, `${MEDIA_BASE}/${c.logo}`]);
  });

  it("an address is only what is stored; with no About text the description is just the category label (and og:description is category and city)", () => {
    const c = fx("full").page.content;
    const bare = page({ ...c, address: undefined, city: undefined, about_en: undefined, about_fr: undefined });
    const j = gymStructuredData(bare, "en", ENV) as unknown as Json;
    expect(j.address).toEqual({ "@type": "PostalAddress", addressCountry: "CM" });
    expect(j.description).toBe("Gym");
    expect(gymOpenGraph(bare, "en", ENV).description).toBe("Gym");
    expect(gymOpenGraph(page({ ...c, about_en: undefined, about_fr: undefined }), "en", ENV).description).toBe("Gym, Douala");
    const nothing = page({ ...c, category: undefined, about_en: undefined, about_fr: undefined });
    expect(gymStructuredData(nothing, "en", ENV)).not.toHaveProperty("description");
    expect(gymStructuredData(nothing, "en", ENV)).not.toHaveProperty("keywords");
  });

  it("French request: labels, keywords and description in French, url unchanged", () => {
    const f = fx("french");
    const r = show(f.page, requestOf(f));
    const j = jsonOf(r.body);
    expect(j.keywords).toBe("Salle de sport");
    expect(j.description).toMatch(/^Salle de sport\. Grace Fit est une salle/);
    expect(j.url).toBe(`${PAGE_ORIGIN}/`);
    expect(metaOf(r.body)["og:url"]).toBe(`${PAGE_ORIGIN}/`);
    expect(metaOf(r.body)["og:title"]).toBe("GRACE FIT - Salle de sport, Douala");
    expect(metaOf(r.body)["og:description"]).toMatch(/^Grace Fit est une salle/);
    expect(metaOf(r.body)["og:description"]).toBe(/<meta name="description" content="([^"]*)"/.exec(r.body)![1]);
    // no About text in the language shown: the fallback is the French category label and the city
    const c = f.page.content;
    expect(gymOpenGraph(page({ ...c, about_en: undefined, about_fr: undefined }), "fr", ENV).description).toBe("Salle de sport, Douala");
  });

  it("og:url is the configured origin whatever the language path or Host", () => {
    for (const pathname of ["/", "/en", "/fr"]) expect(metaOf(show(fx("full").page, { pathname, acceptLanguage: "fr" }).body)["og:url"]).toBe(`${PAGE_ORIGIN}/`);
  });

  it("pageTitle is the one string of <title> and og:title", () => {
    const c = fx("full").page.content;
    expect(pageTitle(c, "en")).toBe("GRACE FIT - Gym, Douala");
    expect(pageTitle({ ...c, category: undefined, city: undefined }, "en")).toBe("GRACE FIT");
    expect(pageTitle({ ...c, category: undefined }, "fr")).toBe("GRACE FIT - Douala");
  });

  it("the CSP and the hash are the AD-44 policy, unchanged by the block", () => {
    const r = show(fx("full").page);
    expect(r.headers["Content-Security-Policy"]).toBe(
      `default-src 'none'; img-src ${TEST_CONFIG.mediaOrigin}; style-src '${r.styleHash}'; font-src 'self'; connect-src 'none'; script-src 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'`,
    );
  });
});

describe("hostile text appears only inside the escaped JSON string", () => {
  const f = fx("hostile");
  const r = show(f.page);
  const raw = blocksOf(r.body)[0]!;
  it("the block holds no < > & and the only </script> of the page is the block's own closer", () => {
    expect(raw).not.toMatch(/[<>&]/);
    expect(r.body.match(/<\/script>/g)).toHaveLength(1);
    expect(r.body.match(/<script\b/g)).toHaveLength(1);
    expect(r.body).not.toContain("<img src=x onerror");
  });
  it("JSON.parse returns the original text of name, address and city", () => {
    const j = JSON.parse(raw);
    expect(j.name).toBe(f.page.content.name);
    expect(j.address.streetAddress).toBe(f.page.content.address);
    expect(j.address.addressLocality).toBe(f.page.content.city);
    expect(j.description).toContain('Gym "Quote" </script><img src=x onerror=alert(1)> & <b>');
  });
  it("plan names are never in the structured data", () => {
    expect(raw).not.toContain("Mensuel");
  });
  it("og tags carry the text as escaped attribute values", () => {
    expect(r.body).toContain('<meta property="og:title" content="Gym &quot;Quote&quot; &lt;/script&gt;&lt;img src=x onerror=alert(1)&gt; &amp; &lt;b&gt;');
    expect(metaOf(r.body)["og:title"]).toBe(pageTitle(f.page.content, "en"));
  });
  it("a literal </head> typed by the gym cannot move the injection point", () => {
    const c = fx("full").page.content;
    const evil = show(page({ ...c, name: "A</head><script>1</script>" }));
    expect(blocksOf(evil.body)).toHaveLength(1);
    expect(evil.body.indexOf('<script type="application/ld+json">')).toBeLessThan(evil.body.indexOf("</head>"));
    expect(evil.body.match(/<\/head>/g)).toHaveLength(1);
  });
});

describe("renderPageWith: a document without a </head>", () => {
  it("answers { ok: false, reason: \"head\" } when the injected renderer's output has nowhere to put the tags", () => {
    const r = renderPageWith(() => "<html><body>no head</body></html>", { page: fx("full").page, pathname: "/", acceptLanguage: "en", ...TEST_CONFIG });
    expect(r).toEqual({ ok: false, reason: "head" });
  });
});

describe("the validator can fail", () => {
  const good = (): Json => jsonOf(show(fx("full").page).body);
  it("passes the good one", () => expect(validateJsonLd(good(), "HealthClub")).toEqual([]));
  it("fails an unknown property, at the top and in a nested object", () => {
    expect(validateJsonLd({ ...good(), fooBar: 1 }, "HealthClub").join()).toMatch(/unknown property "fooBar"/);
    const j = good();
    j.address.country = "CM";
    expect(validateJsonLd(j, "HealthClub").join()).toMatch(/unknown property "country" on PostalAddress/);
  });
  it("fails each missing required property", () => {
    for (const key of ["@context", "@type", "name", "url", "address"]) {
      const j = good();
      delete j[key];
      expect(validateJsonLd(j, "HealthClub").length, key).toBeGreaterThan(0);
    }
    const j = good();
    delete j.address.addressCountry;
    expect(validateJsonLd(j, "HealthClub").join()).toMatch(/addressCountry/);
  });
  it("fails a relative or non-http url, a type outside the allowed names and a wrong value", () => {
    expect(validateJsonLd({ ...good(), url: "/" }, "HealthClub").join()).toMatch(/url/);
    expect(validateJsonLd({ ...good(), url: "javascript:alert(1)" }, "HealthClub").join()).toMatch(/url/);
    expect(validateJsonLd({ ...good(), "@type": "LocalBusiness" }, "HealthClub").length).toBeGreaterThan(0);
    expect(validateJsonLd({ ...good(), geo: { "@type": "Place" } }, "HealthClub").join()).toMatch(/@type "Place"/);
    expect(validateJsonLd({ ...good(), telephone: "0600" }, "HealthClub").join()).toMatch(/telephone/);
    expect(validateJsonLd({ ...good(), openingHoursSpecification: [] }, "HealthClub").join()).toMatch(/empty/);
    expect(ALLOWED_TYPES).not.toContain("Organization");
  });
  it("fails ListItem positions out of order and a relative item url", () => {
    const list = directoryItemList([{ url: "https://a.example/", name: "A" }, { url: "https://b.example/", name: "B" }], 20)!;
    expect(validateJsonLd(list, "ItemList", { firstPosition: 21 })).toEqual([]);
    expect(validateJsonLd(list, "ItemList").join()).toMatch(/position is 21, expected 1/);
    const swapped = { ...list, itemListElement: [...(list.itemListElement as unknown[])].reverse() };
    expect(validateJsonLd(swapped, "ItemList", { firstPosition: 21 }).length).toBeGreaterThan(0);
    const relative = directoryItemList([{ url: "/x", name: "A" }], 0)!;
    expect(validateJsonLd(relative, "ItemList").join()).toMatch(/absolute/);
    expect(validateJsonLd({ "@context": "https://schema.org", "@type": "ItemList", itemListElement: [] }, "ItemList").join()).toMatch(/missing or empty/);
  });
  it("compile time: schema-dts rejects an unknown property and a wrong value type (tsc is the check; the directive fails when the line stops being an error)", () => {
    const base = { "@context": "https://schema.org", "@type": "HealthClub", name: "x" } as const;
    const unknown: WithContext<HealthClub> = {
      ...base,
      // @ts-expect-error fooBar is not a property of HealthClub
      fooBar: 1,
    };
    const wrong: WithContext<HealthClub> = {
      ...base,
      // @ts-expect-error name must be text, not a number
      name: 5,
    };
    expect(unknown).toBeTruthy();
    expect(wrong).toBeTruthy();
  });
});

describe("the directory ItemList builder", () => {
  it("numbers positions from the offset, in order; nothing to list is no ItemList", () => {
    const list = directoryItemList([{ url: "https://a.example/", name: "A" }], 20)!;
    expect(list).toEqual({ "@context": "https://schema.org", "@type": "ItemList", itemListElement: [{ "@type": "ListItem", position: 21, url: "https://a.example/", name: "A" }] });
    expect(directoryItemList([], 0)).toBeUndefined();
  });
});

describe("gate reach: every registered template x every fixture x / and /{code}", () => {
  const all: { id: string; page: PageContentV1 }[] = [
    ...fixtures().map((f) => ({ id: f.id, page: f.page })),
    ...languageFixtures().map((f) => ({ id: f.id, page: f.page })),
    ...structuredDataFixtures().map((f) => ({ id: `sd-${f.id}`, page: f.page })),
  ];
  const paths = ["/", ...PAGE_CONTENT_LANGUAGES.map((l) => `/${l}`)];
  it("enumerates a meaningful number of consumers", () => {
    expect(REGISTERED_TEMPLATES).toEqual(["classic", "volt"]);
    expect(REGISTERED_TEMPLATES.length * all.length * paths.length).toBeGreaterThan(150);
  });
  for (const template of REGISTERED_TEMPLATES) {
    it(`${template}: each response has exactly one valid HealthClub block and the four og tags equal to the title`, () => {
      const lacking: string[] = [];
      for (const f of all) {
        for (const pathname of paths) {
          const r = renderPage({ page: { ...f.page, template }, pathname, acceptLanguage: "en", ...TEST_CONFIG });
          if (!r.ok) {
            // an incomplete /{code} still serves; the only refusal is a page with no complete language, which no fixture is
            lacking.push(`${f.id} ${pathname}: not rendered (${r.reason})`);
            continue;
          }
          const where = `${f.id} ${pathname}`;
          const blocks = blocksOf(r.body);
          if (blocks.length !== 1) lacking.push(`${where}: ${blocks.length} blocks`);
          else {
            const problems = validateJsonLd(JSON.parse(blocks[0]!), "HealthClub");
            if (problems.length) lacking.push(`${where}: ${problems.join("; ")}`);
          }
          const og = metaOf(r.body);
          const title = /<title>([^]*?)<\/title>/.exec(r.body)?.[1] ?? "";
          for (const p of ["og:type", "og:title", "og:description", "og:url"]) if (!og[p]) lacking.push(`${where}: no ${p}`);
          const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
          if (og["og:title"] !== unescape(title)) lacking.push(`${where}: og:title differs from <title>`);
        }
      }
      expect(lacking).toEqual([]);
    });
  }
});
