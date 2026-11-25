/** The first schema issue as a message in the Super Admin's language. The shared schemas (packages/types) carry English literals, so a "too short" reason would show
 * English text in the French interface; the reason field is the one every Super Admin dialog asks for, so it maps to a locale key. Any other issue keeps the schema's own message
 * (those were reviewed field by field), and no issue falls back to the shared "Invalid input". */
export function validationMessage(
  issue: { path: readonly PropertyKey[]; code?: string; message: string } | undefined,
  t: (key: string) => string,
): string {
  if (!issue) return t("common.invalidInput");
  if (issue.path[0] === "reason" && issue.code === "too_small") return t("validation.reasonRequired");
  return issue.message;
}
