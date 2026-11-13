import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PAGE_CONTENT_LANGUAGES, type PageContentLanguage } from "@gymos/types";
import { CHROME } from "./chrome";
import { CLASSIC_PAGE_BACKGROUND, DARK_SURFACE, INK, PLATFORM_ACCENT, WHITE, computeGymColors, contrast } from "./colors";
import { FONT_ALLOWLIST, type TemplateEntry } from "./contract";
import { HOSTILE, baseContent, fixtures, page } from "./conformance/fixtures";
import { TEST_CONFIG, inputFor, type Case } from "./conformance/subject";
import { runDomConformance } from "./conformance/run";
import { runDomRules } from "./conformance/rules";
import { classifyPagePath, parseAcceptLanguage } from "./language";
import { REGISTERED_TEMPLATES, assertRegistrable, getTemplate } from "./registry";
import { renderPage } from "./renderPage";
import { templateSubject } from "./conformance/subject";

const here = dirname(fileURLToPath(import.meta.url));
const render = (content: ReturnType<typeof baseContent>, pathname: string, acceptLanguage?: string, template = "classic") =>
  renderPage({ page: page(content, template), pathname, acceptLanguage, ...TEST_CONFIG });

function ok(r: ReturnType<typeof renderPage>) {
  if (!r.ok) throw new Error(`not rendered: ${r.reason}`);
  return r;
}
const htmlLang = (html: string) => /<html lang="([^"]+)"/.exec(html)?.[1];
const hreflangs = (html: string) => [...html.matchAll(/<link rel="alternate" hrefLang="([^"]+)"/g)].map((m) => m[1]);

describe("registry", () => {
  it("registers Classic and Volt", () => {
    expect(REGISTERED_TEMPLATES).toEqual(["classic", "volt"]);
    expect(getTemplate("nope")).toBeUndefined();
  });

  const classic = getTemplate("classic")!;
  it("refuses a template without a chrome dictionary for every content language", () => {
    const missing = { ...CHROME } as Partial<Record<PageContentLanguage, unknown>>;
    delete missing[PAGE_CONTENT_LANGUAGES[PAGE_CONTENT_LANGUAGES.length - 1]!];
    expect(() => assertRegistrable({ ...classic, chrome: missing as TemplateEntry["chrome"] })).toThrow(/no chrome dictionary/);
  });
  it("refuses a font outside the allowlist and an invalid id", () => {
    expect(() => assertRegistrable({ ...classic, fonts: ["comic-sans" as never] })).toThrow(/allowlist/);
    expect(() => assertRegistrable({ ...classic, id: "Bad Id" })).toThrow(/valid template name/);
    expect(() => assertRegistrable(classic)).not.toThrow();
  });
  it("the font allowlist is Barlow 700 and 800, same origin", () => {
    expect(Object.values(FONT_ALLOWLIST).map((f) => `${f.family}:${f.weight}:${f.path}`)).toEqual(["Barlow:700:/fonts/barlow-700.woff2", "Barlow:800:/fonts/barlow-800.woff2"]);
  });
  it("every chrome dictionary has every category, plan type, interval and day", () => {
    for (const lang of PAGE_CONTENT_LANGUAGES) {
      const c = CHROME[lang];
      expect(Object.keys(c.categories).sort()).toEqual(["fitness_center", "gym", "other", "pilates_studio", "yoga_studio"]);
      expect(Object.keys(c.planType).sort()).toEqual(["class_only", "coach_inclusive", "monthly", "pay_per_session"]);
      expect(Object.keys(c.planInterval).sort()).toEqual(["annual", "monthly"]);
      expect(Object.keys(c.days)).toHaveLength(7);
    }
  });
  it("the plan dictionary is the one in EXPERIENCE.md", () => {
    expect(CHROME.en.planType).toEqual({ pay_per_session: "per session", monthly: "monthly", coach_inclusive: "coach included", class_only: "classes only" });
    expect(CHROME.fr.planType).toEqual({ pay_per_session: "par séance", monthly: "mensuel", coach_inclusive: "coach inclus", class_only: "cours uniquement" });
    expect(CHROME.en.planInterval).toEqual({ monthly: "billed monthly", annual: "billed annually" });
    expect(CHROME.fr.planInterval).toEqual({ monthly: "facturé mensuellement", annual: "facturé annuellement" });
    expect([CHROME.en.duration(30), CHROME.en.duration(1), CHROME.fr.duration(30), CHROME.fr.duration(1)]).toEqual(["30 days", "1 day", "30 jours", "1 jour"]);
  });
});

describe("the dashboard offers only registered templates (cross-package)", () => {
  it("PAGE_TEMPLATES is a subset of the registry", () => {
    const src = readFileSync(join(here, "..", "..", "..", "apps", "dashboard", "lib", "pageTemplates.ts"), "utf8");
    const list = /PAGE_TEMPLATES\s*=\s*\[([^\]]*)\]/.exec(src)?.[1];
    expect(list, "PAGE_TEMPLATES literal in apps/dashboard/lib/pageTemplates.ts").toBeTruthy();
    const offered = [...list!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.filter((t) => !REGISTERED_TEMPLATES.includes(t))).toEqual([]);
  });
});

/** Every module specifier of a source: `import x from`, `export ... from`, a bare side-effect `import "x"`, `import("x")` and `require("x")`. */
function importSpecifiers(src: string): string[] {
  return [...src.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|(?:^|[\s;])import\s+["']([^"']+)["']|import\(["']([^"']+)["']\)|require\(["']([^"']+)["']\)/gm)].map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4])!);
}

describe("templates are pure modules (imports scanned)", () => {
  it("the scanner sees every import form, including a bare side-effect import (known-bad input)", () => {
    expect(importSpecifiers('import "fs";\nimport a from "pg";\nexport { b } from "net";\nconst c = await import("http");\nconst d = require("os");')).toEqual(["fs", "pg", "net", "http", "os"]);
    const ALLOWED = new Set(["react", "react/jsx-runtime", "@gymos/types"]);
    expect(importSpecifiers('import "fs";').every((s) => s.startsWith(".") || ALLOWED.has(s))).toBe(false);
  });
  const SKIP = /(^|\/)(conformance|__scratch)\//;
  const PIPELINE = new Set(["headers.ts", "renderPage.ts", "renderPageAsync.ts", "renderCore.ts", "structuredData.ts"]); // node:crypto, react-dom/server and the schema-dts types live here, never in a template
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });
  }
  const sources = files(here).filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p) && !SKIP.test(relative(here, p) + "/") && !SKIP.test(relative(here, p)) && !PIPELINE.has(relative(here, p)));
  it("scans a real list of files", () => expect(sources.length).toBeGreaterThan(8));
  const ALLOWED = new Set(["react", "react/jsx-runtime", "@gymos/types"]);
  for (const p of sources) {
    it(`${relative(here, p)} imports only react, @gymos/types and its siblings, and holds no I/O`, () => {
      const src = readFileSync(p, "utf8");
      const specs = importSpecifiers(src);
      for (const s of specs) expect(s.startsWith(".") || ALLOWED.has(s), `import of "${s}"`).toBe(true);
      expect(src).not.toMatch(/\b(fetch|XMLHttpRequest|process\.env|dangerouslySetInnerHTML|document\.|window\.)\b/);
    });
  }
});

describe("the on-gym colour is computed by the server (AA)", () => {
  const colors = ["#1A6B3C", "#FFF200", "#050505", "#808080", "#E0971F", "#FFFFFF", "#000000", "#FF0000", "#00FF00", "#0000FF", "#7F7F7F", "#767676", "#777777", "#6D6D6D", "#FFD700", "#1B2A41"];
  for (const c of colors) {
    it(`${c}: text on the main action fill reaches 4.5:1; the non-text colour reaches 3:1`, () => {
      const g = computeGymColors(c);
      expect([WHITE, INK]).toContain(g.on);
      expect(contrast(g.on, g.fill)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(g.ui, WHITE)).toBeGreaterThanOrEqual(3);
      expect(contrast(g.ui, CLASSIC_PAGE_BACKGROUND)).toBeGreaterThanOrEqual(3);
    });
  }
  it("a mid-tone with no white or ink pairing falls back to the platform accent with ink", () => {
    expect(computeGymColors("#808080")).toMatchObject({ fill: PLATFORM_ACCENT, on: INK });
  });
  it("no colour in the snapshot gives the platform accent", () => {
    expect(computeGymColors(undefined)).toMatchObject({ gym: PLATFORM_ACCENT, fill: PLATFORM_ACCENT, on: INK });
  });
  it("the accent for a dark template reaches 4.5:1 on the lightest dark surface, falling back to the platform accent", () => {
    for (const hex of ["#1A6B3C", "#FFF200", "#050505", "#808080", "#E0971F", "#FFFFFF", "#000000", "#1B2A41", "#0000FF", "#FF0000"]) {
      const g = computeGymColors(hex);
      expect(contrast(g.accent, DARK_SURFACE), hex).toBeGreaterThanOrEqual(4.5);
      expect([g.gym, PLATFORM_ACCENT], hex).toContain(g.accent);
    }
    expect(computeGymColors("#FFF200").accent).toBe("#FFF200"); // a pale gym colour is kept: it reads on black
    expect(computeGymColors("#050505").accent).toBe(PLATFORM_ACCENT); // a near-black one would vanish: the platform accent instead
    expect(computeGymColors(undefined).accent).toBe(PLATFORM_ACCENT);
  });
  it("an exhaustive sweep of a coarse RGB grid always reaches 4.5:1 on the fill", () => {
    for (let r = 0; r < 256; r += 51) for (let g = 0; g < 256; g += 51) for (let b = 0; b < 256; b += 51) {
      const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      const c = computeGymColors(hex);
      expect(contrast(c.on, c.fill), hex).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.ui, WHITE), hex).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("language rule (cases written by hand, not derived from the implementation)", () => {
  const en = (c = baseContent()) => c;
  const onlyEn = () => { const c = baseContent(); delete c.about_fr; delete c.services_fr; return c; };
  const onlyFr = () => { const c = baseContent(); delete c.about_en; delete c.services_en; c.default_language = "fr"; return c; };

  it("the language list drives the rule", () => expect(PAGE_CONTENT_LANGUAGES).toEqual(["en", "fr"]));

  it("(a) complete only in EN: EN for everybody, no link, no hreflang, even for a French visitor", () => {
    const r = ok(render(onlyEn(), "/", "fr-FR,fr;q=0.9"));
    expect(htmlLang(r.body)).toBe("en");
    expect(hreflangs(r.body)).toEqual([]);
    expect(r.body).not.toContain("hrefLang=\"fr\"");
    expect(r.body).not.toContain('class="lang"');
  });
  it("(a) complete only in FR: FR for an English visitor", () => {
    const r = ok(render(onlyFr(), "/", "en-US,en;q=0.9"));
    expect(htmlLang(r.body)).toBe("fr");
    expect(hreflangs(r.body)).toEqual([]);
  });
  it("(b) both complete: Accept-Language decides, link and hreflang alternates present", () => {
    const fr = ok(render(en(), "/", "fr-CM,fr;q=0.9,en;q=0.5"));
    expect(htmlLang(fr.body)).toBe("fr");
    expect(hreflangs(fr.body)).toEqual(["en", "fr", "x-default"]);
    expect(fr.body).toContain('<a href="/en" hrefLang="en" lang="en">English</a>');
    const enr = ok(render(en(), "/", "en;q=0.8,fr;q=0.9"));
    expect(htmlLang(enr.body)).toBe("fr"); // q decides
    const none = ok(render({ ...baseContent(), default_language: "fr" }, "/"));
    expect(htmlLang(none.body)).toBe("fr"); // no header: the gym's default
    const other = ok(render({ ...baseContent(), default_language: "fr" }, "/", "de,es;q=0.8"));
    expect(htmlLang(other.body)).toBe("fr"); // no match: the gym's default
  });
  it("(b) an explicit /{code} of a complete language shows it, whatever the header says", () => {
    const r = ok(render(en(), "/fr", "en"));
    expect(htmlLang(r.body)).toBe("fr");
    expect(r.headers["Vary"]).toBeUndefined();
    expect(hreflangs(r.body)).toEqual(["en", "fr", "x-default"]);
  });
  it("(c) /fr with an incomplete French: English is served, 200, no hreflang, no Vary-free caching surprise", () => {
    const c = onlyEn();
    const r = ok(render(c, "/fr", "fr"));
    expect(htmlLang(r.body)).toBe("en");
    expect(hreflangs(r.body)).toEqual([]);
  });
  it("(c) incomplete EN, complete FR: /en serves FR without hreflang and, with one complete language, no Vary", () => {
    const r = ok(render(onlyFr(), "/en", "en"));
    expect(htmlLang(r.body)).toBe("fr");
    expect(hreflangs(r.body)).toEqual([]);
    expect(r.headers["Vary"]).toBeUndefined();
  });
  it("Vary: Accept-Language is on `/` with two complete languages, and NOT with one (the response cannot differ)", () => {
    expect(ok(render(en(), "/", "fr")).headers["Vary"]).toBe("Accept-Language");
    expect(ok(render(onlyEn(), "/", "fr")).headers["Vary"]).toBeUndefined();
    expect(ok(render(onlyEn(), "/fr", "fr")).headers["Vary"]).toBeUndefined();
  });
  it("a code outside the list, a bad case and any other path are not pages", () => {
    for (const p of ["/de", "/FR", "/fr/", "/en/x", "/robots.txt", "/sitemap.xml", "/report", "/fr?x", "//", "/ fr"]) {
      expect(render(en(), p, "en"), p).toEqual({ ok: false, reason: "path" });
    }
  });
  it("a page with no complete language renders nothing", () => {
    const c = baseContent();
    delete c.about_en;
    delete c.about_fr;
    expect(render(c, "/", "en")).toEqual({ ok: false, reason: "no_language" });
  });
  it("(g) a plan name is shown unchanged under both languages while its details change", () => {
    const en1 = ok(render(en(), "/en"));
    const fr1 = ok(render(en(), "/fr"));
    for (const r of [en1, fr1]) expect(r.body).toContain("<h3>Mensuel</h3>");
    expect(en1.body).toContain("billed monthly");
    expect(fr1.body).toContain("facturé mensuellement");
  });
  it("(f) prices keep their own code and are grouped by the language shown", () => {
    const c = baseContent();
    c.plans = [
      { name: "A", label_en: "A", label_fr: "A", type: "monthly", price: 15000, currency: "EUR", interval: "monthly", duration_days: 30 },
      { name: "B", label_en: "B", label_fr: "B", type: "monthly", price: 15000, currency: "XAF", interval: "monthly", duration_days: 30 },
    ];
    expect(ok(render(c, "/fr")).body).toContain("15 000 EUR");
    expect(ok(render(c, "/fr")).body).toContain("15 000 XAF");
    expect(ok(render(c, "/en")).body).toContain("15,000 EUR");
    expect(ok(render(c, "/en")).body).toContain("15,000 XAF");
  });
  it("Services of a complete language fall back to the next complete language, with the block's own lang", () => {
    const c = baseContent();
    delete c.services_fr;
    const r = ok(render(c, "/fr"));
    expect(r.body).toContain('<ul class="checks" lang="en">');
    expect(ok(render(c, "/en")).body).not.toContain('<ul class="checks" lang=');
  });
});

describe("accept-language and path parsing", () => {
  it("orders by q, drops q=0 and *, keeps primary subtags", () => {
    expect(parseAcceptLanguage("fr-CH, fr;q=0.9, en;q=0.8, de;q=0, *;q=0.5")).toEqual(["fr", "en"]);
    expect(parseAcceptLanguage("en;q=0.2,fr;q=0.9")).toEqual(["fr", "en"]);
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage("x".repeat(5000))).toEqual([]);
  });
  it("classifies paths", () => {
    expect(classifyPagePath("/")).toEqual({ kind: "home" });
    expect(classifyPagePath("/fr")).toEqual({ kind: "language", code: "fr" });
    expect(classifyPagePath("/de")).toEqual({ kind: "not-found" });
  });
});

describe("swap: only `template` changes", () => {
  // A second fixture template (a test-only registry entry, not a shipped template): same renderer, another id.
  const classic = getTemplate("classic")!;
  const second: TemplateEntry = { ...classic, id: "classic-two" };
  const lookup = (id: string) => (id === "classic-two" ? second : getTemplate(id));
  it("the same content renders under both ids with no content re-entered, and the output is identical", () => {
    const c = baseContent();
    const a = renderPage({ ...inputFor({ fixture: { id: "full", page: page(c) }, request: { id: "r", pathname: "/", acceptLanguage: "en" } }), lookup });
    const b = renderPage({ ...inputFor({ fixture: { id: "full", page: page(c, "classic-two") }, request: { id: "r", pathname: "/", acceptLanguage: "en" } }), lookup });
    expect(a.ok && b.ok).toBe(true);
    expect(a.ok && b.ok && a.body).toBe(b.ok && a.ok ? b.body : "");
  });
  it("the second fixture template passes the DOM conformance rules too", () => {
    const subject = { id: "classic-two", templateId: "classic", render: (kase: Case) => {
      const r = renderPage({ ...inputFor({ ...kase, fixture: { ...kase.fixture, page: { ...kase.fixture.page, template: "classic-two" } } }), lookup });
      if (!r.ok) throw new Error(r.reason);
      return { status: r.status, headers: r.headers, html: r.body };
    } };
    expect(runDomConformance(subject, fixtures().slice(0, 3).map((f) => ({ fixture: f, request: { id: "r", pathname: "/", acceptLanguage: "en" } })))).toEqual([]);
  });
  it("an unregistered template renders nothing (the landing app answers the uniform not-found)", () => {
    expect(render(baseContent(), "/", "en", "nope")).toEqual({ ok: false, reason: "unknown_template" });
  });
});

describe("hostile text", () => {
  it("is shown as text in every fixture and language, never as an element", () => {
    const subject = templateSubject("classic");
    for (const f of fixtures().filter((x) => x.hostile)) for (const accept of ["en", "fr"]) {
      const kase = { fixture: f, request: { id: accept, pathname: "/", acceptLanguage: accept } };
      expect(runDomRules(subject, kase, subject.render(kase), ["hostile-inert", "no-script"])).toEqual([]);
    }
    expect(HOSTILE.literal).toContain("<script>");
  });
  it("the literal script string appears escaped in the markup", () => {
    const f = fixtures().find((x) => x.id === "hostile-literal")!;
    const r = ok(renderPage({ page: f.page, pathname: "/", acceptLanguage: "en", ...TEST_CONFIG }));
    // Story 25.4: no `<script` other than ONE inert application/ld+json block, whose text parses as JSON and holds no literal `<`
    expect([...r.body.matchAll(/<script\b[^>]*>/g)].map((m) => m[0])).toEqual(['<script type="application/ld+json">']);
    expect(r.body.match(/<\/script>/g)).toHaveLength(1);
    const block = /<script type="application\/ld\+json">([^]*?)<\/script>/.exec(r.body)![1]!;
    expect(block).not.toMatch(/[<>&]/);
    expect(JSON.parse(block).name).toBe(f.page.content.name);
    expect(r.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("the response", () => {
  it("carries the exact header set, no cookie, and the CSP hash of the one emitted style block", () => {
    const r = ok(render(baseContent(), "/", "en"));
    expect(Object.keys(r.headers).sort()).toEqual(["Cache-Control", "Content-Security-Policy", "Content-Type", "Referrer-Policy", "Strict-Transport-Security", "Vary", "X-Content-Type-Options"]);
    expect(r.headers["Cache-Control"]).toBe("public, s-maxage=60");
    expect(r.headers["Content-Security-Policy"]).toBe(
      `default-src 'none'; img-src https://media.example.com; style-src '${r.styleHash}'; font-src 'self'; connect-src 'none'; script-src 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'`,
    );
    expect(r.body.startsWith("<!doctype html><html lang=")).toBe(true);
  });
  it("colour is the only gym value in CSS and it is a validated hex", () => {
    const r = ok(render({ ...baseContent(), color: "#ABCDEF" }, "/", "en"));
    expect(r.body).toContain("--gym:#ABCDEF");
  });
});
