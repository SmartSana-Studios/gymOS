// Story 24.9 (FR-201): the templates the editor offers, from ONE constant module. Story 24.10 owns the real registry and the
// conformance suite that decides which template may be offered; until then this list is the single place the launch template is named.
// The database checks only the name's shape (publish_gym_page, PAGE_TEMPLATE_PATTERN). Changing the template never asks for content again:
// content lives on the gym, the template is a name.

export const PAGE_TEMPLATES = ["classic"] as const;
export type PageTemplateId = (typeof PAGE_TEMPLATES)[number];
export const DEFAULT_PAGE_TEMPLATE: PageTemplateId = PAGE_TEMPLATES[0];

export function isOfferedTemplate(value: unknown): value is PageTemplateId {
  return typeof value === "string" && (PAGE_TEMPLATES as readonly string[]).includes(value);
}
