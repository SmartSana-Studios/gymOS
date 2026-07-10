import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { defaultLocale, isLocale, type Locale } from "./config";

/**
 * Single locale-resolution primitive for the whole app -- the root layout,
 * Server Actions, and `mapAndLog` (services/gyms.ts) all call this. Same
 * design as apps/dashboard's copy (not shared beyond packages/types, per
 * this project's established services/runtime-code-not-shared-across-apps
 * convention). Priority order matches EXPERIENCE.md's Localization section:
 * (1) the signed-in user's saved `users.preferred_language`, (2) the
 * request's Accept-Language header, (3) English fallback.
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
