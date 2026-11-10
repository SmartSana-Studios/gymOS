// Story 24.10 (AD-48): the template registry. A template is registered only when it carries a chrome dictionary for EVERY language in
// PAGE_CONTENT_LANGUAGES and only fonts from the allowlist; a module that does not is refused at load. The dashboard offers only
// registered templates (apps/dashboard/lib/pageTemplates.ts is checked against this list by a cross-package test); an unregistered
// `template` value in a stored row renders the uniform not-found.
import { PAGE_CONTENT_LANGUAGES, PAGE_TEMPLATE_PATTERN } from "@gymos/types";
import { CHROME } from "./chrome";
import { FONT_ALLOWLIST, type TemplateEntry } from "./contract";
import { render as renderClassic } from "./templates/classic";
import { CLASSIC_FONTS } from "./templates/classic/styles";
import { render as renderVolt } from "./templates/volt";
import { VOLT_FONTS } from "./templates/volt/styles";

/** Throws when an entry breaks a registration rule. Exported so the conformance suite can show each rule failing. */
export function assertRegistrable(entry: TemplateEntry): void {
  if (!PAGE_TEMPLATE_PATTERN.test(entry.id)) throw new Error(`template id "${entry.id}" is not a valid template name`);
  for (const lang of PAGE_CONTENT_LANGUAGES) {
    if (!entry.chrome?.[lang]) throw new Error(`template "${entry.id}" has no chrome dictionary for "${lang}"`);
  }
  for (const font of entry.fonts) {
    if (!(font in FONT_ALLOWLIST)) throw new Error(`template "${entry.id}" declares a font outside the allowlist: ${font}`);
  }
}

const ENTRIES: readonly TemplateEntry[] = [
  { id: "classic", render: renderClassic, chrome: CHROME, fonts: CLASSIC_FONTS },
  { id: "volt", render: renderVolt, chrome: CHROME, fonts: VOLT_FONTS },
];
ENTRIES.forEach(assertRegistrable);

/** Every registered template id. */
export const REGISTERED_TEMPLATES: readonly string[] = ENTRIES.map((e) => e.id);

export function getTemplate(id: string): TemplateEntry | undefined {
  return ENTRIES.find((e) => e.id === id);
}
