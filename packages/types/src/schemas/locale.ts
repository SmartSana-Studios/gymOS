import { z } from "zod";

// FR-015/FR-018: platform language preference. Shared by both dashboard's
// and super-admin's `updateLanguagePreference` Server Actions -- keeps the
// set of valid locale codes defined in exactly one place, matching the
// project's "packages/types Zod schemas are the single source of
// validation" rule (never redefine a schema inline in a Server Action).
export const localeSchema = z.enum(["en", "fr"]);

export type LocaleInput = z.infer<typeof localeSchema>;
