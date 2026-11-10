// Story 24.10 (EXPERIENCE.md "Language rule", owner decision 2026-11-08): which language a page shows. Languages come from
// PAGE_CONTENT_LANGUAGES, never "en and fr". Complete languages are those whose About is present in the snapshot (the database omits an
// incomplete About). Pure: the request is an argument.
import { PAGE_CONTENT_LANGUAGES, completePageLanguages, type PageContentLanguage, type PageContentSnapshotV1 } from "@gymos/types";

/** `/` or `/{code}` of a supported language; anything else (including `/FR` and `/fr/`) is not a page path. */
export type PagePath = { kind: "home" } | { kind: "language"; code: PageContentLanguage } | { kind: "not-found" };

export function classifyPagePath(pathname: string): PagePath {
  if (pathname === "/") return { kind: "home" };
  const m = /^\/([a-z]{2,3})$/.exec(pathname);
  const code = m?.[1];
  if (code && (PAGE_CONTENT_LANGUAGES as readonly string[]).includes(code)) return { kind: "language", code: code as PageContentLanguage };
  return { kind: "not-found" };
}

/** Primary language subtags of an Accept-Language header, best first (by q, then header order). `q=0` and `*` are dropped. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  const items = header
    .slice(0, 1000)
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p)?.[1]).find((v) => v !== undefined);
      const quality = q === undefined ? 1 : Number(q);
      return { primary: (tag ?? "").trim().toLowerCase().split("-")[0] ?? "", quality, index };
    })
    .filter((i) => /^[a-z]{2,3}$/.test(i.primary) && Number.isFinite(i.quality) && i.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  return [...new Set(items.map((i) => i.primary))];
}

/** The fallback order among complete languages: the visitor's best matches, then the gym's default_language, then the list order. */
export function languageOrder(complete: readonly PageContentLanguage[], acceptLanguage: string | null | undefined, defaultLanguage: string): PageContentLanguage[] {
  const out: PageContentLanguage[] = [];
  const add = (l: string) => {
    if ((complete as readonly string[]).includes(l) && !(out as string[]).includes(l)) out.push(l as PageContentLanguage);
  };
  for (const l of parseAcceptLanguage(acceptLanguage)) add(l);
  add(defaultLanguage);
  for (const l of PAGE_CONTENT_LANGUAGES) add(l);
  return out;
}

export interface LanguageDecision {
  shown: PageContentLanguage;
  /** [0] is `shown`. */
  order: PageContentLanguage[];
  /** hreflang alternates and x-default: at least two complete languages and a request that names a complete language or the default address. */
  alternates: boolean;
  /** The language link or menu: at least two complete languages. */
  languageLinks: boolean;
  /** The answer can depend on Accept-Language (`Vary: Accept-Language`): only with at least two complete languages; with one the response cannot differ. */
  vary: boolean;
}

/** null when no language is complete (nothing can be shown). */
export function decideLanguage(content: PageContentSnapshotV1, path: Exclude<PagePath, { kind: "not-found" }>, acceptLanguage: string | null | undefined): LanguageDecision | null {
  const complete = completePageLanguages(content);
  if (complete.length === 0) return null;
  const order = languageOrder(complete, acceptLanguage, content.default_language);
  const two = complete.length >= 2;
  if (path.kind === "home") return { shown: order[0]!, order, alternates: two, languageLinks: two, vary: two };
  if (complete.includes(path.code)) {
    return { shown: path.code, order: [path.code, ...order.filter((l) => l !== path.code)], alternates: two, languageLinks: two, vary: false };
  }
  // A supported but incomplete code serves the fallback choice, without hreflang (a shared link keeps working).
  return { shown: order[0]!, order, alternates: false, languageLinks: two, vary: two };
}
