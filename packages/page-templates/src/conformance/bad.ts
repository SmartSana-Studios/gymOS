// Story 24.10: known-bad fixtures. Each is the Classic pipeline output with ONE flaw applied; the suite must report exactly the rule the flaw
// breaks and nothing else. They prove the rules can fail (a conformance suite that cannot fail proves nothing) without shipping a second template.
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { fixtures, languageFixtures, type Fixture } from "./fixtures";
import type { Case, Rendered, Subject } from "./subject";
import { templateSubject } from "./subject";

export interface BadFlaw {
  id: string;
  /** The ONE rule that must fail. */
  rule: string;
  /** The fixture the flaw is applied to (default "full"). */
  fixture?: string;
  /** Applies the flaw to the parsed document. */
  dom?: (doc: Document) => void;
  /** Applies the flaw to the serialized document. */
  html?: (html: string) => string;
  /** Applies the flaw to the headers. */
  headers?: (h: Record<string, string>) => Record<string, string>;
  /** Keep the CSP hash of the unflawed style block (the flaw IS the stale hash). */
  staleHash?: boolean;
  /** The request (default home, Accept-Language en). */
  request?: Case["request"];
  /** Layout flaws: CSS appended to the style block (the CSP hash is recomputed so the browser applies it). */
  css?: string;
}

const q = (doc: Document, sel: string): Element => {
  const el = doc.querySelector(sel);
  if (!el) throw new Error(`known-bad fixture: no ${sel}`);
  return el;
};

function appendCss(doc: Document, css: string) {
  const style = q(doc, "style");
  style.textContent = `${style.textContent}\n${css}`;
}

export const BAD_FLAWS: BadFlaw[] = [
  // section-order
  { id: "plans-and-hours-swapped", rule: "section-order", dom: (d) => q(d, "[data-section=plans]").before(q(d, "[data-section=hours]")) },
  { id: "location-dropped", rule: "section-order", dom: (d) => q(d, "[data-section=location]").remove() },
  // omit-never-empty
  {
    id: "empty-gallery-section",
    rule: "omit-never-empty",
    fixture: "no-gallery",
    dom: (d) => {
      const s = d.createElement("section");
      s.setAttribute("data-section", "gallery");
      s.innerHTML = "<h2>Gallery</h2><p>No photos yet</p>";
      q(d, "[data-role=repeat-action]").before(s);
    },
  },
  { id: "empty-paragraph", rule: "omit-never-empty", dom: (d) => q(d, ".id").append(d.createElement("p")) },
  // no-script
  { id: "script-element", rule: "no-script", dom: (d) => { const s = d.createElement("script"); s.textContent = "alert(1)"; d.body.append(s); } },
  { id: "inline-handler", rule: "no-script", dom: (d) => q(d, "[data-action=call]").setAttribute("onclick", "x()") },
  { id: "javascript-url", rule: "no-script", dom: (d) => q(d, "a.pill").setAttribute("href", "javascript:alert(1)") },
  { id: "hydration-payload", rule: "no-script", html: (h) => h.replace("</body>", '<template id="__next_f"></template></body>') },
  // header-policy
  { id: "hsts-missing", rule: "header-policy", headers: (h) => { const { "Strict-Transport-Security": _s, ...rest } = h; void _s; return rest; } },
  { id: "csp-script-self", rule: "header-policy", headers: (h) => ({ ...h, "Content-Security-Policy": h["Content-Security-Policy"]!.replace("script-src 'none'", "script-src 'self'") }) },
  { id: "set-cookie", rule: "header-policy", headers: (h) => ({ ...h, "Set-Cookie": "a=b" }) },
  { id: "cache-control-long", rule: "header-policy", headers: (h) => ({ ...h, "Cache-Control": "public, s-maxage=3600" }) },
  { id: "stale-style-hash", rule: "header-policy", staleHash: true, dom: (d) => appendCss(d, ".zz{color:#000}") },
  { id: "vary-missing", rule: "header-policy", headers: (h) => { const { Vary: _v, ...rest } = h; void _v; return rest; } },
  // style-budget
  { id: "second-style-block", rule: "style-budget", dom: (d) => { const s = d.createElement("style"); s.textContent = ".zz{color:#000}"; q(d, "head").append(s); } },
  { id: "style-attribute", rule: "style-budget", dom: (d) => q(d, "h1").setAttribute("style", "color:red") },
  { id: "external-stylesheet", rule: "style-budget", dom: (d) => { const l = d.createElement("link"); l.setAttribute("rel", "stylesheet"); l.setAttribute("href", "/x.css"); q(d, "head").append(l); } },
  { id: "style-over-cap", rule: "style-budget", dom: (d) => appendCss(d, `/* ${"x".repeat(21000)} */`) },
  { id: "style-import", rule: "style-budget", dom: (d) => appendCss(d, '@import "/x.css";') },
  // media-origin
  { id: "image-from-elsewhere", rule: "media-origin", dom: (d) => q(d, "[data-section=gallery] img").setAttribute("src", "https://evil.example/x.webp") },
  { id: "css-background-image", rule: "media-origin", dom: (d) => appendCss(d, ".zz{background:url(https://evil.example/x.png)}") },
  // font-allowlist
  { id: "font-outside-allowlist", rule: "font-allowlist", dom: (d) => appendCss(d, 'h1{font-family:"Comic Sans MS"}') },
  { id: "font-face-external", rule: "font-allowlist", dom: (d) => appendCss(d, "@font-face{font-family:Barlow;src:url(https://fonts.gstatic.com/x.woff2)}") },
  { id: "font-without-fallback", rule: "font-allowlist", dom: (d) => appendCss(d, "h2{font-family:Barlow}") },
  // language
  { id: "html-lang-wrong", rule: "language", dom: (d) => d.documentElement.setAttribute("lang", "de") },
  { id: "hreflang-on-one-language", rule: "language", fixture: "only-en", dom: (d) => { const l = d.createElement("link"); l.setAttribute("rel", "alternate"); l.setAttribute("hreflang", "fr"); l.setAttribute("href", "https://grace.gymosapps.com/fr"); q(d, "head").append(l); } },
  { id: "chrome-in-the-wrong-language", rule: "language", request: { id: "home-fr", pathname: "/", acceptLanguage: "fr" }, html: (h) => h.replace(">Appeler<", ">Call<") },
  { id: "fallback-services-without-lang", rule: "language", fixture: "services-fallback", request: { id: "home-fr", pathname: "/", acceptLanguage: "fr" }, dom: (d) => q(d, "[data-section=services] [lang]").removeAttribute("lang") },
  { id: "language-link-missing", rule: "language", dom: (d) => q(d, "a[hreflang]").remove() },
  // plans
  { id: "plan-name-translated", rule: "plans", request: { id: "home-fr", pathname: "/", acceptLanguage: "fr" }, html: (h) => h.replace(">Mensuel<", ">Monthly<") },
  { id: "price-grouped-for-the-wrong-language", rule: "plans", request: { id: "home-fr", pathname: "/", acceptLanguage: "fr" }, html: (h) => h.replace(/15 000/g, "15,000") },
  { id: "price-currency-converted", rule: "plans", html: (h) => h.replace(/2,000 XAF/g, "$3.50") },
  // hostile-inert
  {
    id: "gym-text-becomes-an-element",
    rule: "hostile-inert",
    fixture: "hostile-entity",
    // the gym wrote the entity text "&lt;u data-pwn=1&gt;x&lt;/u&gt;"; React shows it as text ("&amp;lt;..."); a flawed template would decode it (here: in the address)
    dom: (d) => {
      const el = q(d, "[data-section=location] address");
      el.innerHTML = el.innerHTML.replace(/&amp;lt;u data-pwn=1&amp;gt;x&amp;lt;\/u&amp;gt;/g, "<u data-pwn=1>x</u>");
    },
  },
  // images-alt
  { id: "gallery-alt-missing", rule: "images-alt", dom: (d) => q(d, "[data-section=gallery] img").removeAttribute("alt") },
  { id: "banner-alt-not-empty", rule: "images-alt", dom: (d) => q(d, "[data-section=banner] img").setAttribute("alt", "A banner") },
  // links
  { id: "whatsapp-prefilled", rule: "links", dom: (d) => { const a = q(d, "[data-action=whatsapp]"); a.setAttribute("href", `${a.getAttribute("href")}?text=hello`); } },
  { id: "external-link-without-rel", rule: "links", dom: (d) => q(d, "[data-action=directions]").removeAttribute("rel") },
  { id: "call-is-not-tel", rule: "links", dom: (d) => q(d, "[data-action=call]").setAttribute("href", "https://wa.me/237600555000") },
  // footer
  { id: "report-link-missing", rule: "footer", dom: (d) => q(d, "[data-section=footer] a[href='/report']").remove() },
  { id: "repeat-action-missing", rule: "footer", dom: (d) => q(d, "[data-role=repeat-action]").remove() },
];

function restamp(base: Rendered, html: string, flaw: BadFlaw): Rendered {
  let headers = { ...base.headers };
  if (!flaw.staleHash) {
    const style = [...html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("");
    const hash = createHash("sha256").update(style, "utf8").digest("base64");
    headers["Content-Security-Policy"] = headers["Content-Security-Policy"]!.replace(/style-src '[^']*'/, `style-src 'sha256-${hash}'`);
  }
  if (flaw.headers) headers = flaw.headers(headers);
  return { status: base.status, headers, html };
}

/** The Classic pipeline output with the flaw applied. */
export function badSubject(flaw: BadFlaw): Subject {
  const base = templateSubject("classic");
  return {
    id: `bad:${flaw.id}`,
    templateId: "classic",
    render(kase) {
      const out = base.render(kase);
      let html = out.html;
      if (flaw.dom || flaw.css) {
        const dom = new JSDOM(html);
        flaw.dom?.(dom.window.document);
        if (flaw.css) appendCss(dom.window.document, flaw.css);
        html = `<!doctype html>${dom.window.document.documentElement.outerHTML}`;
      }
      if (flaw.html) html = flaw.html(html);
      return restamp(out, html, flaw);
    },
  };
}

export function badCase(flaw: BadFlaw, all: Fixture[] = [...fixtures(), ...languageFixtures().map((l) => ({ id: l.id, page: l.page }))]): Case {
  const fixture = flaw.fixture ? all.find((f) => f.id === flaw.fixture) : all[0];
  if (!fixture) throw new Error(`no fixture ${flaw.fixture}`);
  return { fixture, request: flaw.request ?? { id: "home-en", pathname: "/", acceptLanguage: "en" } };
}

/** Layout flaws (judged in Chromium by layout.ts). `csp-browser` is the stale hash: the browser must refuse the inline style. */
export const BAD_LAYOUT_FLAWS: BadFlaw[] = [
  { id: "footer-wider-than-the-screen", rule: "no-overflow", css: ".ft{width:900px}" },
  { id: "text-over-text", rule: "text-overlap", css: ".id h1{margin-top:-30px}" },
  { id: "contact-below-the-fold", rule: "contact-first-screen", css: ".hero{min-height:1400px}" },
  { id: "tiny-footer-links", rule: "tap-target", css: ".ft a{display:inline;min-height:0;line-height:1}" },
  { id: "pale-secondary-text", rule: "contrast", css: ".ab p{color:#B5BAAE}" },
  { id: "header-moved-below-the-contact-actions", rule: "visual-order", css: ".hero{flex-direction:column-reverse}" },
  { id: "inline-style-not-covered-by-the-hash", rule: "csp-browser", staleHash: true, css: ".zz{color:#000}" },
];
