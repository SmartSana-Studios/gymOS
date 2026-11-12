// Story 25.5 (AD-52): `/llms.txt`, a plain-text summary of the visible gyms for crawlers and language models. A voluntary hint, NOT access control: every gym
// listed already has a public page. Built only from the AD-46 snapshot rows that `public_site.pages` exposes, parsed strictly like the page does, and only
// from an allowlist of fields: name, page address, category, city and country code, weekly hours, public plans. No contact, address, map, about, services,
// colour or media is ever read here.
//
// Every gym-supplied string is collapsed to ONE line and stripped of leading `#`, `-` and spaces before it is written, and it is always written after a fixed
// label (`## `, `url: `, `- `), so no gym text can start a line of its own and forge another gym's block.
import { classifyHost, completePageLanguages, parsePageContentV1, PAGE_HOURS_DAYS, type PageContentV1 } from "@gymos/types";
import { CHROME, getTemplate } from "@gymos/page-templates";
import { schemeFor } from "@/lib/gym-site/notFound";
import type { LlmsPageRow } from "@/lib/directory/types";

/** The most gyms listed. Bounds memory and the response; a documented ceiling for a voluntary hint, raised when the platform nears it. */
export const LLMS_MAX_GYMS = 5000;

const DAY_LABEL: Record<(typeof PAGE_HOURS_DAYS)[number], string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

/** One line of gym text: every run of whitespace, line break, separator or control character becomes a space; leading `#`, `-` and spaces are dropped. */
export function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\s]+/g, " ").replace(/^[\s#-]+/, "").trim();
}

const HEADER = [
  "# GymOS gyms",
  "",
  "> Gyms that have a public page on GymOS, one block per gym, ordered by page name. English only; each page has its own language and address.",
  "> This file is a voluntary hint for crawlers and language models, not access control: every gym listed already has a public page, and its absence from",
  "> this file says nothing about a page. It is rebuilt from the published pages every few minutes.",
].join("\n");

function planLine(plan: NonNullable<PageContentV1["content"]["plans"]>[number]): string {
  const amount = new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(plan.price);
  // a pay-per-session plan is priced per visit: its stored billing interval is not shown on the page either (classic template), so it is not printed here
  const per = plan.type === "pay_per_session" ? "session" : plan.interval === "annual" ? "year" : "month";
  return `- ${oneLine(plan.name) || "Plan"}: ${amount} ${oneLine(plan.currency)} per ${per}`;
}

/** One gym's block, or null when its page would not be served (the same checks the page makes). */
function block(row: LlmsPageRow, rootDomain: string, log: (event: string, fields?: Record<string, unknown>) => void): string | null {
  // the page route judges the label first; a label it would refuse has no page
  if (classifyHost(`${row.name}.${rootDomain}`, rootDomain).kind !== "gym") return null;
  const parsed = parsePageContentV1(row);
  if (!parsed.ok) {
    log("crawl_content_invalid", { issues: parsed.issues.slice(0, 10) });
    return null;
  }
  const page = parsed.value;
  if (!getTemplate(page.template) || completePageLanguages(page.content).length === 0) return null;
  const c = page.content;

  const lines = [`## ${oneLine(c.name) || row.name}`, `url: ${schemeFor(rootDomain)}://${row.name}.${rootDomain}/`];
  if (c.category) lines.push(`category: ${CHROME.en.categories[c.category]}`);
  const place = [c.city ? oneLine(c.city) : "", c.country ?? ""].filter(Boolean).join(", ");
  if (place) lines.push(`location: ${place}`);
  const hours = PAGE_HOURS_DAYS.flatMap((d) => {
    const day = c.hours?.[d];
    return day ? [`${DAY_LABEL[d]} ${day.open}-${day.close}`] : [];
  });
  if (hours.length > 0) lines.push(`hours: ${hours.join(", ")}`);
  if (c.plans && c.plans.length > 0) lines.push("plans:", ...c.plans.map(planLine));
  return lines.join("\n");
}

export interface LlmsInput {
  /** Rows as read: ordered by page name, at most `cap + 1`. */
  rows: readonly LlmsPageRow[];
  rootDomain: string;
  cap?: number;
  log(event: string, fields?: Record<string, unknown>): void;
}

export function renderLlms({ rows, rootDomain, cap = LLMS_MAX_GYMS, log }: LlmsInput): string {
  const cut = rows.length > cap;
  const blocks = rows.slice(0, cap).flatMap((r) => {
    const b = block(r, rootDomain, log);
    return b === null ? [] : [b];
  });
  const parts = [HEADER, ...blocks];
  if (cut) parts.push(`The list is cut at ${new Intl.NumberFormat("en").format(cap)} gyms; more exist.`);
  return `${parts.join("\n\n")}\n`;
}
