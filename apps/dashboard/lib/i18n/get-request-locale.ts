import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { defaultLocale, isLocale, type Locale } from "./config";

/**
 * Single locale-resolution primitive for the whole app -- the root layout,
 * Server Actions, and `mapAndLog` (services/session.ts) all call this.
 * Priority order matches EXPERIENCE.md's Localization section: (1) the
 * signed-in user's saved `users.preferred_language` (FR-015 -- "persists
 * per account across devices"), (2) the request's Accept-Language header,
 * (3) English fallback.
 *
 * `preferred_language` is deliberately NOT read from the JWT claims (the
 * custom_access_token_hook, 0009_auth_hook_gym_claims.sql, does not carry
 * it) -- embedding it there would delay a language change until token
 * refresh, breaking the "no missing-string fallback"/immediate-toggle
 * requirement. A live per-request DB read is consistent with this
 * codebase's existing looseness here (`session.ts`'s `gymName`/`memberName`
 * are re-read the same way, not claims-cached).
 */
export async function getRequestLocale(): Promise<Locale> {
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
  for (const tag of acceptLanguage.split(",")) {
    const lang = tag.trim().split(";")[0]?.split("-")[0]?.toLowerCase();
    if (isLocale(lang)) return lang;
  }

  return defaultLocale;
}
