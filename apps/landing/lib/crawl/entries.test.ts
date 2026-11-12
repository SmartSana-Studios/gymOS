// Story 25.5: the entry builder and the XML renderers as pure functions: the rule, the order, the escaping.
import { describe, expect, it } from "vitest";
import { buildEntries, chunkCount, chunkOf } from "./entries";
import { renderSitemapIndex, renderUrlset } from "./xml";

const WWW = "https://www.gymosapps.com";
const country = (countryCode: string, publishedCount: number, indexable = publishedCount >= 3) => ({ countryCode, nameEn: countryCode, nameFr: countryCode, publishedCount, indexable });
const paths = (e: ReturnType<typeof buildEntries>) => e.map((x) => x.loc.slice(WWW.length));

describe("buildEntries", () => {
  it("sorts countries and cities by code and slug whatever order the reads came in", () => {
    const e = buildEntries(WWW, {
      countries: [country("SN", 3), country("CM", 6)],
      totals: [{ countryCode: "SN", listedCount: 3 }, { countryCode: "CM", listedCount: 6 }],
      cities: [{ countryCode: "SN", citySlug: "dakar" }, { countryCode: "CM", citySlug: "yaounde" }, { countryCode: "CM", citySlug: "douala" }],
    });
    expect(paths(e)).toEqual([
      "/en", "/fr", "/en/gyms", "/fr/gyms",
      "/en/gyms/cm", "/fr/gyms/cm", "/en/gyms/cm/douala", "/fr/gyms/cm/douala", "/en/gyms/cm/yaounde", "/fr/gyms/cm/yaounde",
      "/en/gyms/sn", "/fr/gyms/sn", "/en/gyms/sn/dakar", "/fr/gyms/sn/dakar",
    ]);
  });
  it("every entry carries en, fr and x-default (= en) alternates of the same page", () => {
    const e = buildEntries(WWW, { countries: [], totals: [], cities: [] });
    expect(e.map((x) => x.alternates)).toEqual([
      { en: `${WWW}/en`, fr: `${WWW}/fr`, xDefault: `${WWW}/en` },
      { en: `${WWW}/en`, fr: `${WWW}/fr`, xDefault: `${WWW}/en` },
      { en: `${WWW}/en/gyms`, fr: `${WWW}/fr/gyms`, xDefault: `${WWW}/en/gyms` },
      { en: `${WWW}/en/gyms`, fr: `${WWW}/fr/gyms`, xDefault: `${WWW}/en/gyms` },
    ]);
  });
  it("never lists a city of a country with no gym in its city rows, a malformed country code, a slug the city page refuses, or a repeated row", () => {
    const e = buildEntries(WWW, {
      countries: [country("CM", 3), country("cm", 3), country("CMR", 3), country("SN", 3), country("CM", 3)],
      totals: [{ countryCode: "CM", listedCount: 3 }, { countryCode: "cm", listedCount: 3 }, { countryCode: "CMR", listedCount: 3 }],
      cities: [
        { countryCode: "CM", citySlug: "douala" },
        { countryCode: "CM", citySlug: "douala" },
        { countryCode: "CM", citySlug: "Bad Slug" },
        { countryCode: "CM", citySlug: "a/../b" },
        { countryCode: "CM", citySlug: "a".repeat(61) },
        { countryCode: "SN", citySlug: "dakar" },
      ],
    });
    expect(paths(e)).toEqual(["/en", "/fr", "/en/gyms", "/fr/gyms", "/en/gyms/cm", "/fr/gyms/cm", "/en/gyms/cm/douala", "/fr/gyms/cm/douala"]);
  });
});

describe("chunking", () => {
  it("is at least one file, and ceil(total / size) otherwise; a file holds at most size entries", () => {
    expect(chunkCount(0, 50_000)).toBe(1);
    expect(chunkCount(50_000, 50_000)).toBe(1);
    expect(chunkCount(50_001, 50_000)).toBe(2);
    expect(chunkCount(100_001, 50_000)).toBe(3);
    const e = buildEntries(WWW, { countries: [], totals: [], cities: [] });
    expect(chunkOf(e, 1, 3)).toHaveLength(3);
    expect(chunkOf(e, 2, 3)).toHaveLength(1);
    expect(chunkOf(e, 3, 3)).toHaveLength(0);
  });
});

describe("the XML renderers", () => {
  it("escape every value: a hostile loc or alternate cannot close an element or add one", () => {
    const evil = `${WWW}/en"><x/>&</loc><loc>`;
    const xml = renderUrlset([{ loc: evil, alternates: { en: evil, fr: evil, xDefault: evil } }]);
    expect(xml).not.toContain("<x/>");
    expect(xml.match(/<loc>/g)).toHaveLength(1);
    expect(xml).toContain("&quot;&gt;&lt;x/&gt;&amp;&lt;/loc&gt;&lt;loc&gt;");
    expect(renderSitemapIndex(`${WWW}"<`, 1)).not.toContain('"<');
  });
  it("the index lists /sitemaps/1.xml to /sitemaps/N.xml and carries no lastmod", () => {
    const xml = renderSitemapIndex(WWW, 3);
    expect([...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1])).toEqual([1, 2, 3].map((n) => `${WWW}/sitemaps/${n}.xml`));
    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).not.toContain("lastmod");
  });
});
