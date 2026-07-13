import { cache } from "react";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { defaultLocale, isLocale, type Locale } from "./config";

/**
 * Single locale-resolution primitive for the whole app -- the root layout,
 * every Server Action, and `mapAndLog` (services/session.ts) all call this
 * independently, so it's wrapped in React's `cache()`: within one request,
 * every call after the first is a memoized hit, not a fresh claims fetch +
 * `users` SELECT. Priority order matches EXPERIENCE.md's Localization
 * section: (1) the signed-in user's saved `users.preferred_language`
 * (FR-015 -- "persists per account across devices"), (2) the request's
 * Accept-Language header, (3) English fallback.
 *
 * `preferred_language` is deliberately NOT read from the JWT claims (the
 * custom_access_token_hook, 0009_auth_hook_gym_claims.sql, does not carry
 * it) -- embedding it there would delay a language change until token
 * refresh, breaking the "no missing-string fallback"/immediate-toggle
 * requirement. A live per-request DB read is consistent with this
 * codebase's existing looseness here (`session.ts`'s `gymName`/`memberName`
 * are re-read the same way, not claims-cached).
 */
export const getRequestLocale = cache(async (): Promise<Locale> => {
  try {
    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    const sub = claimsData?.claims?.sub as string | undefined;

    if (sub) {
      const { data } = await supabase
        .from("users")
        .select("preferred_language")
        .eq("id", sub)
        .maybeSingle();
      if (data && isLocale(data.preferred_language)) {
        return data.preferred_language;
      }
    }
  } catch {
    // A claims/DB failure here must never break rendering -- this is a
    // display preference, not a security boundary. Fall through to
    // Accept-Language-based resolution below.
  }

  const acceptLanguage = (await headers()).get("accept-language") ?? "";
  return resolveFromAcceptLanguage(acceptLanguage);
});

/** Parses an Accept-Language header respecting `q=` quality weighting
 * (RFC 9110 12.5.4) -- e.g. "fr;q=0.1,en;q=0.9" must resolve to "en", not
 * "fr" just because it appears first in the header. Untagged entries default
 * to q=1.0. Exported standalone (not wrapped in `cache()`) so it can be
 * unit-tested as a pure function without a request scope. */
export function resolveFromAcceptLanguage(acceptLanguage: string): Locale {
  const tags = acceptLanguage
    .split(",")
    .map((entry) => {
      const [rawTag, ...params] = entry.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      const lang = rawTag?.trim().split("-")[0]?.toLowerCase();
      return { lang, q: Number.isFinite(q) ? q : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { lang } of tags) {
    if (isLocale(lang)) return lang;
  }

  return defaultLocale;
}
