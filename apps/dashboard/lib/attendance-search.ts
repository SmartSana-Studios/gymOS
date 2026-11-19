// Story 27.3: the pure pieces of the Check in a member search, in a module with no server import so the client modal (which must know the
// 8-row limit and the 2-letter / 3-digit threshold) can use them. A Client Component must never import a value from services/attendance.ts:
// that file reaches next/headers (React #441 in production, a failed Turbopack build in the E2E).

/** AD-30: at most 8 rows are shown; one more is fetched to know whether to say "Showing the first 8". */
export const CHECK_IN_SEARCH_LIMIT = 8;

const ACCENT_CLASSES: Record<string, string> = {
  a: "[aàáâãäåAÀÁÂÃÄÅ]",
  c: "[cçCÇ]",
  e: "[eèéêëEÈÉÊË]",
  i: "[iìíîïIÌÍÎÏ]",
  n: "[nñNÑ]",
  o: "[oòóôõöOÒÓÔÕÖ]",
  u: "[uùúûüUÙÚÛÜ]",
  y: "[yýÿYÝŸ]",
};

/** "Ange" -> a regular expression that matches "Angé", "ANGE" and "Ange" (accent-insensitive contains; the case is the `imatch`
 * operator's). Only letters, digits and spaces are copied into the pattern; every other character becomes a single-character wildcard
 * ("."), so nothing the user types can change the pattern's shape, and no backslash ever reaches PostgREST's quoted-value parser
 * (which treats a backslash as an escape and would drop it). */
export function accentInsensitivePattern(term: string): string {
  const folded = term.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let out = "";
  for (const ch of folded.toLowerCase()) {
    if (ACCENT_CLASSES[ch]) out += ACCENT_CLASSES[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else if (/\s/.test(ch)) out += " ";
    else out += ".";
  }
  return out;
}

/** The digits of a typed phone in any country-code form: "+237 6 70 11", "00237670..." and "670..." all search by their digits. */
export function phoneSearchDigits(term: string): string {
  let digits = term.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  return digits;
}

/** Needs 2 letters or 3 digits (UX AD-30). Anything shorter queries nothing. */
export function isSearchTermLongEnough(term: string): boolean {
  const trimmed = term.trim();
  const letters = trimmed.replace(/[^\p{L}]/gu, "").length;
  const digits = trimmed.replace(/\D/g, "").length;
  return letters >= 2 || digits >= 3;
}

