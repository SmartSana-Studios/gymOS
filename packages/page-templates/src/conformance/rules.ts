// Story 24.10: the DOM-level rules of the conformance suite (EXPERIENCE.md "Template contract"). Each rule reads ONE response (the headers and
// the HTML) and returns the violations of that rule. The expectations are written here, not read from the template: the CSP is a literal
// string, the font allowlist is a literal list, the section order is a literal list. The layout rules (Chromium) are in layout.ts.
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { PAGE_HOURS_DAYS, type PageContentLanguage, type PageContentSnapshotV1, completePageLanguages } from "@gymos/types";
import { getTemplate } from "../registry";
import { classifyPagePath, decideLanguage, type LanguageDecision } from "../language";
import { CHROME } from "../chrome";
import type { Chrome } from "../contract";
import type { Case, Rendered, Subject } from "./subject";
import { MEDIA_BASE, PAGE_ORIGIN, TEST_CONFIG, WWW_ORIGIN } from "./subject";
import { validateJsonLd } from "../structuredData.fixtures";
import { pageTitle } from "../format";

export const DOM_RULE_IDS = [
  "section-order",
  "omit-never-empty",
  "no-script",
  "structured-data",
  "header-policy",
  "style-budget",
  "media-origin",
  "font-allowlist",
  "language",
  "plans",
  "hostile-inert",
  "images-alt",
  "links",
  "footer",
] as const;
export type DomRuleId = (typeof DOM_RULE_IDS)[number];

export interface Violation {
  rule: string;
  message: string;
}

export interface RuleContext {
  subject: Subject;
  kase: Case;
  out: Rendered;
  doc: Document;
  html: string;
  /** The text of the one style block (empty when there is none). */
  style: string;
  content: PageContentSnapshotV1;
  decision: LanguageDecision;
  chrome: Chrome;
}

const SECTION_IDS = ["header", "banner", "contact", "about", "services", "plans", "hours", "location", "gallery", "footer"] as const;
const FONT_PATHS = ["/fonts/barlow-700.woff2", "/fonts/barlow-800.woff2"];
const FONT_NAMES = ["barlow", "helvetica neue", "helvetica", "arial", "system-ui", "-apple-system", "segoe ui", "roboto", "ui-sans-serif", "ui-serif", "sans-serif", "serif"];
const GENERIC = ["sans-serif", "serif", "system-ui"];
export const STYLE_CAP_BYTES = 20_000;
export const HTML_CAP_BYTES = 150_000;

export function parseHtml(html: string): Document {
  return new JSDOM(html).window.document;
}

export function buildContext(subject: Subject, kase: Case, out: Rendered): RuleContext {
  const doc = parseHtml(out.html);
  const style = [...out.html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("");
  const path = classifyPagePath(kase.request.pathname);
  if (path.kind === "not-found") throw new Error("conformance cases use page paths only");
  const content = kase.fixture.page.content;
  const decision = decideLanguage(content, path, kase.request.acceptLanguage);
  if (!decision) throw new Error(`fixture ${kase.fixture.id} has no complete language`);
  const entry = getTemplate(subject.templateId);
  const chrome = (entry?.chrome ?? CHROME)[decision.shown];
  return { subject, kase, out, doc, html: out.html, style, content, decision, chrome };
}

/** The visible text of an element, with a space at every element boundary, whitespace collapsed (a NBSP counts as a space). */
function text(e: Element | null | undefined): string {
  if (!e) return "";
  const parts: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) parts.push(n.textContent ?? "");
    else if (n.nodeType === 1) {
      parts.push(" ");
      n.childNodes.forEach(walk);
      parts.push(" ");
    }
  };
  e.childNodes.forEach(walk);
  return parts.join("").replace(/\s+/g, " ").trim();
}

function textOf(content: PageContentSnapshotV1, key: "about" | "services", lang: PageContentLanguage): string | undefined {
  const v = (content as Record<string, unknown>)[`${key}_${lang}`];
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

const nonEmptyLines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** The ten sections, in order, that this content must render. */
function expectedSections(ctx: RuleContext): string[] {
  const c = ctx.content;
  const complete = completePageLanguages(c);
  const has: Record<(typeof SECTION_IDS)[number], boolean> = {
    header: true,
    banner: Boolean(c.banner),
    contact: Boolean(c.contact?.phone || c.contact?.whatsapp || c.map),
    about: true,
    services: complete.some((l) => textOf(c, "services", l) !== undefined),
    plans: (c.plans?.length ?? 0) > 0,
    hours: c.hours !== undefined,
    location: Boolean(c.address || c.city || c.country),
    gallery: (c.gallery?.length ?? 0) > 0,
    footer: true,
  };
  return SECTION_IDS.filter((id) => has[id]);
}

const LD_JSON = "application/ld+json";

const rules: Record<DomRuleId, (ctx: RuleContext) => string[]> = {
  "section-order"(ctx) {
    const found = [...ctx.doc.querySelectorAll("[data-section]")].map((e) => e.getAttribute("data-section") ?? "");
    const expected = expectedSections(ctx);
    // a section without data is the "omit, never empty" rule's concern; here: every section that has data, once, in the fixed order
    const present = found.filter((f) => expected.includes(f));
    return JSON.stringify(present) === JSON.stringify(expected) ? [] : [`sections are [${found.join(", ")}], expected [${expected.join(", ")}]`];
  },

  "omit-never-empty"(ctx) {
    const v: string[] = [];
    const expected = expectedSections(ctx);
    for (const el of ctx.doc.querySelectorAll("[data-section]")) {
      const id = el.getAttribute("data-section") ?? "";
      if (!expected.includes(id)) v.push(`section ${id} is rendered although the gym has no data for it`);
      if (id === "banner") continue;
      if (text(el) === "" && !el.querySelector("img")) v.push(`section ${id} is empty`);
      if (id !== "header" && id !== "footer" && id !== "contact" && el.querySelector("h2") && !el.querySelector("img") && text(el) === text(el.querySelector("h2"))) v.push(`section ${id} has a heading and no content`);
    }
    for (const el of ctx.doc.body.querySelectorAll("li, p, h1, h2, h3, address")) {
      if (text(el) === "" && !el.querySelector("img")) v.push(`an empty <${el.tagName.toLowerCase()}>`);
    }
    const body = text(ctx.doc.body);
    const placeholder = /\b(undefined|null|NaN)\b|\[object|No photos|No gallery|\bN\/A\b/;
    // the hostile fixtures print the word "script" etc.; they never print these placeholders
    if (placeholder.test(body.replace(ctx.kase.fixture.hostile?.join(" ") ?? "", ""))) v.push(`placeholder text on the page: ${body.match(placeholder)?.[0]}`);
    return v;
  },

  "no-script"(ctx) {
    const v: string[] = [];
    // Story 25.4: executable script stays banned; the ONE allowed script is the inert JSON-LD data block, and its text must parse as JSON. How many blocks there are is the structured-data rule's.
    ctx.doc.querySelectorAll("script").forEach((e) => {
      if (e.getAttribute("type") !== LD_JSON) v.push("<script> is not allowed (only the application/ld+json data block)");
      else if (e.attributes.length !== 1) v.push(`the application/ld+json block carries an attribute besides type (${[...e.attributes].map((a) => a.name).filter((n) => n !== "type").join(", ")})`);
      else {
        try {
          JSON.parse(e.textContent ?? "");
        } catch {
          v.push("the application/ld+json block is not valid JSON");
        }
      }
    });
    const banned = ctx.doc.querySelectorAll("iframe, frame, frameset, object, embed, applet, base, form, link[rel~=modulepreload], link[rel~=prefetch], meta[http-equiv=refresh]");
    banned.forEach((e) => v.push(`<${e.tagName.toLowerCase()}> is not allowed`));
    for (const el of ctx.doc.querySelectorAll("*")) {
      for (const a of el.attributes) {
        if (/^on/i.test(a.name)) v.push(`inline handler ${a.name} on <${el.tagName.toLowerCase()}>`);
        if (/^(href|src|action|formaction|xlink:href)$/i.test(a.name) && /^\s*(javascript|vbscript|data:text\/html)/i.test(a.value)) v.push(`script URL in ${a.name}`);
      }
    }
    if (/__NEXT_DATA__|self\.__next|__next_f|hydrat/i.test(ctx.html)) v.push("hydration payload");
    return v;
  },

  "structured-data"(ctx) {
    // Story 25.4 (AD-51): every response of every registered template carries exactly one HealthClub block and the Open Graph tags, whatever the template does.
    const v: string[] = [];
    const { doc, content, decision } = ctx;
    const blocks = [...doc.querySelectorAll("script")].filter((e) => e.getAttribute("type") === LD_JSON);
    if (blocks.length !== 1) v.push(`${blocks.length} application/ld+json blocks, expected exactly one`);
    const block = blocks[0];
    if (block) {
      if (block.parentElement?.tagName !== "HEAD") v.push("the JSON-LD block is not in <head>");
      const raw = block.textContent ?? "";
      // inert: no character that could close the block or start markup; the escapes carry them
      if (/[<>&\u2028\u2029]/.test(raw)) v.push("the JSON-LD text holds an unescaped < > & or line separator");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = undefined; // not JSON: the no-script rule reports it
      }
      if (parsed !== undefined) {
        v.push(...validateJsonLd(parsed, "HealthClub"));
        const node = parsed as Record<string, unknown>;
        if (node["name"] !== content.name) v.push("the JSON-LD name is not the gym name as entered");
        if (node["url"] !== `${PAGE_ORIGIN}/`) v.push(`the JSON-LD url is ${JSON.stringify(node["url"])}, expected ${PAGE_ORIGIN}/ (one URL per gym page)`);
        const addr = (node["address"] ?? {}) as Record<string, unknown>;
        if (content.country && addr["addressCountry"] !== content.country) v.push("addressCountry is not the stored ISO code");
        if (Boolean(node["geo"]) !== Boolean(content.map)) v.push("geo must exist exactly when there is a map position");
        if (Boolean(node["openingHoursSpecification"]) !== Object.values(content.hours ?? {}).some(Boolean)) v.push("openingHoursSpecification must exist exactly when a day is open");
        if (Boolean(node["telephone"]) !== Boolean(content.contact?.phone)) v.push("telephone must exist exactly when there is a phone number");
        for (const u of [...((node["image"] as string[] | undefined) ?? []), ...(node["logo"] ? [node["logo"] as string] : [])]) if (!u.startsWith(`${MEDIA_BASE}/`)) v.push(`JSON-LD image outside the media origin: ${u.slice(0, 60)}`);
      }
    }
    const metas = Object.fromEntries([...doc.querySelectorAll("meta[property^=\"og:\"]")].map((m) => [m.getAttribute("property") ?? "", m.getAttribute("content") ?? ""]));
    const ogCount = doc.querySelectorAll("meta[property^=\"og:\"]").length;
    for (const p of ["og:type", "og:title", "og:description", "og:url"]) if (!metas[p]) v.push(`missing ${p}`);
    if (ogCount !== Object.keys(metas).length) v.push("a duplicate og: tag");
    const title = doc.querySelector("title")?.textContent ?? "";
    if (metas["og:type"] !== "website") v.push(`og:type is ${JSON.stringify(metas["og:type"])}, expected "website"`);
    if (metas["og:title"] !== title) v.push(`og:title is ${JSON.stringify(metas["og:title"])}, the <title> is ${JSON.stringify(title)}`);
    if (metas["og:title"] !== pageTitle(content, decision.shown)) v.push("og:title is not the shared page title");
    if (metas["og:url"] !== `${PAGE_ORIGIN}/`) v.push(`og:url is ${JSON.stringify(metas["og:url"])}, expected ${PAGE_ORIGIN}/ (never the request host)`);
    const imageKey = content.banner ?? content.logo ?? content.gallery?.[0];
    const wantImage = imageKey ? `${MEDIA_BASE}/${imageKey}` : undefined;
    if (metas["og:image"] !== wantImage) v.push(`og:image is ${JSON.stringify(metas["og:image"])}, expected ${JSON.stringify(wantImage)}`);
    return v;
  },

  "header-policy"(ctx) {
    const v: string[] = [];
    const h = Object.fromEntries(Object.entries(ctx.out.headers).map(([k, val]) => [k.toLowerCase(), val]));
    if (ctx.out.status !== 200) v.push(`status ${ctx.out.status}`);
    const hash = createHash("sha256").update(ctx.style, "utf8").digest("base64");
    const csp =
      `default-src 'none'; img-src ${TEST_CONFIG.mediaOrigin}; style-src 'sha256-${hash}'; font-src 'self'; connect-src 'none'; script-src 'none'; ` +
      `base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'`;
    if (h["content-security-policy"] !== csp) v.push(`CSP is ${JSON.stringify(h["content-security-policy"])}, expected ${JSON.stringify(csp)}`);
    const want: Record<string, string> = {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, s-maxage=60",
      "content-security-policy": csp,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "strict-transport-security": "max-age=63072000; includeSubDomains",
    };
    if (ctx.decision.vary) want["vary"] = "Accept-Language";
    for (const [k, val] of Object.entries(want)) if (h[k] !== val) v.push(`${k} is ${JSON.stringify(h[k])}, expected ${JSON.stringify(val)}`);
    for (const k of Object.keys(h)) if (!(k in want)) v.push(`unexpected header ${k}`);
    return v;
  },

  "style-budget"(ctx) {
    const v: string[] = [];
    const styles = ctx.doc.querySelectorAll("style");
    if (styles.length !== 1) v.push(`${styles.length} <style> elements, expected exactly one`);
    else if (styles[0]!.parentElement?.tagName !== "HEAD") v.push("the style block is not in <head>");
    ctx.doc.querySelectorAll("link[rel~=stylesheet]").forEach(() => v.push("an external stylesheet"));
    ctx.doc.querySelectorAll("[style]").forEach((e) => v.push(`a style attribute on <${e.tagName.toLowerCase()}> (blocked by the CSP)`));
    if (/@import/i.test(ctx.style)) v.push("@import in the style block");
    if (Buffer.byteLength(ctx.style, "utf8") > STYLE_CAP_BYTES) v.push(`style block is ${Buffer.byteLength(ctx.style, "utf8")} bytes, cap ${STYLE_CAP_BYTES}`);
    if (Buffer.byteLength(ctx.html, "utf8") > HTML_CAP_BYTES) v.push(`page is ${Buffer.byteLength(ctx.html, "utf8")} bytes, cap ${HTML_CAP_BYTES}`);
    if (/&(lt|gt|amp|quot|#x27|#39);/.test(ctx.style)) v.push("the style text carries HTML entities (it would reach the browser altered)");
    return v;
  },

  "media-origin"(ctx) {
    const v: string[] = [];
    ctx.doc.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") ?? "";
      if (!src.startsWith(`${MEDIA_BASE}/`)) v.push(`image outside the media origin: ${src.slice(0, 80)}`);
      if (img.hasAttribute("srcset")) v.push("srcset is not allowed");
    });
    ctx.doc.querySelectorAll("link[href]").forEach((l) => {
      const rel = l.getAttribute("rel") ?? "";
      const href = l.getAttribute("href") ?? "";
      if (rel === "alternate" || /\bstylesheet\b/.test(rel)) return; // an external stylesheet is the style-budget rule's concern
      if (rel === "preload" && l.getAttribute("as") === "image" && href.startsWith(`${MEDIA_BASE}/`)) return;
      if (rel === "preload" && l.getAttribute("as") === "font" && FONT_PATHS.includes(href)) return;
      v.push(`<link rel=${rel}> to ${href.slice(0, 60)}`);
    });
    ctx.doc.querySelectorAll("video, audio, source, picture, track, svg image, use").forEach((e) => v.push(`<${e.tagName.toLowerCase()}> is not allowed`));
    // CSS url() outside @font-face (fonts are the font-allowlist rule's concern): there is no image in CSS
    for (const m of ctx.style.replace(/@font-face\s*\{[^}]*\}/gi, "").matchAll(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)) {
      v.push(`CSS url() to ${m[2]!.slice(0, 60)}`);
    }
    return v;
  },

  "font-allowlist"(ctx) {
    const v: string[] = [];
    for (const m of ctx.style.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
      const urls = [...m[1]!.matchAll(/url\(\s*['"]?([^)'"]*)['"]?\s*\)/gi)].map((u) => u[1]!);
      if (urls.length === 0) v.push("an @font-face with no url");
      for (const u of urls) if (!FONT_PATHS.includes(u)) v.push(`@font-face source outside the allowlist: ${u.slice(0, 60)}`);
    }
    // every font stack (font-family and custom properties that hold one) names allowed families and ends in a system fallback
    const stacks: string[] = [];
    const css = ctx.style.replace(/@font-face\s*\{[^}]*\}/gi, "");
    for (const m of css.matchAll(/(font-family|--[a-z0-9-]+)\s*:\s*([^;}]+)/gi)) {
      const prop = m[1]!.toLowerCase();
      const value = m[2]!;
      if (prop === "font-family" ? !/^\s*var\(/.test(value) : /sans-serif|serif|system-ui/i.test(value)) stacks.push(value);
    }
    for (const stack of stacks) {
      const names = stack.split(",").map((n) => n.trim().replace(/^["']|["']$/g, "").toLowerCase()).filter(Boolean);
      for (const n of names) if (!FONT_NAMES.includes(n)) v.push(`font "${n}" is outside the allowlist`);
      if (!names.some((n) => GENERIC.includes(n))) v.push(`font stack "${stack.trim().slice(0, 60)}" has no system fallback`);
    }
    if (!/--(head|body|font)[a-z-]*\s*:/i.test(ctx.style) && !/font-family/i.test(css)) v.push("no font stack is declared");
    return v;
  },

  language(ctx) {
    const v: string[] = [];
    const { decision: d, doc, content, chrome } = ctx;
    const entry = getTemplate(ctx.subject.templateId);
    const dict = entry?.chrome ?? CHROME;
    if (doc.documentElement.getAttribute("lang") !== d.shown) v.push(`<html lang> is ${doc.documentElement.getAttribute("lang")}, expected ${d.shown}`);
    const complete = completePageLanguages(content);
    // hreflang alternates: only for complete languages, only when at least two are complete (and never on an incomplete /{code})
    const alts = Object.fromEntries([...doc.querySelectorAll("link[rel=alternate][hreflang]")].map((l) => [l.getAttribute("hreflang") ?? "", l.getAttribute("href") ?? ""]));
    if (d.alternates) {
      const want: Record<string, string> = { "x-default": `${PAGE_ORIGIN}/` };
      for (const l of complete) want[l] = `${PAGE_ORIGIN}/${l}`;
      if (JSON.stringify(Object.entries(alts).sort()) !== JSON.stringify(Object.entries(want).sort())) v.push(`hreflang alternates are ${JSON.stringify(alts)}, expected ${JSON.stringify(want)}`);
    } else if (Object.keys(alts).length > 0) v.push(`hreflang alternates ${JSON.stringify(alts)} where none are allowed`);
    // the language link or menu: plain links to the OTHER complete languages, each in its own language's name, only with two or more complete
    const links = [...doc.body.querySelectorAll("a[hreflang]")];
    if (d.languageLinks) {
      const others = complete.filter((l) => l !== d.shown);
      const got = links.map((a) => `${a.getAttribute("hreflang")}|${a.getAttribute("href")}|${a.getAttribute("lang")}|${text(a)}`).sort();
      const want = others.map((l) => `${l}|/${l}|${l}|${dict[l].languageName}`).sort();
      if (JSON.stringify(got) !== JSON.stringify(want)) v.push(`language links are ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    } else if (links.length > 0) v.push("a language link where fewer than two languages are complete");
    // chrome in the language shown
    const action = (id: string) => text(doc.querySelector(`[data-action=${id}]`));
    if (content.contact?.phone && action("call") !== chrome.call) v.push(`Call is "${action("call")}", expected "${chrome.call}"`);
    if (content.contact?.whatsapp && action("whatsapp") !== chrome.whatsapp) v.push(`WhatsApp is "${action("whatsapp")}", expected "${chrome.whatsapp}"`);
    if (content.map && action("directions") !== chrome.directions) v.push(`Directions is "${action("directions")}", expected "${chrome.directions}"`);
    const h2 = (id: string) => text(doc.querySelector(`[data-section=${id}] h2`));
    if (h2("about") !== chrome.about) v.push(`About heading is "${h2("about")}", expected "${chrome.about}"`);
    if (content.hours && h2("hours") !== chrome.hours) v.push(`Hours heading is "${h2("hours")}"`);
    if (content.hours) {
      const rows = [...doc.querySelectorAll("[data-section=hours] li")].map((li) => text(li));
      PAGE_HOURS_DAYS.forEach((day, i) => {
        const h = content.hours![day];
        const want = `${chrome.days[day]} ${h ? `${h.open} – ${h.close}` : chrome.closed}`;
        if (rows[i] !== want) v.push(`hours row ${i} is "${rows[i]}", expected "${want}"`);
      });
    }
    // gym text in the language shown, as entered
    const about = textOf(content, "about", d.shown);
    const aboutRendered = [...doc.querySelectorAll("[data-section=about] p")].map((p) => text(p));
    if (about && JSON.stringify(aboutRendered) !== JSON.stringify(nonEmptyLines(about).map((l) => l.replace(/\s+/g, " ")))) v.push("About is not the gym's text in the language shown");
    // services: the language shown, else the next complete language that has them, with that block's own lang
    const svcLang = d.order.find((l) => textOf(content, "services", l) !== undefined);
    const svc = doc.querySelector("[data-section=services]");
    if (svcLang && svc) {
      const items = [...svc.querySelectorAll("li")].map((li) => text(li));
      const want = nonEmptyLines(textOf(content, "services", svcLang)!).map((l) => l.replace(/\s+/g, " "));
      if (JSON.stringify(items) !== JSON.stringify(want)) v.push("Services are not the gym's lines in the expected language");
      const langs = [...svc.querySelectorAll("[lang]")].map((e) => e.getAttribute("lang"));
      if (svcLang === d.shown && langs.length > 0) v.push("a services block carries a lang although it is in the language shown");
      if (svcLang !== d.shown && !(langs.length > 0 && langs.every((l) => l === svcLang))) v.push(`a fallback services block must carry lang="${svcLang}"`);
    }
    return v;
  },

  plans(ctx) {
    const v: string[] = [];
    const plans = ctx.content.plans ?? [];
    const section = ctx.doc.querySelector("[data-section=plans]");
    if (!plans.length) return v;
    if (!section) return ["plans are missing"];
    const names = [...section.querySelectorAll("h3")].map((h) => text(h));
    if (JSON.stringify(names) !== JSON.stringify(plans.map((p) => p.name.replace(/\s+/g, " ").trim()))) v.push(`plan names are ${JSON.stringify(names)}; they must be shown exactly as entered`);
    const items = [...section.querySelectorAll(":scope > ul > li")];
    const dict = (getTemplate(ctx.subject.templateId)?.chrome ?? CHROME)[ctx.decision.shown];
    plans.forEach((p, i) => {
      const t = text(items[i]);
      const price = `${new Intl.NumberFormat(ctx.decision.shown, { maximumFractionDigits: 0 }).format(p.price)} ${p.currency}`;
      if (!t.includes(price.replace(/\s+/g, " ").trim()) && !(items[i]?.textContent ?? "").includes(price)) v.push(`plan ${i} does not show "${price}" (the price as stored, its own code, grouped by the language shown)`);
      if (!t.includes(dict.planType[p.type])) v.push(`plan ${i} does not show its type "${dict.planType[p.type]}"`);
      if (p.type !== "pay_per_session" && !t.includes(dict.planInterval[p.interval])) v.push(`plan ${i} does not show its interval "${dict.planInterval[p.interval]}"`);
      if (p.duration_days && !t.includes(dict.duration(p.duration_days))) v.push(`plan ${i} does not show its duration "${dict.duration(p.duration_days)}"`);
      if (!p.duration_days && /\b\d+\s*(days?|jours?)\b/i.test(t.replace(price, "").replace(p.name, ""))) v.push(`plan ${i} shows a duration it does not have`);
    });
    return v;
  },

  "hostile-inert"(ctx) {
    const v: string[] = [];
    const hostile = ctx.kase.fixture.hostile;
    if (!hostile) return v;
    const body = ctx.doc.body.textContent ?? "";
    for (const s of hostile) if (!body.includes(s)) v.push(`hostile text is not shown as text: ${s.slice(0, 40)}`);
    ctx.doc.querySelectorAll("[data-pwn]").forEach(() => v.push("an element was created from gym text"));
    ctx.doc.querySelectorAll("img[src='x'], svg[onload]").forEach(() => v.push("an element was created from gym text"));
    return v;
  },

  "images-alt"(ctx) {
    const v: string[] = [];
    const { doc, content, chrome } = ctx;
    doc.querySelectorAll("img").forEach((img) => {
      if (!img.hasAttribute("alt")) v.push("an image without an alt attribute");
    });
    const banner = doc.querySelector("[data-section=banner] img");
    if (banner && banner.getAttribute("alt") !== "") v.push("the banner is decorative: its alt must be empty");
    const logo = doc.querySelector("[data-section=header] img");
    if (content.logo && !logo) v.push("the logo is missing");
    if (logo && logo.getAttribute("alt") !== content.name) v.push("the logo alt must be the gym name");
    const gal = [...doc.querySelectorAll("[data-section=gallery] img")];
    if (gal.length !== (content.gallery?.length ?? 0)) v.push("the gallery does not show every image");
    gal.forEach((img, i) => {
      if (img.getAttribute("alt") !== chrome.photo(i + 1, gal.length)) v.push(`gallery image ${i + 1} alt is "${img.getAttribute("alt")}", expected "${chrome.photo(i + 1, gal.length)}"`);
    });
    return v;
  },

  links(ctx) {
    const v: string[] = [];
    const { doc, content } = ctx;
    const digits = (s: string) => s.replace(/\D/g, "");
    const call = doc.querySelector("[data-action=call]");
    const wa = doc.querySelector("[data-action=whatsapp]");
    const dir = doc.querySelector("[data-action=directions]");
    if (Boolean(call) !== Boolean(content.contact?.phone)) v.push("the Call action must exist exactly when there is a phone number");
    if (Boolean(wa) !== Boolean(content.contact?.whatsapp)) v.push("the WhatsApp action must exist exactly when there is a WhatsApp number");
    if (Boolean(dir) !== Boolean(content.map)) v.push("the Directions action must exist exactly when there is a map position");
    if (call && call.getAttribute("href") !== `tel:+${digits(content.contact!.phone!)}`) v.push("Call must be a tel: link carrying the number in international form");
    if (wa && wa.getAttribute("href") !== `https://wa.me/${digits(content.contact!.whatsapp!)}`) v.push("WhatsApp must link to https://wa.me/<digits> with no prefilled message");
    if (dir && !(dir.getAttribute("href") ?? "").startsWith("https://www.google.com/maps/dir/?api=1&destination=")) v.push("Directions must be a Google Maps directions link");
    const order = [...doc.querySelectorAll("[data-action]")].map((e) => e.getAttribute("data-action"));
    if (JSON.stringify(order) !== JSON.stringify(["call", "whatsapp", "directions"].filter((id) => order.includes(id)))) v.push(`actions are ordered ${order.join(", ")}`);
    const contact = text(doc.querySelector("[data-section=contact]"));
    if (content.contact?.phone && !contact.includes(content.contact.phone)) v.push("the phone number must also be visible text");
    doc.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href") ?? "";
      if (/^\s*(javascript|vbscript|data):/i.test(href)) return; // the no-script rule's concern
      if (!/^(tel:\+\d+|https:\/\/[^\s]+|\/[a-z]*)$/.test(href)) v.push(`unexpected link ${href.slice(0, 50)}`);
      const external = /^https?:\/\//.test(href) && !href.startsWith(`${PAGE_ORIGIN}/`);
      const rel = (a.getAttribute("rel") ?? "").split(/\s+/);
      if (external && !(rel.includes("noopener") && rel.includes("noreferrer"))) v.push(`external link ${href.slice(0, 40)} without rel="noopener noreferrer"`);
    });
    return v;
  },

  footer(ctx) {
    const v: string[] = [];
    const footer = ctx.doc.querySelector("[data-section=footer]");
    if (!footer) return ["no footer"];
    const report = [...footer.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/report");
    if (!report || text(report) !== ctx.chrome.reportPage) v.push("the footer has no 'Report this page' link to /report");
    const gymos = [...footer.querySelectorAll("a")].find((a) => (a.getAttribute("href") ?? "").startsWith(WWW_ORIGIN));
    if (!gymos || text(gymos) !== "GymOS") v.push("the footer has no GymOS link to www.");
    const last = [...ctx.doc.querySelectorAll("[data-section], [data-role=repeat-action]")];
    const idxGallery = last.findIndex((e) => e.getAttribute("data-section") === "gallery");
    const idxRepeat = last.findIndex((e) => e.getAttribute("data-role") === "repeat-action");
    if (idxRepeat !== -1 && idxGallery !== -1 && idxRepeat < idxGallery) v.push("the repeat action must follow the gallery");
    if (ctx.content.contact?.phone || ctx.content.contact?.whatsapp) {
      if (idxRepeat === -1) v.push("no repeat of the primary action at the foot of the page");
      else if (idxRepeat !== last.length - 2) v.push("the repeat action must sit directly above the footer");
    }
    return v;
  },
};

export function runDomRules(subject: Subject, kase: Case, out: Rendered, only?: readonly DomRuleId[]): Violation[] {
  const ctx = buildContext(subject, kase, out);
  const ids = only ?? DOM_RULE_IDS;
  return ids.flatMap((rule) => rules[rule](ctx).map((message) => ({ rule, message })));
}

export const domRules = rules;
