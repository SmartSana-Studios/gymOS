// Story 24.11 (PS-03, FR-204, AD-44): the public "Report this page" form, as plain strings. No React, no script, no cookie, no CAPTCHA: a
// plain HTML form that posts to the same host, answered in the same response (the proxy drops queries, so there is no redirect). Pure: the
// request is an argument and the database is not reached from here (apps/landing wires `submitReport`). The page being reported is named
// by its address only; the rate-limit page names nothing.
import {
  PAGE_CONTENT_LANGUAGES,
  PAGE_REPORT_DETAILS_MAX,
  PAGE_REPORT_REASON_LABELS,
  PAGE_REPORT_REASON_ORDER,
  cleanPageText,
  pageTakedownReasonSchema,
  type PageContentLanguage,
  type PageTakedownReason,
} from "@gymos/types";
import { REPORT_CHROME } from "./chrome";
import { PAGE_CACHE_CONTROL, SECURITY_HEADERS_BASE, contentSecurityPolicy, styleHash } from "./headers";
import { parseAcceptLanguage } from "./language";

/** The name of the bot-catcher field. A real visitor never sees it; anything in it is a bot. The name is deliberately non-semantic: a name such as `website` or `url` is autofilled by browsers and password managers, which would silently drop a real report. */
export const REPORT_HONEYPOT_FIELD = "hp_field_x";
/** The largest form body the route reads (1,000 characters of any script, percent-encoded, with room to spare). */
export const REPORT_MAX_BODY_BYTES = 32 * 1024;

const CSS = [
  "*,*::before,*::after{box-sizing:border-box}",
  "body{margin:0;background:#F3F4F0;color:#1B2A41;font:16px/1.55 system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;overflow-wrap:anywhere}",
  "main{max-width:34rem;margin:0 auto;padding:24px 16px 48px}",
  "h1{margin:0 0 4px;font-size:26px;line-height:32px}",
  "p{margin:0 0 12px}",
  ".host{color:#4A5568;margin-bottom:20px}",
  "form,.card{background:#fff;border-radius:12px;padding:20px 16px;box-shadow:0 1px 3px rgba(0,0,0,.12)}",
  "fieldset{border:0;margin:0 0 20px;padding:0}",
  "legend{font-weight:700;margin-bottom:8px;padding:0}",
  ".opt{display:flex;align-items:center;gap:12px;min-height:44px}",
  ".opt input{width:24px;height:24px;flex:none;margin:0}",
  ".opt label{flex:1;min-height:44px;display:flex;align-items:center}",
  "label.b{display:block;font-weight:700}",
  "textarea{display:block;width:100%;min-height:9rem;margin-top:8px;padding:12px;font:inherit;color:inherit;background:#fff;border:1px solid #4A5568;border-radius:8px}",
  ".hint{margin:4px 0 0;font-size:14px;color:#4A5568}",
  ".err{margin:4px 0 0;color:#B42318;font-weight:600}",
  ".sum{background:#FEF3F2;border:1px solid #B42318;border-radius:8px;padding:12px 16px;margin-bottom:16px}",
  ".sum p{margin:0}",
  ".sum ul{margin:8px 0 0;padding-left:20px}",
  "button{display:block;width:100%;min-height:48px;margin-top:20px;padding:0 24px;border:0;border-radius:8px;background:#1B2A41;color:#fff;font:inherit;font-weight:700;cursor:pointer}",
  "a{color:#1B2A41;font-weight:600;text-decoration:underline}",
  ".back{display:inline-flex;align-items:center;min-height:44px;margin-top:8px}",
  ":focus-visible{outline:3px solid #1B2A41;outline-offset:2px}",
  ".hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}",
].join("\n");

const CSS_HASH = styleHash(CSS);

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The language of the form: the visitor's best Accept-Language among the chrome languages, else the page's default language. */
export function chooseReportLanguage(acceptLanguage: string | null | undefined, defaultLanguage: string | null | undefined): PageContentLanguage {
  const supported = PAGE_CONTENT_LANGUAGES as readonly string[];
  for (const l of parseAcceptLanguage(acceptLanguage)) if (supported.includes(l)) return l as PageContentLanguage;
  if (defaultLanguage && supported.includes(defaultLanguage)) return defaultLanguage as PageContentLanguage;
  return PAGE_CONTENT_LANGUAGES[0];
}

export type ReportFieldError = "reason" | "details" | "long" | "failed";

export type ReportParse =
  /** The hidden field was filled: show the confirmation and store nothing. */
  | { kind: "honeypot" }
  | { kind: "ok"; reason: PageTakedownReason; details: string }
  | { kind: "invalid"; reason: string; details: string; errors: ReportFieldError[] };

/** Parses the url-encoded form. Details are cleaned like page text (CRLF to LF, control characters out), trimmed, and need 1 to 1000 characters. */
export function parseReportForm(params: URLSearchParams): ReportParse {
  // every value of the field counts: a bot that sends a blank first value and a filled later one is still a bot
  if (params.getAll(REPORT_HONEYPOT_FIELD).some((v) => v.trim() !== "")) return { kind: "honeypot" };
  const rawReason = params.get("reason") ?? "";
  const details = cleanPageText(params.get("details") ?? "").trim();
  const reason = pageTakedownReasonSchema.safeParse(rawReason);
  const errors: ReportFieldError[] = [];
  if (!reason.success) errors.push("reason");
  if (details.length === 0) errors.push("details");
  else if ([...details].length > PAGE_REPORT_DETAILS_MAX) errors.push("long");
  if (errors.length > 0 || !reason.success) return { kind: "invalid", reason: reason.success ? reason.data : "", details, errors };
  return { kind: "ok", reason: reason.data, details };
}

export type ReportView =
  | { kind: "form"; reason?: string; details?: string; errors?: ReportFieldError[] }
  | { kind: "thanks" }
  | { kind: "rate_limited" };

export interface ReportPageInput {
  /** The validated page name (first Host label); shown only on the form, as the address being reported. */
  name: string;
  rootDomain: string;
  language: PageContentLanguage;
  view: ReportView;
  /** GET of a visible page may be cached briefly; everything that answers a POST is `no-store`. */
  method: "GET" | "POST";
}

export interface ReportPageParts {
  status: 200 | 400 | 429 | 503;
  headers: Record<string, string>;
  body: string;
}

function shell(language: PageContentLanguage, title: string, inner: string): string {
  return (
    `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style></head><body><main>${inner}</main></body></html>`
  );
}

export function renderReportPage(input: ReportPageInput): ReportPageParts {
  const t = REPORT_CHROME[input.language];
  const view = input.view;
  const baseHeaders: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": contentSecurityPolicy("'none'", CSS_HASH),
    ...SECURITY_HEADERS_BASE,
  };

  if (view.kind === "thanks") {
    const body = shell(input.language, t.title, `<div class="card" role="status"><h1>${esc(t.title)}</h1><p>${esc(t.thanks)}</p><a class="back" href="/">${esc(t.backToPage)}</a></div>`);
    return { status: 200, headers: { ...baseHeaders, "Cache-Control": "no-store" }, body };
  }

  if (view.kind === "rate_limited") {
    // The page is not named: no address, no title that carries it.
    const body = shell(input.language, t.title, `<div class="card" role="alert"><h1>${esc(t.title)}</h1><p>${esc(t.rateLimited)}</p></div>`);
    return { status: 429, headers: { ...baseHeaders, "Cache-Control": "no-store", "Retry-After": "3600" }, body };
  }

  const errors = view.errors ?? [];
  const has = (e: ReportFieldError) => errors.includes(e);
  const messages: { id: string; text: string }[] = [];
  if (has("reason")) messages.push({ id: `reason-${PAGE_REPORT_REASON_ORDER[0]}`, text: t.chooseReason });
  if (has("details")) messages.push({ id: "details", text: t.tellUsMore });
  if (has("long")) messages.push({ id: "details", text: t.detailsTooLong });
  if (has("failed")) messages.push({ id: "reason-" + PAGE_REPORT_REASON_ORDER[0], text: t.failed });

  const summary =
    messages.length > 0
      ? `<div class="sum" role="alert"><p><strong>${esc(t.errorSummary)}</strong></p><ul>${messages.map((m) => `<li><a href="#${m.id}">${esc(m.text)}</a></li>`).join("")}</ul></div>`
      : "";

  const radios = PAGE_REPORT_REASON_ORDER.map((code) => {
    const checked = view.reason === code ? " checked" : "";
    return `<div class="opt"><input type="radio" id="reason-${code}" name="reason" value="${code}" required${checked}${has("reason") ? ' aria-describedby="reason-err"' : ""}><label for="reason-${code}">${esc(PAGE_REPORT_REASON_LABELS[code][input.language])}</label></div>`;
  }).join("");

  const reasonErr = has("reason") ? `<p class="err" id="reason-err">${esc(t.chooseReason)}</p>` : "";
  const detailsErrText = has("details") ? t.tellUsMore : has("long") ? t.detailsTooLong : "";
  const detailsErr = detailsErrText ? `<p class="err" id="details-err">${esc(detailsErrText)}</p>` : "";
  const describedBy = detailsErrText ? "details-hint details-err" : "details-hint";

  const form =
    `<form method="post" action="/report">` +
    `<fieldset><legend>${esc(t.reasonLegend)} *</legend>${radios}${reasonErr}</fieldset>` +
    `<label class="b" for="details">${esc(t.detailsLabel)} *</label>` +
    `<textarea id="details" name="details" rows="6" maxlength="${PAGE_REPORT_DETAILS_MAX}" required aria-describedby="${describedBy}">${esc(view.details ?? "")}</textarea>` +
    `<p class="hint" id="details-hint">${esc(t.detailsHint)}</p>${detailsErr}` +
    `<div class="hp" aria-hidden="true"><label>${esc(t.honeypotLabel)}<input type="text" name="${REPORT_HONEYPOT_FIELD}" tabindex="-1" autocomplete="off" value=""></label></div>` +
    `<p class="hint">${esc(t.anonymousNote)}</p>` +
    `<button type="submit">${esc(t.submit)}</button></form>` +
    `<a class="back" href="/">${esc(t.backToPage)}</a>`;

  const body = shell(
    input.language,
    t.title,
    `<h1>${esc(t.title)}</h1><p class="host">${esc(`${input.name}.${input.rootDomain.toLowerCase()}`)}</p>${summary}${form}`,
  );

  const headers: Record<string, string> = { ...baseHeaders };
  if (input.method === "GET" && errors.length === 0) {
    headers["Cache-Control"] = PAGE_CACHE_CONTROL;
    headers["Vary"] = "Accept-Language";
  } else {
    headers["Cache-Control"] = "no-store";
  }
  // a failure of ours (not the visitor's mistake) is a 503; a mistake of the visitor is a 400
  const onlyOurs = errors.length > 0 && errors.every((e) => e === "failed");
  return { status: onlyOurs ? 503 : errors.length > 0 ? 400 : 200, headers, body };
}

