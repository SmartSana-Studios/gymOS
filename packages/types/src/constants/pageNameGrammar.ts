// Story 24.10 (FR-202, AD-45): the ONE page name grammar, used by the Zod name schema (claim), the host parser (the landing proxy) and
// scripts/check-reserved-labels.mjs. This file imports nothing so that a plain Node script can load it directly (Node strips the types).
// The database holds the same rule in private.page_name_valid() (0163). There is no shared case list: the SQL side's table of invalid names
// is in supabase/tests/page_names.test.sql, the TypeScript side's in packages/types/src/pageContent.test.ts; keep them alike by hand.

export const PAGE_NAME_MIN = 3;
export const PAGE_NAME_MAX = 30;

/** 3 to 30 characters of a-z0-9-, no leading or trailing hyphen, no `--` (so no `xn--`), not digits only. Lowercase only: callers lowercase first. */
export function isValidPageName(name: string): boolean {
  return (
    typeof name === "string" &&
    new RegExp(`^[a-z0-9-]{${PAGE_NAME_MIN},${PAGE_NAME_MAX}}$`).test(name) &&
    !/^-|-$|--/.test(name) &&
    !/^[0-9]+$/.test(name)
  );
}
