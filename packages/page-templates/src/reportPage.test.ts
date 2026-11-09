import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { PAGE_CONTENT_LANGUAGES, PAGE_REPORT_REASON_LABELS, PAGE_TAKEDOWN_REASONS } from "@gymos/types";
import { REPORT_CHROME } from "./chrome";
import { contentSecurityPolicy, extractStyleBlock, styleHash } from "./headers";
import { REPORT_HONEYPOT_FIELD, chooseReportLanguage, parseReportForm, renderReportPage, type ReportView } from "./reportPage";

const base = { name: "grace-fit", rootDomain: "gymosapps.com" } as const;
const page = (view: ReportView, language: "en" | "fr" = "en", method: "GET" | "POST" = "GET") => renderReportPage({ ...base, language, view, method });
const dom = (html: string) => new JSDOM(html).window.document;
const params = (o: Record<string, string>) => new URLSearchParams(o);

describe("the report form page (PS-03)", () => {
  it("is a plain HTML form: radios for the six reasons, one textarea, one button, a hidden bot field, no script", () => {
    const r = page({ kind: "form" });
    const d = dom(r.body);
    expect(d.querySelectorAll("script, iframe, object, embed, link[rel=stylesheet], [onclick], [onload]").length).toBe(0);
    expect(d.querySelectorAll("form").length).toBe(1);
    const form = d.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/report");
    expect([...d.querySelectorAll("input[type=radio]")].map((i) => i.getAttribute("value"))).toEqual([
      "impersonation", "misleading_content", "illegal_content", "trademark", "privacy", "other",
    ]);
    expect([...d.querySelectorAll("input[type=radio]")].every((i) => i.hasAttribute("required"))).toBe(true);
    const area = d.querySelector("textarea")!;
    expect(area.getAttribute("name")).toBe("details");
    expect(area.getAttribute("maxlength")).toBe("1000");
    expect(d.querySelectorAll("button").length).toBe(1);
    const honeypot = d.querySelector(`input[name=${REPORT_HONEYPOT_FIELD}]`)!;
    expect(honeypot.getAttribute("tabindex")).toBe("-1");
    expect(honeypot.getAttribute("autocomplete")).toBe("off");
    // a name browsers autofill (website, url, email, name, phone, address) would drop a real report
    expect(REPORT_HONEYPOT_FIELD).toBe("hp_field_x");
    expect(REPORT_HONEYPOT_FIELD).not.toMatch(/website|url|email|name|phone|address|company|homepage/i);
    expect(honeypot.closest(".hp")?.getAttribute("aria-hidden")).toBe("true");
    expect(d.querySelector("input[type=email], input[type=tel], input[name=email], input[name=name]")).toBeNull();
    expect(d.querySelector("legend")?.textContent).toContain("Why are you reporting it?");
    expect(d.querySelector("h1")?.textContent).toBe("Report this page");
    expect(d.querySelector(".host")?.textContent).toBe("grace-fit.gymosapps.com");
  });

  it("labels the reasons with the PS-03 visitor words, in English and French, from the one source in @gymos/types", () => {
    for (const lang of PAGE_CONTENT_LANGUAGES) {
      const d = dom(page({ kind: "form" }, lang).body);
      const labels = [...d.querySelectorAll(".opt label")].map((l) => l.textContent);
      expect(labels.sort()).toEqual(PAGE_TAKEDOWN_REASONS.map((c) => PAGE_REPORT_REASON_LABELS[c][lang]).sort());
      expect(d.documentElement.lang).toBe(lang);
    }
    expect(dom(page({ kind: "form" }, "fr").body).querySelector("button")?.textContent).toBe("Envoyer le signalement");
  });

  it("carries its own style hash, the AD-44 CSP with form-action 'self', no cookie and nosniff", () => {
    const r = page({ kind: "form" });
    const style = extractStyleBlock(r.body);
    expect(style.ok).toBe(true);
    if (style.ok) expect(r.headers["Content-Security-Policy"]).toBe(contentSecurityPolicy("'none'", styleHash(style.text)));
    expect(r.headers["Content-Security-Policy"]).toContain("form-action 'self'");
    expect(r.headers["Content-Security-Policy"]).toContain("script-src 'none'");
    expect(r.headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(r.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(Object.keys(r.headers).map((h) => h.toLowerCase())).not.toContain("set-cookie");
  });

  it("GET may be cached for a minute and varies by language; everything that answers a POST is no-store", () => {
    expect(page({ kind: "form" }, "en", "GET").headers["Cache-Control"]).toBe("public, s-maxage=60");
    expect(page({ kind: "form" }, "en", "GET").headers["Vary"]).toBe("Accept-Language");
    expect(page({ kind: "thanks" }, "en", "POST").headers["Cache-Control"]).toBe("no-store");
    expect(page({ kind: "form", errors: ["reason"] }, "en", "POST").headers["Cache-Control"]).toBe("no-store");
    expect(page({ kind: "rate_limited" }, "en", "POST").headers["Cache-Control"]).toBe("no-store");
  });

  it("validation errors return the form with an error summary that links to each field and keeps what was typed", () => {
    const r = page({ kind: "form", reason: "privacy", details: "my <b>text</b> & more", errors: ["details"] }, "en", "POST");
    expect(r.status).toBe(400);
    const d = dom(r.body);
    const summary = d.querySelector(".sum")!;
    expect(summary.getAttribute("role")).toBe("alert");
    expect(summary.textContent).toContain("Tell us a little more.");
    expect(summary.querySelector("a")?.getAttribute("href")).toBe("#details");
    expect(d.querySelector("#details")?.getAttribute("aria-describedby")).toContain("details-err");
    expect((d.querySelector("input[value=privacy]") as HTMLInputElement).checked).toBe(true);
    expect(d.querySelector("textarea")?.textContent).toBe("my <b>text</b> & more");
    expect(d.querySelector("textarea b")).toBeNull();
    const reason = dom(page({ kind: "form", errors: ["reason", "details"] }, "fr", "POST").body);
    expect(reason.querySelector(".sum")?.textContent).toContain("Choisissez un motif.");
    expect(reason.querySelector(".sum")?.textContent).toContain("Dites-nous-en un peu plus.");
    expect(reason.querySelector(".sum a")?.getAttribute("href")).toBe("#reason-impersonation");
    expect(dom(page({ kind: "form", errors: ["long"] }, "en", "POST").body).querySelector(".sum")?.textContent).toContain("1,000");
    expect(dom(page({ kind: "form", errors: ["failed"] }, "en", "POST").body).querySelector(".sum")?.textContent).toContain("We couldn't send your report");
  });

  it("the confirmation is a page, not a toast, with a link back; it says nothing about an outcome", () => {
    const r = page({ kind: "thanks" }, "en", "POST");
    expect(r.status).toBe(200);
    const d = dom(r.body);
    expect(d.body.textContent).toContain("Thank you. We'll review this page.");
    expect(d.querySelector("a")?.getAttribute("href")).toBe("/");
    expect(d.querySelector("a")?.textContent).toBe("Back to the page");
    expect(dom(page({ kind: "thanks" }, "fr", "POST").body).body.textContent).toContain("Merci. Nous allons examiner cette page.");
  });

  it("the rate-limit page does not name the page, offers no form and is a 429", () => {
    for (const lang of PAGE_CONTENT_LANGUAGES) {
      const r = page({ kind: "rate_limited" }, lang, "POST");
      expect(r.status).toBe(429);
      expect(r.body).not.toContain("grace-fit");
      expect(r.body).not.toContain("gymosapps.com");
      expect(r.body).toContain(REPORT_CHROME[lang].rateLimited);
      expect(dom(r.body).querySelector("form")).toBeNull();
    }
  });

  it("escapes the page name and every string it prints", () => {
    const r = renderReportPage({ name: "a<script>b", rootDomain: "x.com", language: "en", view: { kind: "form", details: "</textarea><script>1</script>" }, method: "GET" });
    expect(r.body).not.toContain("<script>");
    expect(dom(r.body).querySelectorAll("script").length).toBe(0);
  });
});

describe("the report language", () => {
  it("is the visitor's best language among the chrome languages, else the page's default language", () => {
    expect(chooseReportLanguage("fr-CA,fr;q=0.9,en;q=0.5", "en")).toBe("fr");
    expect(chooseReportLanguage("de,es;q=0.5", "fr")).toBe("fr");
    expect(chooseReportLanguage(null, "fr")).toBe("fr");
    expect(chooseReportLanguage("de", "de")).toBe("en");
    expect(chooseReportLanguage("en;q=0,fr;q=0.2", "en")).toBe("fr");
  });
  it("has a dictionary for every content language", () => {
    for (const lang of PAGE_CONTENT_LANGUAGES) {
      for (const [key, value] of Object.entries(REPORT_CHROME[lang])) expect(value, `${lang}.${key}`).toBeTruthy();
    }
  });
});

describe("parsing the posted form", () => {
  it("accepts a reason code and details of 1 to 1000 characters, cleaned and trimmed", () => {
    expect(parseReportForm(params({ reason: "privacy", details: "  hello\r\nworld\u0001  " }))).toEqual({ kind: "ok", reason: "privacy", details: "hello\nworld" });
    expect(parseReportForm(params({ reason: "other", details: "a".repeat(1000) })).kind).toBe("ok");
  });
  it("lists what is wrong", () => {
    expect(parseReportForm(params({ details: "x" }))).toMatchObject({ kind: "invalid", errors: ["reason"] });
    expect(parseReportForm(params({ reason: "bogus", details: "x" }))).toMatchObject({ kind: "invalid", errors: ["reason"] });
    expect(parseReportForm(params({ reason: "privacy", details: "   " }))).toMatchObject({ kind: "invalid", errors: ["details"] });
    expect(parseReportForm(params({ reason: "privacy", details: "a".repeat(1001) }))).toMatchObject({ kind: "invalid", errors: ["long"] });
    expect(parseReportForm(params({}))).toMatchObject({ kind: "invalid", errors: ["reason", "details"] });
    expect(parseReportForm(params({ reason: "privacy", details: "😀".repeat(1000) })).kind).toBe("ok");
    expect(parseReportForm(params({ reason: "privacy", details: "😀".repeat(1001) }))).toMatchObject({ errors: ["long"] });
  });
  it("a filled hidden field is a bot, whatever else is wrong", () => {
    expect(parseReportForm(params({ [REPORT_HONEYPOT_FIELD]: "http://spam.example", reason: "privacy", details: "x" }))).toEqual({ kind: "honeypot" });
    expect(parseReportForm(params({ [REPORT_HONEYPOT_FIELD]: "x" }))).toEqual({ kind: "honeypot" });
    expect(parseReportForm(params({ [REPORT_HONEYPOT_FIELD]: "   ", reason: "privacy", details: "x" })).kind).toBe("ok");
  });
});
