// Story 24.10: the layout rules of the conformance suite, judged in a real browser (headless Chromium through Playwright). They need the
// browser: a missing browser FAILS the run (there is no skip). The page is served with the exact response headers the pipeline produced, so
// the CSP is enforced: an inline style the hash does not cover leaves the page unstyled and is reported.
import { readFileSync } from "node:fs";
import { chromium, type Browser } from "@playwright/test";
import { FONT_ALLOWLIST } from "../contract";
import type { Rendered } from "./subject";
import type { Case } from "./subject";
import { MEDIA_BASE, PAGE_ORIGIN } from "./subject";
import type { Violation } from "./rules";

export const LAYOUT_RULE_IDS = ["csp-browser", "no-overflow", "text-overlap", "contact-first-screen", "tap-target", "contrast", "visual-order"] as const;
export type LayoutRuleId = (typeof LAYOUT_RULE_IDS)[number];

export interface Viewport {
  width: number;
  height: number;
  /** Rules judged at this size. */
  rules: readonly LayoutRuleId[];
}

const ALL: readonly LayoutRuleId[] = LAYOUT_RULE_IDS;
const NO_FIRST_SCREEN: readonly LayoutRuleId[] = LAYOUT_RULE_IDS.filter((r) => r !== "contact-first-screen");
const NO_OVERFLOW: readonly LayoutRuleId[] = LAYOUT_RULE_IDS.filter((r) => r !== "no-overflow");

/** 360 x 640, 768 x 1024 and 1366 x 768: contact first (EXPERIENCE.md "Template contract"); 360, 768 and 1280: no overflow. */
export const VIEWPORTS: readonly Viewport[] = [
  { width: 360, height: 640, rules: ALL },
  { width: 768, height: 1024, rules: ALL },
  { width: 1280, height: 800, rules: NO_FIRST_SCREEN },
  { width: 1366, height: 768, rules: NO_OVERFLOW },
];

// 1x1 grey PNG: the media origin is intercepted, nothing leaves the machine.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO8e/fufwAI6QPU2aG3SwAAAABJRU5ErkJggg==", "base64");
const FONT_DIR = new URL("../../../../apps/landing/public/fonts/", import.meta.url);

export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (e) {
    throw new Error(`The layout stage needs headless Chromium and it could not start (run: npx playwright install chromium). ${(e as Error).message.split("\n")[0]}`);
  }
}

interface Measures {
  scrollWidth: number;
  clientWidth: number;
  overflowing: string[];
  clipped: string[];
  overlaps: string[];
  actions: { id: string; top: number; bottom: number; left: number; right: number; height: number; width: number }[];
  smallTargets: string[];
  contrast: string[];
  order: string[];
  csp: string[];
}

/** Runs in the page. Plain function, no imports. */
function measure(): Measures {
  const vw = window.innerWidth;
  const desc = (e: Element) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : ""}`;
  const all = [...document.body.querySelectorAll("*")].filter((e) => !e.closest("svg"));
  const de = document.documentElement;

  const overflowing = all
    .filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && (r.right > vw + 1 || r.left < -1);
    })
    .map(desc)
    .slice(0, 6);

  const clipped = all
    .filter((e) => {
      const cs = getComputedStyle(e);
      const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");
      if (!hasText) return false;
      const hides = cs.overflowX !== "visible" || cs.textOverflow === "ellipsis";
      return hides && e.scrollWidth > e.clientWidth + 1;
    })
    .map(desc)
    .slice(0, 6);

  // text boxes: one rect per text node line
  const boxes: { el: Element; node: Node; r: DOMRect }[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest("svg, script, style") || (n.textContent ?? "").trim() === "") continue;
    if (getComputedStyle(el).visibility === "hidden") continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.width > 1 && r.height > 1) boxes.push({ el, node: n, r });
  }
  const overlaps: string[] = [];
  for (let i = 0; i < boxes.length && overlaps.length < 6; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.node === b.node) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w > 3 && h > 3) overlaps.push(`${desc(a.el)} over ${desc(b.el)}`);
    }
  }

  const actions = [...document.querySelectorAll("[data-action]")].map((e) => {
    const r = e.getBoundingClientRect();
    return { id: e.getAttribute("data-action") ?? "", top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width };
  });

  const focusables = [...document.querySelectorAll("a[href], summary")];
  const smallTargets = focusables
    .filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && (r.height < 43.5 || r.width < 43.5);
    })
    .map((e) => `${desc(e)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);

  // contrast
  const parse = (c: string): [number, number, number, number] => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 0];
    const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1];
  };
  const lum = (r: number, g: number, b: number) => {
    const f = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (top: [number, number, number, number], bottom: [number, number, number]): [number, number, number] => [
    top[0] * top[3] + bottom[0] * (1 - top[3]),
    top[1] * top[3] + bottom[1] * (1 - top[3]),
    top[2] * top[3] + bottom[2] * (1 - top[3]),
  ];
  const backgroundOf = (el: Element): [number, number, number] | "image" => {
    const stack: Element[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) stack.push(e);
    let base: [number, number, number] = [255, 255, 255];
    for (const e of stack.reverse()) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== "none") return "image";
      const bg = parse(cs.backgroundColor);
      if (bg[3] > 0) base = over(bg, base);
    }
    return base;
  };
  const contrastFails: string[] = [];
  const seen = new Set<Element>();
  for (const b of boxes) {
    const el = b.el;
    if (seen.has(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const bg = backgroundOf(el);
    if (bg === "image") continue;
    const fg = parse(cs.color);
    const blended = over(fg, bg);
    const l1 = lum(...blended);
    const l2 = lum(...bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    if (ratio < (large ? 3 : 4.5)) contrastFails.push(`${desc(el)} ${ratio.toFixed(2)}:1`);
  }

  // source order = visual order
  const order: string[] = [];
  const rects = focusables.map((e) => ({ e, r: e.getBoundingClientRect() }));
  for (let i = 1; i < rects.length; i++) {
    const p = rects[i - 1]!;
    const n = rects[i]!;
    // a move to a cell on the right (a second column) is reading order; going up, or left on the same row, is not
    const rightOf = n.r.left >= p.r.right - 1;
    if (n.r.top < p.r.top - 2 && !rightOf) order.push(`${desc(n.e)} is above ${desc(p.e)}`);
    else if (Math.abs(n.r.top - p.r.top) <= 2 && n.r.left < p.r.left - 1) order.push(`${desc(n.e)} is left of ${desc(p.e)} but follows it`);
  }
  const sections = [...document.querySelectorAll("[data-section]")].filter((e) => e.getAttribute("data-section") !== "banner");
  for (let i = 1; i < sections.length; i++) {
    const p = sections[i - 1]!.getBoundingClientRect();
    const n = sections[i]!.getBoundingClientRect();
    const rightOf = n.left >= p.right - 1;
    if (n.top < p.top - 2 && !rightOf) order.push(`section ${sections[i]!.getAttribute("data-section")} is above ${sections[i - 1]!.getAttribute("data-section")}`);
  }

  return {
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    overflowing,
    clipped,
    overlaps,
    actions,
    smallTargets,
    contrast: contrastFails.slice(0, 8),
    order,
    csp: ((window as unknown as { __csp?: string[] }).__csp ?? []).slice(0, 5),
  };
}

export async function runLayoutRules(browser: Browser, out: Rendered, kase: Case, viewports: readonly Viewport[] = VIEWPORTS, only?: readonly LayoutRuleId[]): Promise<Violation[]> {
  // every allowlisted font file must exist: a missing one throws here instead of silently falling back to a system font
  for (const f of Object.values(FONT_ALLOWLIST)) readFileSync(new URL(f.path.replace(/^\/fonts\//, ""), FONT_DIR));
  const violations: Violation[] = [];
  const want = (rule: LayoutRuleId, vp: Viewport) => vp.rules.includes(rule) && (!only || only.includes(rule));
  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, javaScriptEnabled: true });
    const page = await context.newPage();
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url === `${PAGE_ORIGIN}${kase.request.pathname}`) {
        const headers = { ...out.headers };
        delete headers["Content-Length"];
        return route.fulfill({ status: out.status, headers, body: out.html });
      }
      if (url.startsWith(`${MEDIA_BASE}/`)) return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
      if (url.startsWith(`${PAGE_ORIGIN}/fonts/`)) {
        // a missing font file must fail the run, not fall back to a system font and pass
        return route.fulfill({ status: 200, contentType: "font/woff2", body: readFileSync(new URL(url.slice(`${PAGE_ORIGIN}/fonts/`.length), FONT_DIR)) });
      }
      return route.abort();
    });
    await page.goto(`${PAGE_ORIGIN}${kase.request.pathname}`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(measure);
    await context.close();

    const at = `${vp.width}x${vp.height}`;
    const add = (rule: LayoutRuleId, message: string) => violations.push({ rule, message: `${message} at ${at}` });
    if (want("csp-browser", vp)) for (const c of m.csp) add("csp-browser", `the browser blocked: ${c}`);
    if (want("no-overflow", vp)) {
      if (m.scrollWidth > m.clientWidth + 1) add("no-overflow", `horizontal scroll (${m.scrollWidth} > ${m.clientWidth})`);
      for (const e of m.overflowing) add("no-overflow", `${e} extends past the viewport`);
      for (const e of m.clipped) add("no-overflow", `${e} clips its text`);
    }
    if (want("text-overlap", vp)) for (const o of m.overlaps) add("text-overlap", o);
    if (want("contact-first-screen", vp)) {
      if (m.actions.length === 0) add("contact-first-screen", "no contact action");
      for (const a of m.actions) {
        if (a.top < 0 || a.bottom > vp.height || a.left < 0 || a.right > vp.width) add("contact-first-screen", `${a.id} is outside the first screen (top ${Math.round(a.top)}, bottom ${Math.round(a.bottom)})`);
      }
    }
    if (want("tap-target", vp)) {
      for (const a of m.actions) if (a.height < 43.5 || a.width < 43.5) add("tap-target", `${a.id} is ${Math.round(a.width)}x${Math.round(a.height)}`);
      for (const t of m.smallTargets) add("tap-target", `${t} is below 44 px`);
    }
    if (want("contrast", vp)) for (const c of m.contrast) add("contrast", c);
    if (want("visual-order", vp)) for (const o of m.order) add("visual-order", o);
  }
  return violations;
}
