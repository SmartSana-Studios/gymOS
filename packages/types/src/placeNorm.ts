// Story 25.1 (AD-49): the TypeScript twin of private.place_norm() / private.place_slug() (migration 0169). ONE fixture, packages/types/src/fixtures/
// placeNormCases.json, is run against both sides: placeNorm.test.ts here, supabase/tests/countries_cities.test.sql in the database.
// The alias lookup in the dashboard editor and the slug preview in the Super Admin form use these; the database is the judge.

// Accent fold: the same letters, in the same order, as the translate() call in the migration. The upper-case half is there because
// the database's lower() depends on the locale; the twin keeps the same table.
const FOLD_FROM =
  "àáâãäåāăąçćčďđèéêëēėęěğìíîïīįıłñńňòóôõöøōőŕřśšşșťţțùúûüūůűųýÿźżžÀÁÂÃÄÅĀĂĄÇĆČĎĐÈÉÊËĒĖĘĚĞÌÍÎÏĪĮIŁÑŃŇÒÓÔÕÖØŌŐŔŘŚŠŞȘŤŢȚÙÚÛÜŪŮŰŲÝŸŹŻŽ";
const FOLD_TO =
  "aaaaaaaaacccddeeeeeeeegiiiiiiilnnnoooooooorrsssstttuuuuuuuuyyzzzaaaaaaaaacccddeeeeeeeegiiiiiiilnnnoooooooorrsssstttuuuuuuuuyyzzz";
const FOLD = new Map<string, string>(Array.from(FOLD_FROM).map((ch, i) => [ch, Array.from(FOLD_TO)[i] as string]));

// Spaces, hyphens, apostrophes and underscore collapse to ONE space (the class is spelled out, as in SQL).
const SEPARATORS = /[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'’‘`´‐‑‒–—―_-]+/g;

/** Composed (NFC), lower case, accent folded, separators collapsed to single spaces, trimmed. Equals private.place_norm(). */
export function placeNorm(text: string | null | undefined): string {
  const lowered = (text ?? "").normalize("NFC").toLowerCase().replaceAll("æ", "ae").replaceAll("œ", "oe").replaceAll("ß", "ss");
  const folded = Array.from(lowered)
    .map((ch) => FOLD.get(ch) ?? ch)
    .join("");
  return folded.replace(SEPARATORS, " ").replace(/^ +| +$/g, "");
}

/** ASCII url slug of a name: the normalized form with hyphens, other characters dropped. Empty when nothing ASCII is left. Equals private.place_slug(). */
export function placeSlug(text: string | null | undefined): string {
  return placeNorm(text)
    .replaceAll(" ", "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
