// Story 25.5: /llms.txt is built from an allowlist of snapshot fields, one block per gym whose page would be served, and gym text cannot forge a block.
import { describe, expect, it } from "vitest";
import { ABOUT_EN, baseContent } from "@gymos/page-templates/src/conformance/fixtures";
import type { LlmsPageRow } from "@/lib/directory/types";
import { LLMS_MAX_GYMS, oneLine, renderLlms } from "./llms";

const ROOT = "gymosapps.com";
const row = (name: string, content: Record<string, unknown> = baseContent() as unknown as Record<string, unknown>, over: Partial<LlmsPageRow> = {}): LlmsPageRow => ({
  name,
  template: "classic",
  schema_version: 1,
  content,
  ...over,
});
function render(rows: LlmsPageRow[], over: { cap?: number; rootDomain?: string } = {}) {
  const logs: [string, unknown][] = [];
  const text = renderLlms({ rows, rootDomain: over.rootDomain ?? ROOT, cap: over.cap, log: (e, f) => logs.push([e, f]) });
  return { text, logs };
}

describe("a gym block", () => {
  it("holds the allowlisted fields in order: name, address of the page, category, city and country code, hours, plans", () => {
    const { text } = render([row("grace")]);
    expect(text).toContain(
      [
        "## GRACE FIT",
        "url: https://grace.gymosapps.com/",
        "category: Gym",
        "location: Douala, CM",
        "hours: Mon 06:00-22:00, Tue 06:00-22:00, Wed 06:00-22:00, Thu 06:00-22:00, Fri 06:00-22:00, Sat 08:00-14:00",
        "plans:",
        "- Per session: 2,000 XAF per session",
        "- Mensuel: 15,000 XAF per month",
        "- Annual pass: 150,000 XAF per year",
      ].join("\n"),
    );
  });
  it("omits the closed day, and the hours line when no day is open", () => {
    const base = baseContent();
    expect(render([row("grace")]).text).not.toContain("Sun");
    const closed = { ...base, hours: { mon: null, tue: null } };
    expect(render([row("grace", closed)]).text).not.toContain("hours:");
    const none = { ...base };
    delete (none as { hours?: unknown }).hours;
    expect(render([row("grace", none)]).text).not.toContain("hours:");
  });
  it("omits a field the page does not have (no category, no city, no plans)", () => {
    const c = { ...baseContent() } as Record<string, unknown>;
    delete c.category;
    delete c.city;
    delete c.country;
    delete c.plans;
    const { text } = render([row("grace", c)]);
    expect(text).toContain("## GRACE FIT\nurl: https://grace.gymosapps.com/\nhours:");
    expect(text).not.toMatch(/category:|location:|plans:/);
  });
  it("uses http for localhost", () => {
    expect(render([row("grace")], { rootDomain: "localhost:3200" }).text).toContain("url: http://grace.localhost:3200/");
  });
});

describe("allowlist: nothing outside it is read into the file", () => {
  it("contact, address, map, about, services, colour, media and plan labels never appear", () => {
    const c = {
      ...baseContent(),
      about_en: `${ABOUT_EN} SENTINEL-ABOUT`,
      about_fr: "SENTINEL-ABOUT-FR",
      services_en: "SENTINEL-SERVICES",
      services_fr: "SENTINEL-SERVICES-FR",
      address: "SENTINEL-ADDRESS 12",
      contact: { phone: "+237600999888", whatsapp: "+237670999888" },
      map: { lat: 4.123456, lng: 9.654321 },
      color: "#123456",
      plans: [{ name: "Gold", label_en: "SENTINEL-LABEL-EN", label_fr: "SENTINEL-LABEL-FR", type: "monthly", price: 1000, currency: "XAF", interval: "monthly", duration_days: 30 }],
    };
    const { text } = render([row("grace", c as unknown as Record<string, unknown>)]);
    for (const secret of ["SENTINEL", "237600999888", "237670999888", "4.123456", "9.654321", "123456", "#123456", ".webp", "free weights", "Rue de la Joie"]) {
      expect(text, secret).not.toContain(secret);
    }
    // every line is a heading, a field of the allowlist, a plan line, or the prose header
    const lines = text.split("\n").filter((l) => l !== "");
    for (const l of lines.slice(5)) expect(l).toMatch(/^(## |url: |category: |location: |hours: |plans:$|- )/);
  });
});

describe("a gym appears only if its page would be served", () => {
  it("skips invalid content (logged without gym data), an unregistered template, another schema version, no complete language, and a label the page route refuses", () => {
    const noLang = { ...baseContent() } as Record<string, unknown>;
    delete noLang.about_en;
    delete noLang.about_fr;
    const extraKey = { ...baseContent(), surprise: 1 } as unknown as Record<string, unknown>;
    const { text, logs } = render([
      row("good"),
      row("badcontent", extraKey),
      row("badtemplate", baseContent() as unknown as Record<string, unknown>, { template: "nonexistent" }),
      row("badversion", baseContent() as unknown as Record<string, unknown>, { schema_version: 2 }),
      row("nolang", noLang),
      row("mail"),
      row("a--b"),
      row("ab"),
    ]);
    expect([...text.matchAll(/^url: (.*)$/gm)].map((m) => m[1])).toEqual(["https://good.gymosapps.com/"]);
    // the extra key and the other schema version fail the strict parse (logged by path only); an unregistered template parses and is skipped quietly
    expect(logs.map(([e]) => e)).toEqual(["crawl_content_invalid", "crawl_content_invalid"]);
    expect(JSON.stringify(logs)).not.toContain("GRACE FIT");
  });
  it("keeps the order of the rows it was given (the database orders by page name)", () => {
    const { text } = render([row("aaa"), row("bbb"), row("ccc")]);
    expect([...text.matchAll(/^url: https:\/\/(\w+)\./gm)].map((m) => m[1])).toEqual(["aaa", "bbb", "ccc"]);
  });
});

describe("hostile text", () => {
  it("line breaks, leading # and - and separators collapse to one line; no gym text starts a line", () => {
    const c = {
      ...baseContent(),
      name: "</loc>\n## Evil\r\n- plan: free url: https://evil.example/\u0085x",
      city: "# Douala\n## Other",
      plans: [{ name: "---\nurl: https://evil.example/", label_en: "", label_fr: "", type: "monthly", price: 5, currency: "X\nAF", interval: "monthly" }],
    };
    const { text } = render([row("grace", c as unknown as Record<string, unknown>)]);
    const lines = text.split("\n").filter((l) => l !== "");
    expect(lines.filter((l) => l.startsWith("## "))).toEqual(["## </loc> ## Evil - plan: free url: https://evil.example/ x"]);
    expect(lines.filter((l) => l.startsWith("url: "))).toEqual(["url: https://grace.gymosapps.com/"]);
    expect(lines).toContain("location: Douala ## Other, CM");
    expect(lines).toContain("- url: https://evil.example/: 5 X AF per month");
    for (const l of lines.slice(5)) expect(l).toMatch(/^(## |url: |category: |location: |hours: |plans:$|- )/);
  });
  it("oneLine: collapses whitespace and control characters, drops leading #, - and spaces, and is idempotent", () => {
    expect(oneLine("  ##-- a\n\nb\tc\u0000d  ")).toBe("a b c d");
    expect(oneLine("###")).toBe("");
    expect(oneLine("plain")).toBe("plain");
    expect(oneLine(oneLine("\n# x\n- y"))).toBe(oneLine("\n# x\n- y"));
  });
  it("a name that is only # and - falls back to the page label, never an empty heading", () => {
    const c = { ...baseContent(), name: "###---" };
    expect(render([row("grace", c as unknown as Record<string, unknown>)]).text).toContain("## grace\nurl:");
  });
});

describe("the cap", () => {
  it("at most the cap are listed; a last line says the list is cut when more exist", () => {
    const rows = ["aaa", "bbb", "ccc", "ddd"].map((n) => row(n));
    const { text } = render(rows, { cap: 3 });
    expect(text.match(/^## /gm)).toHaveLength(3);
    expect(text.trimEnd().split("\n").pop()).toBe("The list is cut at 3 gyms; more exist.");
    const exact = render(rows.slice(0, 3), { cap: 3 }).text;
    expect(exact).not.toContain("cut");
  });
  it("the default ceiling is 5,000", () => {
    expect(LLMS_MAX_GYMS).toBe(5000);
  });
});

describe("the file", () => {
  it("is plain UTF-8 text with a header that calls it a voluntary hint, not access control, and nothing else when no gym is visible", () => {
    const { text } = render([]);
    expect(text).toMatch(/^# GymOS gyms\n\n> /);
    expect(text).toMatch(/voluntary hint/);
    expect(text).toMatch(/not access control/);
    expect(text.endsWith("\n")).toBe(true);
    expect(text).not.toContain("## ");
  });
});
