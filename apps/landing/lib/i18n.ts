/** Mirrors apps/dashboard/lib/i18n/config.ts so the two apps agree on what a
 *  locale is. Kept as its own small module rather than imported, because the
 *  landing page has no dependency on the dashboard package. */
/**
 * Route params for the `[locale]` segment.
 *
 * Declared by hand rather than using Next's global `PageProps`/`LayoutProps`
 * helpers, which are real and correctly typed but are *generated* into
 * `.next/types` by `next build`/`next dev`. A fresh checkout has no `.next`,
 * so `pnpm typecheck` on its own fails with "Cannot find name 'PageProps'"
 * -- which passes locally the moment you have built once and fails in CI
 * every time. This repo's `typecheck` task does not depend on `build`, so
 * the types have to stand on their own.
 *
 * `params` is a Promise because this app targets Next 16, where route params
 * are async. `locale` is a plain `string`, not `Locale`: the router will
 * hand this a hand-typed `/de` just as readily as `/fr`, so narrowing is
 * `isLocale`'s job at the top of each route, not the type's.
 */
export interface LocaleRouteParams {
  params: Promise<{ locale: string }>;
}

export const locales = ["en", "fr"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** The other locale, for the header's language toggle. Trivial while there
 *  are exactly two, but written as a lookup so adding a third does not
 *  silently turn the toggle into a wrong answer. */
export function otherLocale(locale: Locale): Locale {
  return locale === "en" ? "fr" : "en";
}

/**
 * Picks a locale from an Accept-Language header.
 *
 * Deliberately crude: it looks for the first `fr`-prefixed tag anywhere in
 * the header and otherwise falls back to English. A full RFC 4647 match
 * (Negotiator + intl-localematcher, as Next's i18n guide suggests) buys
 * nothing with a two-locale set where one is the default, and would add two
 * dependencies to an app whose entire point is to be a fast static page.
 */
export function negotiateLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return defaultLocale;
  for (const part of acceptLanguage.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase() ?? "";
    if (tag === "fr" || tag.startsWith("fr-")) return "fr";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return defaultLocale;
}
